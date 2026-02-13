import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AgentRegistry } from './registry.js';
import { DiscoveryEngine } from './discovery.js';

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

  return server;
}
