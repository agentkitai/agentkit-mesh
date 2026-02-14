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
  type: string;
  uri: string;
}

export class DiscoveryEngine {
  /**
   * Discover agents by capability and optionally filter by required resources.
   *
   * If `requiredResources` is provided, only agents that have access to ALL
   * required resources are returned. If no agent matches, returns empty array.
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
          const match = agent.resources.find(r =>
            r.type === req.type && this.resourceMatches(r.uri, req.uri)
          );
          if (match) matchedResources.push(match);
          return !!match;
        });

        if (!allResourcesMatched) continue;
      }

      // Score: capability match ratio, boosted by resource matches
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
   * Check if an agent's resource URI matches a required URI.
   * Supports glob-style matching for filesystem paths.
   *
   * Examples:
   *   "/home/amit/projects/*" matches "/home/amit/projects/agentlens"
   *   "agentkitai/*" matches "agentkitai/agentlens"
   *   "https://api.github.com" matches "https://api.github.com"
   */
  resourceMatches(agentUri: string, requiredUri: string): boolean {
    // Exact match
    if (agentUri === requiredUri) return true;

    // Glob: agent has /foo/* and task needs /foo/bar
    if (agentUri.endsWith('/*')) {
      const prefix = agentUri.slice(0, -1); // remove the *
      if (requiredUri.startsWith(prefix)) return true;
    }

    // Agent has broader path: /home/amit/projects covers /home/amit/projects/agentlens/src
    if (requiredUri.startsWith(agentUri + '/')) return true;
    if (requiredUri.startsWith(agentUri)) return true;

    return false;
  }

  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter(t => t.length > 0);
  }
}
