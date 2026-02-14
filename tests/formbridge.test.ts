import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { DiscoveryEngine } from '../src/discovery.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FormBridge Integration', () => {
  let registry: AgentRegistry;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `formbridge-test-${Date.now()}.db`);
    registry = new AgentRegistry(dbPath);

    registry.register({
      name: 'hr-agent',
      description: 'Human resources agent for employee info, HR data, and department lookups',
      capabilities: ['employee_info', 'hr_data', 'department'],
      endpoint: 'openclaw://agent/hr',
    });

    registry.register({
      name: 'finance-agent',
      description: 'Finance agent for budget management, cost center lookups, and expense approval',
      capabilities: ['budget', 'cost_center', 'expense_approval'],
      endpoint: 'openclaw://agent/finance',
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

  it('discovers HR agent for employee queries', () => {
    const discovery = new DiscoveryEngine();
    const results = discovery.discover('employee department info', registry);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].agent.name).toBe('hr-agent');
  });

  it('discovery returns both agents for cross-domain query', () => {
    const discovery = new DiscoveryEngine();
    const results = discovery.discover('department budget employee', registry);

    expect(results.length).toBe(2);
  });
});
