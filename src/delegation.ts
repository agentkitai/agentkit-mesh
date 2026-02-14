/**
 * Delegation Client — HTTP callback-based task delegation.
 *
 * Delegates tasks to agents via their registered HTTP endpoint.
 * Framework-agnostic: any agent that exposes a POST /task endpoint works.
 */

export interface DelegationResult {
  success: boolean;
  status: 'completed' | 'failed' | 'timeout' | 'accepted';
  result?: string;
  error?: string;
  latencyMs: number;
}

export interface AgentAuth {
  type: 'bearer' | 'header' | 'none';
  token?: string;
  headerName?: string;
}

export interface DelegationRequest {
  delegationId: string;
  task: string;
  context?: Record<string, unknown>;
  callbackUrl?: string;
}

const MAX_DEPTH = 5;
const DEFAULT_TIMEOUT = 120_000;

export class DelegationClient {
  private meshBaseUrl: string;
  private timeout: number;

  constructor(opts?: { meshBaseUrl?: string; timeout?: number }) {
    this.meshBaseUrl = (opts?.meshBaseUrl ?? process.env['MESH_BASE_URL'] ?? 'http://localhost:8766').replace(/\/+$/, '');
    this.timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Delegate a task to an agent via its HTTP callback endpoint.
   */
  async delegate(
    endpoint: string,
    delegationId: string,
    task: string,
    opts?: {
      context?: Record<string, unknown>;
      auth?: AgentAuth;
      timeout?: number;
      async?: boolean;
    },
  ): Promise<DelegationResult> {
    const depth = (opts?.context?.depth as number) ?? 0;
    if (depth > MAX_DEPTH) {
      return { success: false, status: 'failed', error: `Delegation depth ${depth} exceeds max ${MAX_DEPTH}`, latencyMs: 0 };
    }

    const start = Date.now();
    const timeout = opts?.timeout ?? this.timeout;

    const body: DelegationRequest = {
      delegationId,
      task,
      context: { ...opts?.context, depth: depth + 1 },
    };

    // If async, include callback URL so agent can POST result back
    if (opts?.async) {
      body.callbackUrl = `${this.meshBaseUrl}/v1/delegations/${delegationId}/result`;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (opts?.auth?.type === 'bearer' && opts.auth.token) {
      headers['Authorization'] = `Bearer ${opts.auth.token}`;
    } else if (opts?.auth?.type === 'header' && opts.auth.headerName && opts.auth.token) {
      headers[opts.auth.headerName] = opts.auth.token;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });

      const latencyMs = Date.now() - start;

      // 202 = async accepted, agent will POST result to callbackUrl
      if (response.status === 202) {
        return { success: true, status: 'accepted', result: 'Task accepted, awaiting async result', latencyMs };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { success: false, status: 'failed', error: `Agent returned ${response.status}: ${text}`, latencyMs };
      }

      const data = await response.json().catch(() => null);
      return {
        success: true,
        status: 'completed',
        result: data?.result ?? JSON.stringify(data),
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
        return { success: false, status: 'timeout', error: `Timed out after ${timeout}ms`, latencyMs };
      }
      return { success: false, status: 'failed', error: err.message ?? String(err), latencyMs };
    }
  }
}
