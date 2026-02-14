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

  afterEach(() => { registry.close(); });

  it('finds agents matching query tokens', () => {
    const results = engine.discover('search', registry);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('scores results by match ratio', () => {
    const results = engine.discover('web search indexing', registry);
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

describe('Resource-aware discovery', () => {
  let registry: AgentRegistry;
  let engine: DiscoveryEngine;

  beforeEach(() => {
    registry = new AgentRegistry(':memory:');
    engine = new DiscoveryEngine();

    registry.register({
      name: 'dev-vm1',
      description: 'Code review and debugging',
      capabilities: ['code-review', 'debugging'],
      resources: [
        { type: 'filesystem', uri: '/home/amit/projects/*' },
        { type: 'git', uri: 'agentkitai/agentlens' },
      ],
      endpoint: 'http://vm1:4001/task',
    });

    registry.register({
      name: 'dev-vm2',
      description: 'Code review and testing',
      capabilities: ['code-review', 'testing'],
      resources: [
        { type: 'filesystem', uri: '/opt/company/services/*' },
        { type: 'git', uri: 'company/backend' },
      ],
      endpoint: 'http://vm2:4002/task',
    });

    registry.register({
      name: 'ops-agent',
      description: 'DevOps and deployment',
      capabilities: ['devops', 'deployment'],
      resources: [
        { type: 'api', uri: 'https://api.aws.amazon.com' },
        { type: 'service', uri: 'kubernetes-cluster-prod' },
      ],
      endpoint: 'http://ops:4003/task',
    });
  });

  afterEach(() => { registry.close(); });

  it('filters by required filesystem resource', () => {
    const results = engine.discover('code review', registry, undefined, [
      { type: 'filesystem', uri: '/home/amit/projects/agentlens' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('dev-vm1');
  });

  it('returns empty when no agent has the required resource', () => {
    const results = engine.discover('code review', registry, undefined, [
      { type: 'filesystem', uri: '/srv/unknown/path' },
    ]);
    expect(results).toHaveLength(0);
  });

  it('matches glob patterns', () => {
    const results = engine.discover('code review', registry, undefined, [
      { type: 'filesystem', uri: '/opt/company/services/auth' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('dev-vm2');
  });

  it('matches git repo resources', () => {
    const results = engine.discover('code review', registry, undefined, [
      { type: 'git', uri: 'agentkitai/agentlens' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('dev-vm1');
  });

  it('matches API resources', () => {
    const results = engine.discover('devops deployment', registry, undefined, [
      { type: 'api', uri: 'https://api.aws.amazon.com' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('ops-agent');
  });

  it('requires ALL resources to match', () => {
    // dev-vm1 has filesystem but not the API
    const results = engine.discover('code review', registry, undefined, [
      { type: 'filesystem', uri: '/home/amit/projects/agentlens' },
      { type: 'api', uri: 'https://api.aws.amazon.com' },
    ]);
    expect(results).toHaveLength(0);
  });

  it('includes matched resources in result', () => {
    const results = engine.discover('code review', registry, undefined, [
      { type: 'filesystem', uri: '/home/amit/projects/agentlens' },
    ]);
    expect(results[0].matchedResources).toHaveLength(1);
    expect(results[0].matchedResources[0].type).toBe('filesystem');
  });

  it('without resource requirements, returns all capability matches', () => {
    const results = engine.discover('code review', registry);
    expect(results.length).toBe(2); // dev-vm1 and dev-vm2
  });

  it('resource-filtered results include score boost', () => {
    const results = engine.discover('code review', registry, undefined, [
      { type: 'filesystem', uri: '/home/amit/projects/agentlens' },
    ]);
    // Only dev-vm1 matches, and score should be boosted above base capability score
    expect(results).toHaveLength(1);
    // Base capability score would be 1.0 (both tokens match), resource boost adds 0.2
    // but capped at 1.0
    expect(results[0].score).toBe(1);
  });
});

describe('resourceMatches', () => {
  const engine = new DiscoveryEngine();

  it('exact match', () => {
    expect(engine.resourceMatches('/foo/bar', '/foo/bar')).toBe(true);
  });

  it('glob match', () => {
    expect(engine.resourceMatches('/foo/*', '/foo/bar')).toBe(true);
    expect(engine.resourceMatches('/foo/*', '/foo/bar/baz')).toBe(true);
  });

  it('parent path covers child', () => {
    expect(engine.resourceMatches('/home/amit/projects', '/home/amit/projects/agentlens/src')).toBe(true);
  });

  it('no match for unrelated paths', () => {
    expect(engine.resourceMatches('/opt/data', '/home/amit/projects')).toBe(false);
  });

  it('URL exact match', () => {
    expect(engine.resourceMatches('https://api.github.com', 'https://api.github.com')).toBe(true);
  });
});
