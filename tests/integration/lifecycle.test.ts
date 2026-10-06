import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Runtime } from '../../src/runtime/runtime.ts';
import type { Agent, Event, Provider, ProviderRequest, ProviderResponse, SessionStore, StateStore, World, SessionEntry } from '../../src/protocol/index.ts';

class MemorySession implements SessionStore {
  entries: unknown[] = [];
  async append(entry: SessionEntry): Promise<void> { this.entries.push(entry); }
  async read(): Promise<readonly SessionEntry[]> { return this.entries as SessionEntry[]; }
}

const state: StateStore = { get: async () => undefined, set: async () => undefined };
const agent: Agent = {
  id: 'agent',
  declareSession: () => ({ sessionId: 's', maxTurns: 2, persistent: true }),
  initialRequest: async () => ({ sessionId: 's', messages: [], tools: [] }),
  nextRequest: async () => undefined,
};
const event: Event = { id: 'e', type: 'input', source: 'test', occurredAt: new Date().toISOString(), payload: null };

describe('runtime lifecycle', () => {
  it('makes stop idempotent and ignores a provider result arriving after stop', async () => {
    let resolveProvider!: (response: ProviderResponse) => void;
    const provider: Provider = {
      id: 'deferred',
      complete: async (_request: ProviderRequest, _signal: AbortSignal) => new Promise<ProviderResponse>((resolve) => { resolveProvider = resolve; }),
    };
    const world: World = {
      id: 'world', start: async () => undefined, stop: async () => undefined, tools: () => [], executeTool: async () => ({ callId: 'x', toolName: 'x', status: 'unknown' }),
    };
    const session = new MemorySession();
    const runtime = new Runtime({ agent, provider, world, session, state });
    await runtime.start();
    const handling = runtime.handleEvent(event);
    for (let attempt = 0; attempt < 20 && !resolveProvider; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(typeof resolveProvider, 'function');
    await runtime.stop();
    await runtime.stop();
    resolveProvider({ toolCalls: [], finishReason: 'stop' });
    await handling;
    assert.equal(runtime.status, 'stopped');
    assert.equal(session.entries.filter((entry: any) => entry.kind === 'provider_response').length, 0);
  });

  it('cleans up a failed start and can restart with a new generation', async () => {
    let starts = 0;
    const world: World = {
      id: 'world',
      start: async () => { starts += 1; if (starts === 1) throw new Error('start failed'); },
      stop: async () => undefined,
      tools: () => [],
      executeTool: async () => ({ callId: 'x', toolName: 'x', status: 'unknown' }),
    };
    const provider: Provider = { id: 'provider', complete: async () => ({ toolCalls: [], finishReason: 'stop' }) };
    const runtime = new Runtime({ agent, provider, world, session: new MemorySession(), state });
    await assert.rejects(runtime.start(), /start failed/);
    assert.equal(runtime.status, 'stopped');
    const failedGeneration = runtime.generation;
    await runtime.start();
    assert.equal(runtime.status, 'running');
    assert.ok(runtime.generation > failedGeneration);
    await runtime.stop();
  });

  it('does not let a cleanup timeout block stopping the runtime', async () => {
    const world: World = {
      id: 'slow-world',
      start: async () => undefined,
      stop: async () => { await new Promise<void>(() => undefined); },
      tools: () => [],
      executeTool: async () => ({ callId: 'x', toolName: 'x', status: 'unknown' }),
    };
    const runtime = new Runtime({ agent, provider: { id: 'provider', complete: async () => ({ toolCalls: [], finishReason: 'stop' }) }, world, session: new MemorySession(), state, cleanupDeadlineMs: 5 });
    await runtime.start();
    await runtime.stop();
    assert.equal(runtime.status, 'stopped');
  });
});
