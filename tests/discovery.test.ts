import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { DiscoveryEngine } from '../src/discovery.js';

describe('DiscoveryEngine', () => {
  let registry: AgentRegistry;
  let engine: DiscoveryEngine;

  beforeEach(() => {
    registry = new AgentRegistry(':memory:');
    engine = new DiscoveryEngine();

    registry.register({ name: 'search-agent', description: 'Web search and indexing', capabilities: ['search', 'index'], endpoint: 'http://localhost:1' });
    registry.register({ name: 'code-agent', description: 'Code generation and review', capabilities: ['code', 'review'], endpoint: 'http://localhost:2' });
    registry.register({ name: 'data-agent', description: 'Data analysis and search', capabilities: ['data', 'search'], endpoint: 'http://localhost:3' });
  });

  afterEach(() => {
    registry.close();
  });

  it('finds agents matching query tokens', () => {
    const results = engine.discover('search', registry);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('scores results by match ratio', () => {
    const results = engine.discover('web search indexing', registry);
    // search-agent matches 'web', 'search', 'indexing' → highest score
    expect(results[0].agent.name).toBe('search-agent');
  });

  it('respects limit parameter', () => {
    const results = engine.discover('search', registry, 1);
    expect(results).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    const results = engine.discover('quantum physics', registry);
    expect(results).toHaveLength(0);
  });
});
