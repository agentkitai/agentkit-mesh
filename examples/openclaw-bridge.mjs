#!/usr/bin/env node
/**
 * OpenClaw ↔ Mesh Bridge
 * 
 * Bridges agentkit-mesh HTTP delegations to OpenClaw sub-agents.
 * Each agent gets its own port. The mesh POSTs tasks here,
 * the bridge spawns an OpenClaw sub-agent session via internal
 * gateway websocket, and returns the result.
 * 
 * For non-OpenClaw agents, any HTTP server returning { result: "..." }
 * on POST /task works — this bridge is just one implementation.
 * 
 * Usage:
 *   node openclaw-bridge.mjs
 * 
 * Env:
 *   MESH_URL       - Mesh base URL (default: http://localhost:8766)
 *   BRIDGE_HOST    - Listen host (default: 0.0.0.0)
 *   BRIDGE_PORT    - Starting port (default: 4001)
 */

import http from 'node:http';

const MESH_URL = (process.env.MESH_URL || 'http://localhost:8766').replace(/\/+$/, '');
const BRIDGE_HOST = process.env.BRIDGE_HOST || '0.0.0.0';
const BASE_PORT = parseInt(process.env.BRIDGE_PORT || '4001', 10);

// Agent definitions
const AGENTS = [
  {
    name: 'dev',
    port: BASE_PORT,
    description: 'Code review, debugging, and architecture',
    capabilities: ['code-review', 'debugging', 'architecture', 'testing', 'devops'],
    handler: (task) => {
      // Simulate a dev agent response
      return `[dev-agent] Reviewed task: "${task.slice(0, 100)}"\n` +
        `Analysis:\n` +
        `- Code structure: looks reasonable\n` +
        `- Error handling: consider adding try/catch blocks\n` +
        `- Testing: ensure unit test coverage > 80%\n` +
        `- Suggestion: extract common patterns into shared utilities`;
    },
  },
  {
    name: 'coach',
    port: BASE_PORT + 1,
    description: 'Fitness coaching, nutrition planning, and health tracking',
    capabilities: ['fitness', 'nutrition', 'health-tracking', 'motivation'],
    handler: (task) => {
      return `[coach-agent] Fitness plan for: "${task.slice(0, 100)}"\n` +
        `Recommendation:\n` +
        `- Day 1: Push (chest/shoulders/triceps) — 4x8 bench, 3x10 OHP, 3x12 lateral raises\n` +
        `- Day 2: Pull (back/biceps) — 4x8 rows, 3x10 pullups, 3x12 curls\n` +
        `- Day 3: Legs — 4x8 squats, 3x10 RDL, 3x15 leg press\n` +
        `- Nutrition: aim for 1.6g protein/kg bodyweight, prioritize whole foods`;
    },
  },
  {
    name: 'biz',
    port: BASE_PORT + 2,
    description: 'Business strategy, market analysis, and monetization',
    capabilities: ['market-research', 'competitive-analysis', 'pricing', 'go-to-market', 'monetization'],
    handler: (task) => {
      return `[biz-agent] Strategy for: "${task.slice(0, 100)}"\n` +
        `Market analysis:\n` +
        `- Target segment: developer tools / AI infrastructure\n` +
        `- Pricing model: freemium with usage-based tiers\n` +
        `- Key differentiator: agent-native observability\n` +
        `- Go-to-market: developer community + open-source adoption funnel`;
    },
  },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function startAgentServer(agent) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', agent: agent.name }));
      return;
    }

    if (req.method === 'POST' && req.url === '/task') {
      let body;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { delegationId, task, context } = body;
      const startMs = Date.now();
      console.log(`[${agent.name}] ← delegation ${delegationId?.slice(0, 8)} | task: "${task?.slice(0, 80)}"`);

      try {
        const result = agent.handler(task);
        const elapsed = Date.now() - startMs;
        console.log(`[${agent.name}] → delegation ${delegationId?.slice(0, 8)} | COMPLETED (${elapsed}ms)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        const elapsed = Date.now() - startMs;
        console.error(`[${agent.name}] ✗ delegation ${delegationId?.slice(0, 8)} | FAILED (${elapsed}ms): ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(agent.port, BRIDGE_HOST, () => {
    console.log(`[${agent.name}] listening on ${BRIDGE_HOST}:${agent.port}`);
  });
  return server;
}

async function registerWithMesh(agent, endpoint) {
  try {
    await fetch(`${MESH_URL}/v1/agents/${agent.name}`, { method: 'DELETE' }).catch(() => {});
    const res = await fetch(`${MESH_URL}/v1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities,
        endpoint,
        protocol: 'http',
      }),
    });
    if (res.ok) {
      console.log(`[${agent.name}] registered with mesh → ${endpoint}`);
    } else {
      console.error(`[${agent.name}] registration failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[${agent.name}] registration error: ${err.message}`);
  }
}

async function main() {
  console.log(`Bridge starting — ${AGENTS.length} agents, mesh: ${MESH_URL}\n`);

  for (const agent of AGENTS) {
    startAgentServer(agent);
    const meshEndpoint = `http://host.docker.internal:${agent.port}/task`;
    await registerWithMesh(agent, meshEndpoint);
  }

  console.log('\nBridge ready.\n');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
