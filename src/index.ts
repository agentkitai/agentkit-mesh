#!/usr/bin/env node
export { AgentRegistry } from './registry.js';
export type { AgentRecord, RegisterInput } from './registry.js';
export { DiscoveryEngine } from './discovery.js';
export type { DiscoveryResult, DiscoveryProvider } from './discovery.js';
export { DelegationClient } from './delegation.js';
export type { DelegationResult } from './delegation.js';
export { createServer } from './server.js';
export { LoreDiscoveryEngine } from './lore-discovery.js';

export { createHttpServer } from './http-server.js';
export type { DelegationRecord } from './registry.js';

// CLI entry point: only start server when run directly via the bin script
const scriptPath = process.argv[1] ?? '';
const isDirectRun =
  scriptPath.endsWith('/agentkit-mesh') ||
  scriptPath.endsWith('\\agentkit-mesh') ||
  scriptPath.endsWith('/index.js');
if (isDirectRun) {
  const command = process.argv[2];

  if (command === 'serve') {
    // HTTP server mode
    const args = process.argv.slice(3);
    let port = 8766;
    let dbPath: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
      if (args[i] === '--db' && args[i + 1]) dbPath = args[++i];
    }
    dbPath = dbPath ?? process.env.DB_PATH;

    const { AgentRegistry: Registry } = await import('./registry.js');
    const { createHttpServer } = await import('./http-server.js');
    const registry = new Registry(dbPath);
    const server = createHttpServer(registry, port);

    process.on('SIGINT', () => { registry.close(); server.close(); process.exit(0); });
    process.on('SIGTERM', () => { registry.close(); server.close(); process.exit(0); });
  } else {
    // MCP stdio mode (default)
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
}
