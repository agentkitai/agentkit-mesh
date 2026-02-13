import { AgentRecord, AgentRegistry } from './registry.js';
import { DiscoveryEngine, DiscoveryResult, DiscoveryProvider } from './discovery.js';

interface LoreLesson {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  score?: number;
}

interface LoreSearchResponse {
  lessons: LoreLesson[];
}

export class LoreDiscoveryEngine implements DiscoveryProvider {
  private loreUrl: string;
  private loreApiKey?: string;
  private registry: AgentRegistry;
  private fallback: DiscoveryEngine;

  constructor(loreUrl: string, registry: AgentRegistry, loreApiKey?: string) {
    this.loreUrl = loreUrl.replace(/\/+$/, '');
    this.loreApiKey = loreApiKey;
    this.registry = registry;
    this.fallback = new DiscoveryEngine();
  }

  async discover(query: string, limit?: number): Promise<DiscoveryResult[]> {
    try {
      return await this.discoverViaLore(query, limit);
    } catch {
      // Fall back to text matching
      return this.fallback.discover(query, this.registry, limit);
    }
  }

  private async discoverViaLore(query: string, limit?: number): Promise<DiscoveryResult[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.loreApiKey) {
      headers['Authorization'] = `Bearer ${this.loreApiKey}`;
    }

    const response = await fetch(`${this.loreUrl}/v1/lessons/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, limit: limit ?? 10 }),
    });

    if (!response.ok) {
      throw new Error(`Lore API returned ${response.status}`);
    }

    const data: LoreSearchResponse = await response.json();

    return data.lessons.map((lesson) => ({
      agent: {
        name: lesson.title,
        description: lesson.content,
        capabilities: lesson.tags ?? [],
        endpoint: '',
        protocol: 'mcp',
        registered_at: '',
        last_seen: '',
      },
      score: lesson.score ?? 0.5,
      matchedTerms: lesson.tags ?? [],
    }));
  }

  async publishCapabilities(agent: AgentRecord): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.loreApiKey) {
        headers['Authorization'] = `Bearer ${this.loreApiKey}`;
      }

      const response = await fetch(`${this.loreUrl}/v1/lessons`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: agent.name,
          content: `${agent.description}. Capabilities: ${agent.capabilities.join(', ')}`,
          tags: agent.capabilities,
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
