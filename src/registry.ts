import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface AgentRecord {
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  protocol: string;
  registered_at: string;
  last_seen: string;
}

export interface RegisterInput {
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  protocol?: string;
}

export class AgentRegistry {
  private db: Database.Database;

  constructor(dbPath?: string) {
    if (!dbPath) {
      const dir = path.join(os.homedir(), '.agentkit-mesh');
      fs.mkdirSync(dir, { recursive: true });
      dbPath = path.join(dir, 'registry.db');
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'mcp',
        registered_at TEXT NOT NULL,
        last_seen TEXT NOT NULL
      )
    `);
  }

  register(agent: RegisterInput): AgentRecord {
    if (!agent.name || agent.name.trim().length === 0) {
      throw new Error('Agent name is required');
    }
    if (!agent.endpoint || agent.endpoint.trim().length === 0) {
      throw new Error('Agent endpoint is required');
    }
    const now = new Date().toISOString();
    const capabilities = JSON.stringify(agent.capabilities);
    const protocol = agent.protocol ?? 'mcp';

    this.db.prepare(`
      INSERT INTO agents (name, description, capabilities, endpoint, protocol, registered_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        capabilities = excluded.capabilities,
        endpoint = excluded.endpoint,
        protocol = excluded.protocol,
        last_seen = excluded.last_seen
    `).run(agent.name, agent.description, capabilities, agent.endpoint, protocol, now, now);

    return this.get(agent.name)!;
  }

  unregister(name: string): boolean {
    const result = this.db.prepare('DELETE FROM agents WHERE name = ?').run(name);
    return result.changes > 0;
  }

  list(): AgentRecord[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY name').all() as any[];
    return rows.map(r => this.rowToRecord(r));
  }

  get(name: string): AgentRecord | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as any;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  heartbeat(name: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE agents SET last_seen = ? WHERE name = ?').run(now, name);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: any): AgentRecord {
    return {
      ...row,
      capabilities: JSON.parse(row.capabilities),
    };
  }
}
