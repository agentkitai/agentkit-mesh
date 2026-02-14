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

  // Global error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Health
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // List agents
  app.get('/v1/agents', (c) => c.json(registry.list()));

  // Register agent
  app.post('/v1/agents', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { name, description, capabilities, endpoint, protocol } = body;
    if (!name || !endpoint) {
      return c.json({ error: 'name and endpoint are required' }, 400);
    }
    const agent = registry.register({
      name,
      description: description ?? '',
      capabilities: capabilities ?? [],
      endpoint,
      protocol,
    });
    return c.json(agent, 201);
  });

  // Get agent
  app.get('/v1/agents/:name', (c) => {
    const agent = registry.get(c.req.param('name'));
    if (!agent) return c.json({ error: 'not found' }, 404);
    return c.json(agent);
  });

  // Unregister agent
  app.delete('/v1/agents/:name', (c) => {
    const removed = registry.unregister(c.req.param('name'));
    if (!removed) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  // Heartbeat
  app.post('/v1/agents/:name/heartbeat', (c) => {
    const updated = registry.heartbeat(c.req.param('name'));
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  // Discover
  app.get('/v1/discover', (c) => {
    const query = c.req.query('query') ?? '';
    const limit = safeInt(c.req.query('limit'), 0) || undefined;
    if (!query) return c.json({ error: 'query parameter required' }, 400);
    const results = discovery.discover(query, registry, limit);
    return c.json(results);
  });

  // Delegate — routes task to agent via OpenClaw gateway
  app.post('/v1/delegate', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { targetName, task, context } = body;
    if (!targetName || !task) {
      return c.json({ error: 'targetName and task are required' }, 400);
    }
    const agent = registry.get(targetName);
    if (!agent) return c.json({ error: `Agent "${targetName}" not found` }, 404);

    // Extract agentId from endpoint (openclaw://agent/dev → dev)
    const agentId = agent.endpoint.replace(/^openclaw:\/\/agent\//, '');

    const id = crypto.randomUUID();
    const result = await delegationClient.delegate(agentId, task, context ?? {});

    registry.logDelegation({
      id,
      source_agent: body.sourceAgent ?? 'http-api',
      target_agent: targetName,
      task,
      status: result.success ? 'completed' : 'failed',
      result: result.result ?? null,
      error: result.error ?? null,
      latency_ms: result.latencyMs,
    });

    return c.json({ id, ...result });
  });

  // Delegation log
  app.get('/v1/delegations', (c) => {
    const limit = safeInt(c.req.query('limit'), 50);
    const offset = safeInt(c.req.query('offset'), 0);
    return c.json(registry.listDelegations(limit, offset));
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`agentkit-mesh HTTP server listening on port ${info.port}`);
  });

  return server;
}
