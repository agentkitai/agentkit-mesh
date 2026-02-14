import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { AgentRegistry } from './registry.js';
import { DiscoveryEngine } from './discovery.js';
import { DelegationClient } from './delegation.js';
import crypto from 'crypto';

function safeInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n < 0 ? fallback : n;
}

export function createHttpServer(registry: AgentRegistry, port = 8766) {
  const app = new Hono();
  const discovery = new DiscoveryEngine();
  const delegationClient = new DelegationClient();

  app.use('*', cors());

  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // ── Health ──
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // ── Agents ──

  app.get('/v1/agents', (c) => {
    const agents = registry.list();
    // Strip auth tokens from list response
    return c.json(agents.map(a => ({ ...a, auth: a.auth ? { type: a.auth.type } : undefined })));
  });

  app.post('/v1/agents', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { name, description, capabilities, resources, endpoint, protocol, auth } = body;
    if (!name || !endpoint) {
      return c.json({ error: 'name and endpoint are required' }, 400);
    }
    const agent = registry.register({ name, description: description ?? '', capabilities: capabilities ?? [], resources: resources ?? [], endpoint, protocol, auth });
    return c.json(agent, 201);
  });

  app.get('/v1/agents/:name', (c) => {
    const agent = registry.get(c.req.param('name'));
    if (!agent) return c.json({ error: 'not found' }, 404);
    // Strip auth token from response
    return c.json({ ...agent, auth: agent.auth ? { type: agent.auth.type } : undefined });
  });

  app.delete('/v1/agents/:name', (c) => {
    const removed = registry.unregister(c.req.param('name'));
    if (!removed) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  app.post('/v1/agents/:name/heartbeat', (c) => {
    const updated = registry.heartbeat(c.req.param('name'));
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  // ── Discovery ──

  // GET /v1/discover?query=...&resources=[{"type":"filesystem","uri":"/path"}]
  app.get('/v1/discover', (c) => {
    const query = c.req.query('query') ?? '';
    const limit = safeInt(c.req.query('limit'), 0) || undefined;
    if (!query) return c.json({ error: 'query parameter required' }, 400);

    let requiredResources;
    const resourcesParam = c.req.query('resources');
    if (resourcesParam) {
      try { requiredResources = JSON.parse(resourcesParam); } catch {
        return c.json({ error: 'Invalid resources JSON' }, 400);
      }
    }

    const results = discovery.discover(query, registry, limit, requiredResources);
    // Strip auth from discovery results
    return c.json(results.map(r => ({
      ...r,
      agent: { ...r.agent, auth: r.agent.auth ? { type: r.agent.auth.type } : undefined },
    })));
  });

  // ── Delegation ──

  app.post('/v1/delegate', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { task, context } = body;
    if (!task) {
      return c.json({ error: 'task is required' }, 400);
    }

    // Either target by name or let mesh auto-discover
    let targetName = body.targetName;
    let agent;
    const requiredResources = body.resources;

    if (targetName) {
      agent = registry.get(targetName);
      if (!agent) return c.json({ error: `Agent "${targetName}" not found` }, 404);

      // If resources specified, verify the target agent has access
      if (requiredResources?.length) {
        const check = discovery.discover(
          agent.capabilities.join(' '),
          registry,
          undefined,
          requiredResources,
        );
        const hasAccess = check.some(r => r.agent.name === targetName);
        if (!hasAccess) {
          return c.json({
            error: `Agent "${targetName}" does not have access to required resources`,
            requiredResources,
            agentResources: agent.resources,
          }, 403);
        }
      }
    } else if (body.query) {
      // Auto-discover best agent — with resource filtering
      const results = discovery.discover(body.query, registry, 1, requiredResources);
      if (results.length === 0) {
        const reason = requiredResources?.length
          ? 'No agent found with matching capabilities AND access to required resources'
          : 'No agent found matching query';
        return c.json({ error: reason, requiredResources }, 404);
      }
      agent = results[0].agent;
      targetName = agent.name;
    } else {
      return c.json({ error: 'targetName or query is required' }, 400);
    }

    const id = crypto.randomUUID();
    const sourceAgent = body.sourceAgent ?? 'api';
    const isAsync = body.async === true;

    // Log delegation as pending
    registry.logDelegation({
      id,
      source_agent: sourceAgent,
      target_agent: targetName,
      task,
      status: 'pending',
      result: null,
      error: null,
      latency_ms: null,
    });

    // Update to running
    registry.updateDelegation(id, { status: 'running' });

    // Delegate via HTTP callback
    const result = await delegationClient.delegate(agent.endpoint, id, task, {
      context: context ?? {},
      auth: agent.auth,
      async: isAsync,
    });

    // Update delegation record
    registry.updateDelegation(id, {
      status: result.status,
      result: result.result ?? undefined,
      error: result.error ?? undefined,
      latency_ms: result.latencyMs,
    });

    return c.json({ id, targetAgent: targetName, ...result });
  });

  // ── Async callback — agents POST results here for long-running tasks ──

  app.post('/v1/delegations/:id/result', async (c) => {
    const id = c.req.param('id');
    const delegation = registry.getDelegation(id);
    if (!delegation) return c.json({ error: 'Delegation not found' }, 404);
    if (delegation.status === 'completed' || delegation.status === 'failed') {
      return c.json({ error: 'Delegation already finalized' }, 409);
    }

    let body: any;
    try { body = await c.req.json(); } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const status = body.status === 'failed' ? 'failed' : 'completed';
    registry.updateDelegation(id, {
      status,
      result: body.result ?? undefined,
      error: body.error ?? undefined,
    });

    return c.json({ ok: true });
  });

  // ── Delegation log ──

  app.get('/v1/delegations', (c) => {
    const limit = safeInt(c.req.query('limit'), 50);
    const offset = safeInt(c.req.query('offset'), 0);
    return c.json(registry.listDelegations(limit, offset));
  });

  app.get('/v1/delegations/:id', (c) => {
    const delegation = registry.getDelegation(c.req.param('id'));
    if (!delegation) return c.json({ error: 'not found' }, 404);
    return c.json(delegation);
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`agentkit-mesh HTTP server listening on port ${info.port}`);
  });

  return server;
}
