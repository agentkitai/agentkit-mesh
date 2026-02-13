import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface DelegationResult {
  success: boolean;
  result?: string;
  error?: string;
  latencyMs: number;
}

const MAX_DEPTH = 3;
const DEFAULT_TIMEOUT = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Delegation timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export class DelegationClient {
  async delegateViaTransport(
    transport: Transport,
    task: string,
    context?: Record<string, any>,
    timeout?: number,
  ): Promise<DelegationResult> {
    const depth = context?.depth ?? 0;
    if (depth > MAX_DEPTH) {
      return { success: false, error: `Delegation depth ${depth} exceeds max ${MAX_DEPTH}`, latencyMs: 0 };
    }

    const start = Date.now();
    const client = new Client({ name: 'delegation-client', version: '0.1.0' });

    try {
      await client.connect(transport);
      const nextContext = { ...context, depth: depth + 1 };

      const response = await withTimeout(
        client.callTool({ name: 'handle_task', arguments: { task, context: nextContext } }),
        timeout ?? DEFAULT_TIMEOUT,
      );

      const text = (response.content as any)?.[0]?.text ?? '';
      return { success: true, result: text, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err), latencyMs: Date.now() - start };
    } finally {
      try { await client.close(); } catch {}
    }
  }

  async delegate(
    targetEndpoint: string,
    task: string,
    context?: Record<string, any>,
    timeout?: number,
  ): Promise<DelegationResult> {
    const depth = context?.depth ?? 0;
    if (depth > MAX_DEPTH) {
      return { success: false, error: `Delegation depth ${depth} exceeds max ${MAX_DEPTH}`, latencyMs: 0 };
    }

    const start = Date.now();
    const client = new Client({ name: 'delegation-client', version: '0.1.0' });

    try {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      const transport = new SSEClientTransport(new URL(targetEndpoint));
      await client.connect(transport);

      const nextContext = { ...context, depth: depth + 1 };
      const response = await withTimeout(
        client.callTool({ name: 'handle_task', arguments: { task, context: nextContext } }),
        timeout ?? DEFAULT_TIMEOUT,
      );

      const text = (response.content as any)?.[0]?.text ?? '';
      return { success: true, result: text, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err), latencyMs: Date.now() - start };
    } finally {
      try { await client.close(); } catch {}
    }
  }
}
