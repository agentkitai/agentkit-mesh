#!/usr/bin/env node
export { AgentRegistry } from './registry.js';
export type { AgentRecord, RegisterInput } from './registry.js';
export { DiscoveryEngine } from './discovery.js';
export type { DiscoveryResult, DiscoveryProvider } from './discovery.js';
export { DelegationClient } from './delegation.js';
export type { DelegationResult } from './delegation.js';
export { createServer } from './server.js';
export { LoreDiscoveryEngine } from './lore-discovery.js';

// CLI entry point: only start server when run directly via the bin script
const scriptPath = process.argv[1] ?? '';
const isDirectRun =
  scriptPath.endsWith('/agentkit-mesh') ||
  scriptPath.endsWith('\\agentkit-mesh') ||
  (scriptPath.endsWith('/index.js') && scriptPath.includes('agentkit-mesh'));
if (isDirectRun) {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { AgentRegistry: Registry } = await import('./registry.js');
  const { createServer: create } = await import('./server.js');

  const dbPath = process.argv[2] || undefined;
  const registry = new Registry(dbPath);
  const server = create(registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', () => { registry.close(); process.exit(0); });
  process.on('SIGTERM', () => { registry.close(); process.exit(0); });
}
