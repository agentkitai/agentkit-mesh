import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AgentRegistry } from './registry.js';
import { DiscoveryEngine } from './discovery.js';
import { DelegationClient } from './delegation.js';
import crypto from 'crypto';

export function createServer(registry: AgentRegistry): McpServer {
  const server = new McpServer({
    name: 'agentkit-mesh',
    version: '2.0.0',
  });

  const discovery = new DiscoveryEngine();
  const delegationClient = new DelegationClient();

  server.tool(
    'mesh_register',
    'Register an agent with its capabilities and HTTP callback endpoint',
    {
      name: z.string().describe('Unique agent name'),
      description: z.string().describe('What this agent does'),
      capabilities: z.array(z.string()).describe('List of capabilities'),
      endpoint: z.string().describe('HTTP callback URL (e.g., http://host:port/task)'),
    },
    async ({ name, description, capabilities, endpoint }) => {
      const agent = registry.register({ name, description, capabilities, endpoint });
      return { content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }] };
    }
  );

  server.tool(
    'mesh_discover',
    'Discover agents matching a query by capability',
    {
      query: z.string().describe('Search query (e.g., "code review architecture")'),
      limit: z.number().optional().describe('Max results'),
    },
    async ({ query, limit }) => {
      const results = discovery.discover(query, registry, limit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    'mesh_unregister',
    'Unregister an agent',
    { name: z.string().describe('Agent name to remove') },
    async ({ name }) => {
      const removed = registry.unregister(name);
      return { content: [{ type: 'text' as const, text: removed ? `Unregistered ${name}` : `Agent ${name} not found` }] };
    }
  );

  server.tool(
    'mesh_delegate',
    'Delegate a task to an agent. Routes via HTTP callback to the agent\'s registered endpoint.',
    {
      targetName: z.string().describe('Name of the target agent'),
      task: z.string().describe('Task to delegate'),
    },
    async ({ targetName, task }) => {
      const agent = registry.get(targetName);
      if (!agent) {
        return { content: [{ type: 'text' as const, text: `Agent "${targetName}" not found in registry` }] };
      }

      const id = crypto.randomUUID();
      registry.logDelegation({ id, source_agent: 'mcp', target_agent: targetName, task, status: 'running', result: null, error: null, latency_ms: null });

      const result = await delegationClient.delegate(agent.endpoint, id, task, { auth: agent.auth });

      registry.updateDelegation(id, { status: result.status, result: result.result, error: result.error, latency_ms: result.latencyMs });

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, ...result }, null, 2) }] };
    }
  );

  return server;
}
