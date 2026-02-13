import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { DelegationClient, DelegationResult } from '../src/delegation.js';
import { AgentRegistry } from '../src/registry.js';
import { createServer } from '../src/server.js';

/** Create a mock target agent that has a handle_task tool */
function createMockTargetServer(handler?: (task: string, context: any) => string): McpServer {
  const server = new McpServer({ name: 'mock-target', version: '0.1.0' });
  server.tool(
    'handle_task',
    'Handle a delegated task',
    { task: z.string(), context: z.record(z.string(), z.unknown()).optional() },
    async ({ task, context }) => {
      const result = handler ? handler(task, context) : `Handled: ${task}`;
      return { content: [{ type: 'text' as const, text: result }] };
    }
  );
  return server;
}

describe('DelegationClient', () => {
  it('delegates a task to a target agent and returns result', async () => {
    const target = createMockTargetServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await target.connect(serverTransport);

    const dc = new DelegationClient();
    const result = await dc.delegateViaTransport(clientTransport, 'summarize this doc', {});

    expect(result.success).toBe(true);
    expect(result.result).toBe('Handled: summarize this doc');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('tracks latency in result', async () => {
    const target = createMockTargetServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await target.connect(serverTransport);

    const dc = new DelegationClient();
    const result = await dc.delegateViaTransport(clientTransport, 'test', {});

    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects delegation when depth exceeds max', async () => {
    const dc = new DelegationClient();
    const target = createMockTargetServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await target.connect(serverTransport);

    const result = await dc.delegateViaTransport(clientTransport, 'task', { depth: 4 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/depth/i);
  });

  it('increments depth in context passed to target', async () => {
    let receivedContext: any;
    const target = createMockTargetServer((task, ctx) => {
      receivedContext = ctx;
      return 'ok';
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await target.connect(serverTransport);

    const dc = new DelegationClient();
    await dc.delegateViaTransport(clientTransport, 'task', { depth: 1 });

    expect(receivedContext).toBeDefined();
    expect(receivedContext.depth).toBe(2);
  });

  it('returns error result on target failure', async () => {
    const target = new McpServer({ name: 'broken', version: '0.1.0' });
    // No handle_task tool registered — calling it should error
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await target.connect(serverTransport);

    const dc = new DelegationClient();
    const result = await dc.delegateViaTransport(clientTransport, 'task', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
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
      arguments: { targetName: 'nonexistent', task: 'do something', context: '{}' },
    });
    const text = (result.content as any)[0].text;
    expect(text).toMatch(/not found/i);
  });

  it('delegates to a registered agent', async () => {
    // Register an agent — we can't actually connect to it in this test,
    // so we expect the delegation to fail with a connection error (not "not found")
    registry.register({
      name: 'helper',
      description: 'Helps',
      capabilities: ['help'],
      endpoint: 'http://localhost:59999',
    });

    const result = await client.callTool({
      name: 'mesh_delegate',
      arguments: { targetName: 'helper', task: 'help me' },
    });
    const text = (result.content as any)[0].text;
    // It should attempt delegation (agent was found) but fail on connection
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
  });
});
