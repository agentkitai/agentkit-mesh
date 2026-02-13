import { describe, it, expect } from 'vitest';

describe('Package exports', () => {
  it('exports all public API from main entry', async () => {
    const mod = await import('../src/index.js');
    expect(mod.AgentRegistry).toBeDefined();
    expect(mod.DiscoveryEngine).toBeDefined();
    expect(mod.DelegationClient).toBeDefined();
    expect(mod.createServer).toBeDefined();
    expect(mod.LoreDiscoveryEngine).toBeDefined();
  });
});
