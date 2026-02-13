import { AgentRecord, AgentRegistry } from './registry.js';

export interface DiscoveryResult {
  agent: AgentRecord;
  score: number;
  matchedTerms: string[];
}

export interface DiscoveryProvider {
  discover(query: string, limit?: number): Promise<DiscoveryResult[]>;
}

export class DiscoveryEngine {
  discover(query: string, registry: AgentRegistry, limit?: number): DiscoveryResult[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    const agents = registry.list();
    const results: DiscoveryResult[] = [];

    for (const agent of agents) {
      const searchText = [
        agent.description.toLowerCase(),
        ...agent.capabilities.map(c => c.toLowerCase()),
      ].join(' ');

      const matchedTerms: string[] = [];
      for (const token of tokens) {
        if (searchText.includes(token)) {
          matchedTerms.push(token);
        }
      }

      if (matchedTerms.length > 0) {
        results.push({
          agent,
          score: matchedTerms.length / tokens.length,
          matchedTerms,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return limit ? results.slice(0, limit) : results;
  }

  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter(t => t.length > 0);
  }
}
