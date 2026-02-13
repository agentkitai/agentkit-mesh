import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentRegistry } from '../src/registry.js';
import { createServer } from '../src/server.js';

describe('MCP Server', () => {
  let registry: AgentRegistry;
  let client: Client;

  beforeEach(async () => {
    registry = new AgentRegistry(':memory:');
    const server = createServer(registry);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test-client', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(() => {
    registry.close();
  });

  it('lists available tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('mesh_register');
    expect(names).toContain('mesh_discover');
    expect(names).toContain('mesh_unregister');
  });

  it('registers an agent via tool', async () => {
    const result = await client.callTool({
      name: 'mesh_register',
      arguments: {
        name: 'my-agent',
        description: 'Does things',
        capabilities: ['stuff'],
        endpoint: 'http://localhost:9000',
      },
    });

    const text = (result.content as any)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.name).toBe('my-agent');

    // Verify in registry
    expect(registry.get('my-agent')).not.toBeNull();
  });

  it('discovers agents via tool', async () => {
    registry.register({ name: 'finder', description: 'Search engine', capabilities: ['search'], endpoint: 'http://localhost:1' });

    const result = await client.callTool({
      name: 'mesh_discover',
      arguments: { query: 'search' },
    });

    const text = (result.content as any)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].agent.name).toBe('finder');
  });

  it('unregisters an agent via tool', async () => {
    registry.register({ name: 'temp', description: 'Temp', capabilities: [], endpoint: 'http://localhost:1' });

    const result = await client.callTool({
      name: 'mesh_unregister',
      arguments: { name: 'temp' },
    });

    const text = (result.content as any)[0].text;
    expect(text).toContain('Unregistered');
    expect(registry.get('temp')).toBeNull();
  });
});
