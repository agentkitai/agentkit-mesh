import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { DiscoveryEngine } from '../src/discovery.js';
import { DelegationClient } from '../src/delegation.js';
import { createServer as createHttpServer } from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FormBridge Integration', () => {
  let registry: AgentRegistry;
  let dbPath: string;
  let hrServer: ReturnType<typeof createHttpServer>;
  let financeServer: ReturnType<typeof createHttpServer>;
  let hrPort: number;
  let financePort: number;

  beforeAll(async () => {
    // Mock HR agent
    hrServer = createHttpServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'completed', result: JSON.stringify({ employee: 'John', department: 'Engineering' }) }));
      });
    });
    await new Promise<void>(r => { hrServer.listen(0, () => { hrPort = (hrServer.address() as any).port; r(); }); });

    // Mock Finance agent
    financeServer = createHttpServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'completed', result: JSON.stringify({ budget: 50000, currency: 'USD' }) }));
      });
    });
    await new Promise<void>(r => { financeServer.listen(0, () => { financePort = (financeServer.address() as any).port; r(); }); });
  });

  afterAll(() => { hrServer.close(); financeServer.close(); });

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `formbridge-test-${Date.now()}.db`);
    registry = new AgentRegistry(dbPath);

    registry.register({
      name: 'hr-agent',
      description: 'Human resources agent for employee info, HR data, and department lookups',
      capabilities: ['employee_info', 'hr_data', 'department'],
      endpoint: `http://localhost:${hrPort}/task`,
    });

    registry.register({
      name: 'finance-agent',
      description: 'Finance agent for budget management, cost center lookups, and expense approval',
      capabilities: ['budget', 'cost_center', 'expense_approval'],
      endpoint: `http://localhost:${financePort}/task`,
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
  });

  it('full flow: discover → delegate via HTTP callback', async () => {
    const discovery = new DiscoveryEngine();
    const results = discovery.discover('budget lookup', registry);
    const target = results[0].agent;
    expect(target.name).toBe('finance-agent');

    const dc = new DelegationClient();
    const result = await dc.delegate(target.endpoint, 'test-delegation', 'Get budget for Engineering');

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.result).toContain('50000');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('cross-agent collaboration: HR discovers finance, delegates, gets budget', async () => {
    const discovery = new DiscoveryEngine();
    const dc = new DelegationClient();

    // HR agent needs budget info → discovers finance agent
    const financeAgents = discovery.discover('budget', registry);
    expect(financeAgents[0].agent.name).toBe('finance-agent');

    // Delegate to finance
    const budget = await dc.delegate(financeAgents[0].agent.endpoint, 'collab-1', 'Get Engineering budget');
    expect(budget.success).toBe(true);

    // HR agent also gets employee info from itself
    const hrAgents = discovery.discover('employee info', registry);
    expect(hrAgents[0].agent.name).toBe('hr-agent');

    const employee = await dc.delegate(hrAgents[0].agent.endpoint, 'collab-2', 'Get employee John');
    expect(employee.success).toBe(true);
    expect(employee.result).toContain('John');
  });
});
