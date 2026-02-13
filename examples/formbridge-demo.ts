#!/usr/bin/env npx tsx
/**
 * FormBridge Use Case Demo
 *
 * Scenario: HR agent needs to fill an expense form. It discovers the Finance
 * agent for budget-related fields and delegates a budget lookup.
 *
 * Run: npx tsx examples/formbridge-demo.ts
 */
import { AgentRegistry } from '../src/registry.js';
import { DiscoveryEngine } from '../src/discovery.js';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.tmpdir(), `formbridge-demo-${Date.now()}.db`);
const registry = new AgentRegistry(dbPath);

console.log('=== FormBridge Demo: Agent-to-Agent Discovery ===\n');

// Step 1: Register agents
console.log('1. Registering agents...');

const hr = registry.register({
  name: 'hr-agent',
  description: 'Human resources agent for employee info, HR data, and department lookups',
  capabilities: ['employee_info', 'hr_data', 'department'],
  endpoint: 'http://localhost:4001/mcp',
});
console.log(`   ✓ ${hr.name} registered (capabilities: ${hr.capabilities.join(', ')})`);

const finance = registry.register({
  name: 'finance-agent',
  description: 'Finance agent for budget management, cost center lookups, and expense approval',
  capabilities: ['budget', 'cost_center', 'expense_approval'],
  endpoint: 'http://localhost:4002/mcp',
});
console.log(`   ✓ ${finance.name} registered (capabilities: ${finance.capabilities.join(', ')})\n`);

// Step 2: HR agent discovers who can help with budget fields
console.log('2. HR agent discovers agents for "budget cost center"...');
const discovery = new DiscoveryEngine();
const results = discovery.discover('budget cost center for expense form', registry);

for (const r of results) {
  console.log(`   → ${r.agent.name} (score: ${r.score.toFixed(2)}, matched: ${r.matchedTerms.join(', ')})`);
}

// Step 3: Delegation (simulated — real delegation requires running MCP servers)
const bestMatch = results[0];
console.log(`\n3. HR agent would delegate to ${bestMatch.agent.name} at ${bestMatch.agent.endpoint}`);
console.log('   Task: "Get budget and cost center for Engineering department"');
console.log('   (In production, this calls mesh_delegate which connects via MCP)');

console.log('\n=== Demo complete ===');
registry.close();
