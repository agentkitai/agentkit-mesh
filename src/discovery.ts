import { AgentRecord, AgentRegistry, AgentResource } from './registry.js';

export interface DiscoveryResult {
  agent: AgentRecord;
  score: number;
  matchedCapabilities: string[];
  matchedResources: AgentResource[];
}

export interface DiscoveryProvider {
  discover(query: string, limit?: number): Promise<DiscoveryResult[]>;
}

export interface ResourceRequirement {
  uri: string;
}

export class DiscoveryEngine {
  /**
   * Discover agents by capability and optionally filter by required resources.
   *
   * If `requiredResources` is provided, only agents that have access to ALL
   * required resources are returned. URI matching is scheme+host aware:
   *   file://vm1/foo/* matches file://vm1/foo/bar but NOT file://vm2/foo/bar
   */
  discover(
    query: string,
    registry: AgentRegistry,
    limit?: number,
    requiredResources?: ResourceRequirement[],
  ): DiscoveryResult[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    const agents = registry.list();
    const results: DiscoveryResult[] = [];

    for (const agent of agents) {
      // Match capabilities
      const searchText = [
        agent.description.toLowerCase(),
        ...agent.capabilities.map(c => c.toLowerCase()),
      ].join(' ');

      const matchedCapabilities: string[] = [];
      for (const token of tokens) {
        if (searchText.includes(token)) {
          matchedCapabilities.push(token);
        }
      }

      if (matchedCapabilities.length === 0) continue;

      // Match resources (if required)
      const matchedResources: AgentResource[] = [];
      if (requiredResources && requiredResources.length > 0) {
        const allResourcesMatched = requiredResources.every(req => {
          const match = agent.resources.find(r => this.uriMatches(r.uri, req.uri));
          if (match) matchedResources.push(match);
          return !!match;
        });

        if (!allResourcesMatched) continue;
      }

      const capabilityScore = matchedCapabilities.length / tokens.length;
      const resourceBoost = requiredResources?.length
        ? matchedResources.length / requiredResources.length * 0.2
        : 0;

      results.push({
        agent,
        score: Math.min(capabilityScore + resourceBoost, 1),
        matchedCapabilities,
        matchedResources,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Check if an agent's URI covers a required URI.
   *
   * Rules:
   * 1. Scheme + host must match exactly (file://vm1 ≠ file://vm2)
   * 2. Path supports glob (* suffix) and parent-covers-child
   * 3. Non-file URIs: exact match or prefix match
   *
   * Examples:
   *   file://vm1/projects/*  matches  file://vm1/projects/agentlens
   *   file://vm1/projects/*  does NOT match  file://vm2/projects/agentlens
   *   git://github.com/org/* matches  git://github.com/org/repo
   *   https://api.github.com matches  https://api.github.com/repos
   */
  uriMatches(agentUri: string, requiredUri: string): boolean {
    if (agentUri === requiredUri) return true;

    let agentParsed: URL | null = null;
    let requiredParsed: URL | null = null;

    try {
      agentParsed = new URL(agentUri);
      requiredParsed = new URL(requiredUri);
    } catch {
      // If either isn't a valid URL, fall back to string prefix matching
      return this.stringPrefixMatch(agentUri, requiredUri);
    }

    // Scheme must match
    if (agentParsed.protocol !== requiredParsed.protocol) return false;

    // Host must match (includes port)
    if (agentParsed.host !== requiredParsed.host) return false;

    // Path matching
    const agentPath = agentParsed.pathname;
    const requiredPath = requiredParsed.pathname;

    return this.pathMatches(agentPath, requiredPath);
  }

  private pathMatches(agentPath: string, requiredPath: string): boolean {
    if (agentPath === requiredPath) return true;

    // Glob: /foo/* matches /foo/bar and /foo/bar/baz
    if (agentPath.endsWith('/*')) {
      const prefix = agentPath.slice(0, -1); // "/foo/"
      if (requiredPath.startsWith(prefix)) return true;
    }

    // Parent covers child: /foo covers /foo/bar
    // Special case: root "/" covers everything
    if (agentPath === '/' && requiredPath.startsWith('/')) return true;
    if (requiredPath.startsWith(agentPath + '/')) return true;

    return false;
  }

  private stringPrefixMatch(agentUri: string, requiredUri: string): boolean {
    if (agentUri.endsWith('/*')) {
      const prefix = agentUri.slice(0, -1);
      return requiredUri.startsWith(prefix);
    }
    return requiredUri.startsWith(agentUri + '/') || requiredUri.startsWith(agentUri);
  }

  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter(t => t.length > 0);
  }
}
