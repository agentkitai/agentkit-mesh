import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DelegationClient } from '../src/delegation.js';
import { AgentRegistry } from '../src/registry.js';
import { createServer } from '../src/server.js';
import { createServer as createHttpServer } from 'http';

// Simple mock agent HTTP server
function createMockAgent(handler?: (body: any) => any) {
  const server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const response = handler ? handler(parsed) : { status: 'completed', result: `Handled: ${parsed.task}` };
      res.writeHead(response._statusCode ?? 200, { 'Content-Type': 'application/json' });
      delete response._statusCode;
      res.end(JSON.stringify(response));
    });
  });
  return server;
}

describe('DelegationClient', () => {
  let mockAgent: ReturnType<typeof createMockAgent>;
  let mockPort: number;

  beforeAll(async () => {
    mockAgent = createMockAgent();
    await new Promise<void>((resolve) => {
      mockAgent.listen(0, () => {
        mockPort = (mockAgent.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => { mockAgent.close(); });

  it('delegates a task and returns result', async () => {
    const dc = new DelegationClient();
    const result = await dc.delegate(`http://localhost:${mockPort}/task`, 'test-id', 'summarize this');
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.result).toContain('Handled: summarize this');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects delegation when depth exceeds max', async () => {
    const dc = new DelegationClient();
    const result = await dc.delegate(`http://localhost:${mockPort}/task`, 'test-id', 'task', { context: { depth: 6 } });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/depth/i);
  });

  it('returns error when agent is unreachable', async () => {
    const dc = new DelegationClient({ timeout: 2000 });
    const result = await dc.delegate('http://localhost:1/task', 'test-id', 'test');
    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('handles 202 async acceptance', async () => {
    const asyncAgent = createMockAgent(() => ({ _statusCode: 202, status: 'accepted' }));
    await new Promise<void>((resolve) => {
      asyncAgent.listen(0, () => resolve());
    });
    const asyncPort = (asyncAgent.address() as any).port;

    const dc = new DelegationClient();
    const result = await dc.delegate(`http://localhost:${asyncPort}/task`, 'test-id', 'long task', { async: true });
    expect(result.success).toBe(true);
    expect(result.status).toBe('accepted');

    asyncAgent.close();
  });

  it('handles agent error response', async () => {
    const errorAgent = createMockAgent(() => ({ _statusCode: 500, error: 'internal error' }));
    await new Promise<void>((resolve) => {
      errorAgent.listen(0, () => resolve());
    });
    const errorPort = (errorAgent.address() as any).port;

    const dc = new DelegationClient();
    const result = await dc.delegate(`http://localhost:${errorPort}/task`, 'test-id', 'fail');
    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('500');

    errorAgent.close();
  });

  it('sends auth header when configured', async () => {
    let receivedHeaders: any;
    const authAgent = createMockAgent((body) => {
      receivedHeaders = body;
      return { status: 'completed', result: 'ok' };
    });
    // Capture headers via a custom server
    const authServer = createHttpServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', result: 'authed' }));
    });
    await new Promise<void>((resolve) => { authServer.listen(0, () => resolve()); });
    const authPort = (authServer.address() as any).port;

    const dc = new DelegationClient();
    await dc.delegate(`http://localhost:${authPort}/task`, 'test-id', 'test', {
      auth: { type: 'bearer', token: 'secret-123' },
    });
    expect(receivedHeaders?.authorization).toBe('Bearer secret-123');

    authServer.close();
  });
});

describe('mesh_delegate tool (MCP)', () => {
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

  afterEach(() => { registry.close(); });

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

  it('logs delegation attempt', async () => {
    registry.register({ name: 'helper', description: 'Helps', capabilities: ['help'], endpoint: 'http://localhost:1/task' });

    await client.callTool({
      name: 'mesh_delegate',
      arguments: { targetName: 'helper', task: 'help me' },
    });

    const delegations = registry.listDelegations();
    expect(delegations.length).toBe(1);
    expect(delegations[0].target_agent).toBe('helper');
    expect(delegations[0].task).toBe('help me');
  });
});
