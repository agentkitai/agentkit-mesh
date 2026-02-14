/**
 * Delegation Client — routes tasks to agents via OpenClaw gateway API.
 *
 * Instead of MCP SSE (which never worked for openclaw:// endpoints),
 * this delegates via OpenClaw's sessions API — the same mechanism
 * agents use to talk to each other.
 */

export interface DelegationResult {
  success: boolean;
  result?: string;
  error?: string;
  latencyMs: number;
}

export interface DelegationConfig {
  /** OpenClaw gateway URL (default: http://localhost:18789) */
  gatewayUrl?: string;
  /** OpenClaw gateway auth token */
  gatewayToken?: string;
  /** Timeout in ms (default: 120_000) */
  timeout?: number;
}

const MAX_DEPTH = 3;
const DEFAULT_TIMEOUT = 120_000;

export class DelegationClient {
  private gatewayUrl: string;
  private gatewayToken: string | undefined;
  private timeout: number;

  constructor(config?: DelegationConfig) {
    this.gatewayUrl = (config?.gatewayUrl ?? process.env['OPENCLAW_GATEWAY_URL'] ?? 'http://localhost:18789').replace(/\/+$/, '');
    this.gatewayToken = config?.gatewayToken ?? process.env['OPENCLAW_GATEWAY_TOKEN'];
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Delegate a task to an agent via OpenClaw sessions.
   *
   * @param agentId - OpenClaw agent ID (e.g., "dev", "coach", "biz")
   * @param task - Task description
   * @param context - Optional context (includes depth tracking)
   */
  async delegate(
    agentId: string,
    task: string,
    context?: Record<string, any>,
  ): Promise<DelegationResult> {
    const depth = context?.depth ?? 0;
    if (depth > MAX_DEPTH) {
      return { success: false, error: `Delegation depth ${depth} exceeds max ${MAX_DEPTH}`, latencyMs: 0 };
    }

    const start = Date.now();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.gatewayToken) {
        headers['Authorization'] = `Bearer ${this.gatewayToken}`;
      }

      // Use OpenClaw's spawn endpoint to run task in isolated session
      const response = await fetch(`${this.gatewayUrl}/api/sessions/spawn`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agentId,
          task,
          runTimeoutSeconds: Math.floor(this.timeout / 1000),
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          success: false,
          error: `Gateway returned ${response.status}: ${body}`,
          latencyMs: Date.now() - start,
        };
      }

      const data = await response.json();
      return {
        success: true,
        result: data.result ?? data.message ?? JSON.stringify(data),
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Send a message to an existing agent session (fire-and-forget).
   */
  async send(
    agentId: string,
    message: string,
  ): Promise<DelegationResult> {
    const start = Date.now();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.gatewayToken) {
        headers['Authorization'] = `Bearer ${this.gatewayToken}`;
      }

      const response = await fetch(`${this.gatewayUrl}/api/sessions/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agentId, message }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return { success: false, error: `Gateway returned ${response.status}: ${body}`, latencyMs: Date.now() - start };
      }

      return { success: true, result: 'Message sent', latencyMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err), latencyMs: Date.now() - start };
    }
  }
}
