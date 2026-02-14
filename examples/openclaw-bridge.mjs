#!/usr/bin/env node
/**
 * OpenClaw ↔ Mesh Bridge (Async Delegation)
 * 
 * Bridges agentkit-mesh to OpenClaw sub-agents using async delegation:
 * 1. Mesh POSTs task → bridge returns 202 (accepted)
 * 2. Bridge writes task to /tmp/mesh-bridge-queue/pending/
 * 3. OpenClaw agent (Brad) polls queue, spawns sub-agents via sessions_spawn
 * 4. On completion, Brad writes result to /tmp/mesh-bridge-queue/results/
 * 5. Bridge picks up result and POSTs it back to mesh callback URL
 * 
 * Usage:
 *   node openclaw-bridge.mjs
 * 
 * Env:
 *   MESH_URL       - Mesh base URL (default: http://localhost:8766)
 *   BRIDGE_HOST    - Listen host (default: 0.0.0.0)
 *   BRIDGE_PORT    - Starting port (default: 4001)
 *   QUEUE_DIR      - Queue directory (default: /tmp/mesh-bridge-queue)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MESH_URL = (process.env.MESH_URL || 'http://localhost:8766').replace(/\/+$/, '');
const BRIDGE_HOST = process.env.BRIDGE_HOST || '0.0.0.0';
const BASE_PORT = parseInt(process.env.BRIDGE_PORT || '4001', 10);
const QUEUE_DIR = process.env.QUEUE_DIR || '/tmp/mesh-bridge-queue';

// Ensure dirs exist
fs.mkdirSync(path.join(QUEUE_DIR, 'pending'), { recursive: true });
fs.mkdirSync(path.join(QUEUE_DIR, 'results'), { recursive: true });

const AGENTS = [
  {
    name: 'dev',
    port: BASE_PORT,
    description: 'Code review, debugging, and architecture',
    capabilities: ['code-review', 'debugging', 'architecture', 'testing', 'devops'],
  },
  {
    name: 'coach',
    port: BASE_PORT + 1,
    description: 'Fitness coaching, nutrition planning, and health tracking',
    capabilities: ['fitness', 'nutrition', 'health-tracking', 'motivation'],
  },
  {
    name: 'biz',
    port: BASE_PORT + 2,
    description: 'Business strategy, market analysis, and monetization',
    capabilities: ['market-research', 'competitive-analysis', 'pricing', 'go-to-market', 'monetization'],
  },
];

// Watch for results and POST them back to mesh
function startResultWatcher() {
  const resultsDir = path.join(QUEUE_DIR, 'results');
  
  setInterval(() => {
    try {
      const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(resultsDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const { delegationId, result, error } = data;
          
          if (!delegationId) { fs.unlinkSync(filePath); continue; }
          
          // POST result back to mesh callback
          const callbackUrl = `${MESH_URL}/v1/delegations/${delegationId}/result`;
          fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: error ? 'failed' : 'completed',
              result: result || undefined,
              error: error || undefined,
            }),
          }).then(res => {
            if (res.ok) {
              console.log(`[watcher] ✓ Result delivered for ${delegationId.slice(0, 8)}`);
            } else {
              console.error(`[watcher] ✗ Callback failed for ${delegationId.slice(0, 8)}: ${res.status}`);
            }
          }).catch(err => {
            console.error(`[watcher] ✗ Callback error for ${delegationId.slice(0, 8)}: ${err.message}`);
          });
          
          // Clean up
          fs.unlinkSync(filePath);
          try { fs.unlinkSync(path.join(QUEUE_DIR, 'pending', file)); } catch {}
        } catch (err) {
          console.error(`[watcher] Error processing ${file}: ${err.message}`);
        }
      }
    } catch {}
  }, 1000);
}

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

      const { delegationId, task, callbackUrl } = body;
      console.log(`[${agent.name}] ← delegation ${delegationId?.slice(0, 8)} | task: "${task?.slice(0, 80)}"`);

      // Write to queue for OpenClaw agent to pick up
      const taskFile = path.join(QUEUE_DIR, 'pending', `${delegationId}.json`);
      fs.writeFileSync(taskFile, JSON.stringify({
        delegationId,
        agentName: agent.name,
        task,
        timestamp: new Date().toISOString(),
      }));

      // Return 202 Accepted — mesh will track as async
      console.log(`[${agent.name}] → delegation ${delegationId?.slice(0, 8)} | ACCEPTED (queued for OpenClaw)`);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted', message: 'Task queued for OpenClaw sub-agent' }));
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
  console.log(`Bridge starting — ${AGENTS.length} agents, mesh: ${MESH_URL}`);
  console.log(`Queue: ${QUEUE_DIR}/pending/ → OpenClaw agent → ${QUEUE_DIR}/results/\n`);

  for (const agent of AGENTS) {
    startAgentServer(agent);
    const meshEndpoint = `http://host.docker.internal:${agent.port}/task`;
    await registerWithMesh(agent, meshEndpoint);
  }

  startResultWatcher();

  console.log('\nBridge ready — async delegation via OpenClaw sub-agents.\n');
  console.log('Tasks appear in queue. OpenClaw agent processes them via sessions_spawn.');
  console.log('Results are automatically POSTed back to mesh callback URL.\n');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
