import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { DiscoveryEngine } from '../src/discovery.js';
import { DelegationClient } from '../src/delegation.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FormBridge Integration', () => {
  let registry: AgentRegistry;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `formbridge-test-${Date.now()}.db`);
    registry = new AgentRegistry(dbPath);

    // Register HR agent
    registry.register({
      name: 'hr-agent',
      description: 'Human resources agent for employee info, HR data, and department lookups',
      capabilities: ['employee_info', 'hr_data', 'department'],
      endpoint: 'http://localhost:4001/mcp',
    });

    // Register Finance agent
    registry.register({
      name: 'finance-agent',
      description: 'Finance agent for budget management, cost center lookups, and expense approval',
      capabilities: ['budget', 'cost_center', 'expense_approval'],
      endpoint: 'http://localhost:4002/mcp',
    });
  });

  afterEach(() => {
    registry.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('discovers finance agent when HR needs budget info', () => {
    const discovery = new DiscoveryEngine();
    const results = discovery.discover('budget cost center for expense form', registry);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].agent.name).toBe('finance-agent');
    expect(results[0].matchedTerms).toContain('budget');
  });

  it('full flow: register → discover → delegate via transport', async () => {
    const discovery = new DiscoveryEngine();

    // Discover finance agent
    const results = discovery.discover('budget lookup', registry);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const target = results[0].agent;
    expect(target.name).toBe('finance-agent');

    // Create a mock finance MCP server
    const financeServer = new McpServer({ name: 'finance-agent', version: '0.1.0' });
    financeServer.tool(
      'handle_task',
      'Handle a delegated task',
      { task: z.string(), context: z.any().optional() },
      async ({ task }) => {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ budget: 50000, currency: 'USD', department: 'Engineering' }) }],
        };
      },
    );

    // Connect via in-memory transport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await financeServer.connect(serverTransport);

    const delegationClient = new DelegationClient();
    const result = await delegationClient.delegateViaTransport(clientTransport, 'Get budget for Engineering department');

    expect(result.success).toBe(true);
    expect(result.result).toContain('50000');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    await financeServer.close();
  });
});
