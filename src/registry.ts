import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface AgentAuth {
  type: 'bearer' | 'header' | 'none';
  token?: string;
  headerName?: string;
}

export type ResourceType = 'filesystem' | 'git' | 'api' | 'database' | 'service';

export interface AgentResource {
  type: ResourceType;
  /** Filesystem path (glob supported), git repo, API base URL, DB connection name, etc. */
  uri: string;
  /** Human description (optional) */
  description?: string;
  /** Access level */
  access?: 'read' | 'write' | 'admin';
}

export interface AgentRecord {
  name: string;
  description: string;
  capabilities: string[];
  resources: AgentResource[];
  endpoint: string;
  protocol: string;
  auth?: AgentAuth;
  registered_at: string;
  last_seen: string;
}

export interface RegisterInput {
  name: string;
  description: string;
  capabilities: string[];
  resources?: AgentResource[];
  endpoint: string;
  protocol?: string;
  auth?: AgentAuth;
}

export type DelegationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'accepted';

export interface DelegationRecord {
  id: string;
  source_agent: string;
  target_agent: string;
  task: string;
  status: DelegationStatus;
  result: string | null;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
  updated_at: string;
}

export class AgentRegistry {
  private db: Database.Database;

  constructor(dbPath?: string) {
    if (!dbPath && dbPath !== ':memory:') {
      const dir = path.join(os.homedir(), '.agentkit-mesh');
      fs.mkdirSync(dir, { recursive: true });
      dbPath = path.join(dir, 'registry.db');
    }
    this.db = new Database(dbPath!);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        resources TEXT NOT NULL DEFAULT '[]',
        endpoint TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'http',
        auth TEXT,
        registered_at TEXT NOT NULL,
        last_seen TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delegations (
        id TEXT PRIMARY KEY,
        source_agent TEXT NOT NULL,
        target_agent TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        error TEXT,
        latency_ms INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    // Schema upgrades
    try { this.db.exec('ALTER TABLE agents ADD COLUMN auth TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE agents ADD COLUMN resources TEXT NOT NULL DEFAULT \'[]\''); } catch {}
    try { this.db.exec('ALTER TABLE delegations ADD COLUMN updated_at TEXT NOT NULL DEFAULT ""'); } catch {}
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
    const resources = JSON.stringify(agent.resources ?? []);
    const protocol = agent.protocol ?? 'http';
    const auth = agent.auth ? JSON.stringify(agent.auth) : null;

    this.db.prepare(`
      INSERT INTO agents (name, description, capabilities, resources, endpoint, protocol, auth, registered_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        capabilities = excluded.capabilities,
        resources = excluded.resources,
        endpoint = excluded.endpoint,
        protocol = excluded.protocol,
        auth = excluded.auth,
        last_seen = excluded.last_seen
    `).run(agent.name, agent.description, capabilities, resources, agent.endpoint, protocol, auth, now, now);

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

  logDelegation(record: Omit<DelegationRecord, 'created_at' | 'updated_at'>): DelegationRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO delegations (id, source_agent, target_agent, task, status, result, error, latency_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.source_agent, record.target_agent, record.task, record.status,
           record.result ?? null, record.error ?? null, record.latency_ms ?? null, now, now);
    return { ...record, created_at: now, updated_at: now };
  }

  updateDelegation(id: string, update: { status: DelegationStatus; result?: string; error?: string; latency_ms?: number }): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE delegations SET status = ?, result = COALESCE(?, result), error = COALESCE(?, error),
        latency_ms = COALESCE(?, latency_ms), updated_at = ?
      WHERE id = ?
    `).run(update.status, update.result ?? null, update.error ?? null, update.latency_ms ?? null, now, id);
    return result.changes > 0;
  }

  listDelegations(limit = 50, offset = 0): DelegationRecord[] {
    return this.db.prepare('SELECT * FROM delegations ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as DelegationRecord[];
  }

  getDelegation(id: string): DelegationRecord | null {
    return (this.db.prepare('SELECT * FROM delegations WHERE id = ?').get(id) as DelegationRecord) ?? null;
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: any): AgentRecord {
    const record: AgentRecord = {
      ...row,
      capabilities: JSON.parse(row.capabilities),
      resources: JSON.parse(row.resources ?? '[]'),
    };
    if (row.auth) {
      record.auth = JSON.parse(row.auth);
    }
    return record;
  }
}
