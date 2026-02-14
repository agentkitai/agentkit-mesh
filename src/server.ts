import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AgentRegistry } from './registry.js';
import { DiscoveryEngine } from './discovery.js';
import { DelegationClient } from './delegation.js';

export function createServer(registry: AgentRegistry): McpServer {
  const server = new McpServer({
    name: 'agentkit-mesh',
    version: '0.1.0',
  });

  const discovery = new DiscoveryEngine();

  server.tool(
    'mesh_register',
    'Register an agent with its capabilities',
    {
      name: z.string().describe('Unique agent name'),
      description: z.string().describe('What this agent does'),
      capabilities: z.array(z.string()).describe('List of capabilities'),
      endpoint: z.string().describe('Agent endpoint URL'),
    },
    async ({ name, description, capabilities, endpoint }) => {
      const agent = registry.register({ name, description, capabilities, endpoint });
      return { content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }] };
    }
  );

  server.tool(
    'mesh_discover',
    'Discover agents matching a query',
    {
      query: z.string().describe('Search query'),
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
    {
      name: z.string().describe('Agent name to remove'),
    },
    async ({ name }) => {
      const removed = registry.unregister(name);
      return {
        content: [{ type: 'text' as const, text: removed ? `Unregistered ${name}` : `Agent ${name} not found` }],
      };
    }
  );

  const delegationClient = new DelegationClient();

  server.tool(
    'mesh_delegate',
    'Delegate a task to another agent via OpenClaw. Discovers the agent in the registry and routes via the gateway.',
    {
      targetName: z.string().describe('Name of the target agent (e.g., dev, coach, biz)'),
      task: z.string().describe('Task to delegate'),
    },
    async ({ targetName, task }) => {
      const agent = registry.get(targetName);
      if (!agent) {
        return { content: [{ type: 'text' as const, text: `Agent "${targetName}" not found in registry` }] };
      }
      const agentId = agent.endpoint.replace(/^openclaw:\/\/agent\//, '');
      const result = await delegationClient.delegate(agentId, task);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}
