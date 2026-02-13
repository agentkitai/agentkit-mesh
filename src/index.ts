#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentRegistry } from './registry.js';
import { createServer } from './server.js';

const dbPath = process.argv[2] || undefined;
const registry = new AgentRegistry(dbPath);
const server = createServer(registry);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', () => { registry.close(); process.exit(0); });
process.on('SIGTERM', () => { registry.close(); process.exit(0); });
