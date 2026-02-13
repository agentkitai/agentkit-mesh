import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoreDiscoveryEngine } from '../src/lore-discovery.js';
import { AgentRegistry } from '../src/registry.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('LoreDiscoveryEngine', () => {
  let registry: AgentRegistry;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `lore-test-${Date.now()}.db`);
    registry = new AgentRegistry(dbPath);
    registry.register({
      name: 'test-agent',
      description: 'A test agent for data processing',
      capabilities: ['data_processing', 'csv_import'],
      endpoint: 'http://localhost:5000/mcp',
    });
  });

  afterEach(() => {
    registry.close();
    try { fs.unlinkSync(dbPath); } catch {}
    vi.restoreAllMocks();
  });

  it('returns results from Lore API when available', async () => {
    const mockResponse = {
      lessons: [
        {
          id: 'lesson-1',
          title: 'data-processor-agent',
          content: 'Agent that processes data and imports CSVs',
          tags: ['data_processing', 'csv_import'],
          score: 0.95,
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const engine = new LoreDiscoveryEngine('http://lore.local:8080', registry);
    const results = await engine.discover('data processing');

    expect(results.length).toBe(1);
    expect(results[0].agent.name).toBe('data-processor-agent');
    expect(results[0].score).toBe(0.95);
    expect(fetch).toHaveBeenCalledWith(
      'http://lore.local:8080/v1/lessons/search',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to text matching when Lore is unavailable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const engine = new LoreDiscoveryEngine('http://lore.local:8080', registry);
    const results = await engine.discover('data processing');

    expect(results.length).toBe(1);
    expect(results[0].agent.name).toBe('test-agent');
    expect(results[0].matchedTerms).toContain('data');
  });

  it('passes API key in authorization header when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lessons: [] }),
    });

    const engine = new LoreDiscoveryEngine('http://lore.local:8080', registry, 'secret-key');
    await engine.discover('anything');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
      }),
    );
  });
});
