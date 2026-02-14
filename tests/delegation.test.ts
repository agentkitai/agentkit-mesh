import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DelegationClient } from '../src/delegation.js';
import { AgentRegistry } from '../src/registry.js';
import { createServer } from '../src/server.js';

describe('DelegationClient', () => {
  it('rejects delegation when depth exceeds max', async () => {
    const dc = new DelegationClient({ gatewayUrl: 'http://localhost:1' });
    const result = await dc.delegate('dev', 'task', { depth: 4 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/depth/i);
  });

  it('returns error when gateway is unreachable', async () => {
    const dc = new DelegationClient({ gatewayUrl: 'http://localhost:1', timeout: 2000 });
    const result = await dc.delegate('dev', 'test task');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('tracks latency even on failure', async () => {
    const dc = new DelegationClient({ gatewayUrl: 'http://localhost:1', timeout: 2000 });
    const result = await dc.delegate('dev', 'test');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('send returns error when gateway is unreachable', async () => {
    const dc = new DelegationClient({ gatewayUrl: 'http://localhost:1' });
    const result = await dc.send('dev', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('reads config from env vars', () => {
    const origUrl = process.env['OPENCLAW_GATEWAY_URL'];
    const origToken = process.env['OPENCLAW_GATEWAY_TOKEN'];
    process.env['OPENCLAW_GATEWAY_URL'] = 'http://test:9999';
    process.env['OPENCLAW_GATEWAY_TOKEN'] = 'test-token';

    const dc = new DelegationClient();
    // Can't inspect private fields, but we can verify it doesn't throw
    expect(dc).toBeDefined();

    if (origUrl) process.env['OPENCLAW_GATEWAY_URL'] = origUrl;
    else delete process.env['OPENCLAW_GATEWAY_URL'];
    if (origToken) process.env['OPENCLAW_GATEWAY_TOKEN'] = origToken;
    else delete process.env['OPENCLAW_GATEWAY_TOKEN'];
  });
});

describe('mesh_delegate tool', () => {
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

  it('mesh_delegate tool is listed', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toContain('mesh_delegate');
  });

  it('returns error when target agent not found', async () => {
    const result = await client.callTool({
      name: 'mesh_delegate',
      arguments: { targetName: 'nonexistent', task: 'do something' },
    });
    const text = (result.content as any)[0].text;
    expect(text).toMatch(/not found/i);
  });

  it('attempts delegation to registered agent', async () => {
    registry.register({
      name: 'helper',
      description: 'Helps',
      capabilities: ['help'],
      endpoint: 'openclaw://agent/helper',
    });

    const result = await client.callTool({
      name: 'mesh_delegate',
      arguments: { targetName: 'helper', task: 'help me' },
    });
    const text = (result.content as any)[0].text;
    const parsed = JSON.parse(text);
    // Agent found but gateway unreachable in test
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
  });
});
