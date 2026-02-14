import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { DiscoveryEngine } from '../src/discovery.js';

describe('DiscoveryEngine — capability matching', () => {
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
  });

  it('scores results by match ratio', () => {
    const results = engine.discover('web search indexing', registry);
    expect(results[0].agent.name).toBe('search-agent');
  });

  it('respects limit parameter', () => {
    expect(engine.discover('search', registry, 1)).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    expect(engine.discover('quantum physics', registry)).toHaveLength(0);
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
        { uri: 'file://vm1.company.com/home/amit/projects/*' },
        { uri: 'git://github.com/agentkitai/agentlens' },
      ],
      endpoint: 'http://vm1:4001/task',
    });

    registry.register({
      name: 'dev-vm2',
      description: 'Code review and testing',
      capabilities: ['code-review', 'testing'],
      resources: [
        { uri: 'file://vm2.company.com/home/amit/projects/*' },
        { uri: 'git://github.com/company/backend' },
      ],
      endpoint: 'http://vm2:4002/task',
    });

    registry.register({
      name: 'ops-agent',
      description: 'DevOps and deployment',
      capabilities: ['devops', 'deployment'],
      resources: [
        { uri: 'https://api.aws.amazon.com' },
        { uri: 'service://k8s-prod/my-service' },
      ],
      endpoint: 'http://ops:4003/task',
    });
  });

  afterEach(() => { registry.close(); });

  it('filters by filesystem resource on correct host', () => {
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm1.company.com/home/amit/projects/agentlens' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('dev-vm1');
  });

  it('rejects same path on different host', () => {
    // vm2 has /home/amit/projects/* but on vm2, not vm1
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm1.company.com/opt/other' },
    ]);
    expect(results).toHaveLength(0);
  });

  it('same path different hosts are NOT equivalent', () => {
    // Both VMs have /home/amit/projects/*, but require vm1 specifically
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm1.company.com/home/amit/projects/agentlens' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('dev-vm1');

    const results2 = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm2.company.com/home/amit/projects/agentlens' },
    ]);
    expect(results2).toHaveLength(1);
    expect(results2[0].agent.name).toBe('dev-vm2');
  });

  it('returns empty when no agent has the required resource', () => {
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm3.company.com/srv/unknown' },
    ]);
    expect(results).toHaveLength(0);
  });

  it('matches glob patterns within same host', () => {
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm2.company.com/home/amit/projects/backend' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('dev-vm2');
  });

  it('matches git repo resources', () => {
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'git://github.com/agentkitai/agentlens' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('dev-vm1');
  });

  it('matches API resources', () => {
    const results = engine.discover('devops deployment', registry, undefined, [
      { uri: 'https://api.aws.amazon.com' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('ops-agent');
  });

  it('API prefix matching (covers sub-paths)', () => {
    const results = engine.discover('devops deployment', registry, undefined, [
      { uri: 'https://api.aws.amazon.com/ec2/instances' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].agent.name).toBe('ops-agent');
  });

  it('requires ALL resources to match', () => {
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm1.company.com/home/amit/projects/agentlens' },
      { uri: 'https://api.aws.amazon.com' },
    ]);
    expect(results).toHaveLength(0);
  });

  it('includes matched resources in result', () => {
    const results = engine.discover('code review', registry, undefined, [
      { uri: 'file://vm1.company.com/home/amit/projects/agentlens' },
    ]);
    expect(results[0].matchedResources).toHaveLength(1);
    expect(results[0].matchedResources[0].uri).toContain('vm1');
  });

  it('without resource requirements, returns all capability matches', () => {
    const results = engine.discover('code review', registry);
    expect(results.length).toBe(2);
  });
});

describe('uriMatches', () => {
  const engine = new DiscoveryEngine();

  it('exact match', () => {
    expect(engine.uriMatches('file://vm1/foo', 'file://vm1/foo')).toBe(true);
  });

  it('glob match same host', () => {
    expect(engine.uriMatches('file://vm1/foo/*', 'file://vm1/foo/bar')).toBe(true);
    expect(engine.uriMatches('file://vm1/foo/*', 'file://vm1/foo/bar/baz')).toBe(true);
  });

  it('glob does NOT match different host', () => {
    expect(engine.uriMatches('file://vm1/foo/*', 'file://vm2/foo/bar')).toBe(false);
  });

  it('different schemes never match', () => {
    expect(engine.uriMatches('file://vm1/foo', 'git://vm1/foo')).toBe(false);
  });

  it('parent path covers child on same host', () => {
    expect(engine.uriMatches('https://api.github.com', 'https://api.github.com/repos')).toBe(true);
  });

  it('different hosts never match', () => {
    expect(engine.uriMatches('https://api.github.com', 'https://api.gitlab.com/repos')).toBe(false);
  });

  it('service URIs match', () => {
    expect(engine.uriMatches('service://k8s/svc-a', 'service://k8s/svc-a')).toBe(true);
    expect(engine.uriMatches('service://k8s/svc-a', 'service://k8s/svc-b')).toBe(false);
  });
});
