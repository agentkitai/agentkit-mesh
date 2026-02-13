import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../src/registry.js';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry(':memory:');
  });

  afterEach(() => {
    registry.close();
  });

  it('registers and retrieves an agent', () => {
    const agent = registry.register({
      name: 'test-agent',
      description: 'A test agent',
      capabilities: ['search', 'summarize'],
      endpoint: 'http://localhost:3000',
    });

    expect(agent.name).toBe('test-agent');
    expect(agent.capabilities).toEqual(['search', 'summarize']);
    expect(agent.protocol).toBe('mcp');

    const retrieved = registry.get('test-agent');
    expect(retrieved).toEqual(agent);
  });

  it('upserts on duplicate name', () => {
    registry.register({
      name: 'agent-a',
      description: 'Version 1',
      capabilities: ['old'],
      endpoint: 'http://localhost:1',
    });

    registry.register({
      name: 'agent-a',
      description: 'Version 2',
      capabilities: ['new'],
      endpoint: 'http://localhost:2',
    });

    const agents = registry.list();
    expect(agents).toHaveLength(1);
    expect(agents[0].description).toBe('Version 2');
    expect(agents[0].capabilities).toEqual(['new']);
  });

  it('unregisters an agent', () => {
    registry.register({
      name: 'to-remove',
      description: 'Temp',
      capabilities: [],
      endpoint: 'http://localhost:1',
    });

    expect(registry.unregister('to-remove')).toBe(true);
    expect(registry.get('to-remove')).toBeNull();
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('lists all agents', () => {
    registry.register({ name: 'a', description: 'd', capabilities: [], endpoint: 'e' });
    registry.register({ name: 'b', description: 'd', capabilities: [], endpoint: 'e' });
    registry.register({ name: 'c', description: 'd', capabilities: [], endpoint: 'e' });

    expect(registry.list()).toHaveLength(3);
  });

  it('updates heartbeat timestamp', async () => {
    registry.register({ name: 'heartbeat-test', description: 'd', capabilities: [], endpoint: 'e' });
    const before = registry.get('heartbeat-test')!.last_seen;

    await new Promise(r => setTimeout(r, 50));

    expect(registry.heartbeat('heartbeat-test')).toBe(true);
    const after = registry.get('heartbeat-test')!.last_seen;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect(registry.heartbeat('nonexistent')).toBe(false);
  });
});
