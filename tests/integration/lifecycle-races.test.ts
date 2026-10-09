import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { Runtime } from '../../src/runtime/runtime.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import type { Agent, Event, SessionEntry, SessionStore, ToolCall, ToolExecutionContext, ToolOutcome } from '../../src/protocol/index.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';
import { TestAgent } from '../fixtures/test-agent.ts';

function gate<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const event: Event = { id: 'race', type: 'fixture.input', source: 'test', occurredAt: '2026-10-05T00:00:00Z', payload: null };
async function session() {
  const directory = await mkdtemp(join(tmpdir(), 'bot-race-'));
  return new JsonlSessionStore(join(directory, 'session.jsonl'));
}
const done = { toolCalls: [], finishReason: 'stop' as const };

for (const failure of [false, true]) {
  it(`ignores an old start ${failure ? 'failure' : 'completion'} after stop and restart`, { timeout: 2000 }, async () => {
    const started = gate();
    const release = gate();
    class World extends FixtureWorld {
      private starts = 0;
      override async start(signal?: AbortSignal) {
        if (this.starts++ === 0) { started.resolve(); await release.promise; }
        if (!signal?.aborted) await super.start();
      }
    }
    const world = new World();
    const runtime = new Runtime({ agent: new TestAgent(), provider: new ScriptedProvider([done]), world, session: await session(), state: new MemoryState() });
    const starting = runtime.start();
    const rejected = assert.rejects(starting);
    await started.promise;
    await runtime.stop();
    await runtime.start();
    if (failure) release.reject(new Error('old start failed')); else release.resolve();
    await rejected;
    try {
      assert.equal(runtime.status, 'running');
      assert.equal(world.lifecycle.filter((item) => item === 'stop').length, 1);
      await runtime.handleEvent(event);
    } finally { await runtime.stop(); }
  });
}

it('keeps concurrent stops on one cleanup while a cancelled start settles', { timeout: 2000 }, async () => {
  const releaseStart = gate();
  const started = gate();
  const cleanup = gate();
  const releaseCleanup = gate();
  class World extends FixtureWorld {
    stops = 0;
    override async start() { started.resolve(); await releaseStart.promise; }
    override async stop() { this.stops++; cleanup.resolve(); await releaseCleanup.promise; }
  }
  const world = new World();
  const runtime = new Runtime({ agent: new TestAgent(), provider: new ScriptedProvider([done]), world, session: await session(), state: new MemoryState(), cleanupDeadlineMs: 1000 });
  const starting = runtime.start();
  const rejected = assert.rejects(starting);
  await started.promise;
  const stopping = runtime.stop();
  await cleanup.promise;
  releaseStart.resolve();
  // Let the old start enter its cancellation handler without waiting on cleanup.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const repeated = runtime.stop();
  releaseCleanup.resolve();
  await Promise.all([rejected, stopping, repeated]);
  assert.equal(world.stops, 1);
  assert.equal(runtime.status, 'stopped');
});

it('drops a delayed history read after stop while retaining admission and terminal facts', { timeout: 2000 }, async () => {
  const store = await session();
  await store.append({ kind: 'event', at: event.occurredAt, event });
  const reading = gate();
  const release = gate();
  const delayed: SessionStore = {
    append: (entry) => store.append(entry),
    read: async () => { reading.resolve(); await release.promise; return store.read(); },
  };
  const runtime = new Runtime({ agent: new TestAgent(), provider: new ScriptedProvider([done]), world: new FixtureWorld(), session: delayed, state: new MemoryState() });
  await runtime.start();
  const handling = runtime.handleEvent(event);
  await reading.promise;
  await runtime.stop();
  release.resolve();
  await handling;
  assert.deepEqual(runtime.trace.map((entry) => entry.kind), ['trigger_received', 'run_finished']);
  assert.equal((await store.read()).length, 3);
});

for (const kind of ['event', 'provider_request', 'provider_response', 'tool_call', 'tool_outcome'] as const) {
  it(`drains an accepted ${kind} write before stop resolves and starts no follow-up work`, { timeout: 2000 }, async () => {
    const store = await session();
    const writing = gate();
    const release = gate();
    const delayed: SessionStore = {
      read: () => store.read(),
      append: async (entry: SessionEntry) => {
        if (entry.kind === kind) { writing.resolve(); await release.promise; }
        await store.append(entry);
      },
    };
    let requests = 0;
    let initialRequests = 0;
    let continuations = 0;
    const baseAgent = new TestAgent();
    const agent: Agent = {
      id: baseAgent.id,
      declareSession: () => baseAgent.declareSession(),
      initialRequest: (input, context) => { initialRequests++; return baseAgent.initialRequest(input, context); },
      nextRequest: async (input, context) => { continuations++; return baseAgent.nextRequest(input, context); },
    };
    const provider = new ScriptedProvider(() => {
      requests++;
      return { toolCalls: [{ callId: 'set', toolName: 'fixture.set', arguments: { key: 'x', value: 1 } }], finishReason: 'tool_calls' };
    });
    const runtime = new Runtime({ agent, provider, world: new FixtureWorld(), session: delayed, state: new MemoryState() });
    await runtime.start();
    const handling = runtime.handleEvent(event);
    await writing.promise;
    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const resolvedBeforeWrite = stopped;
    release.resolve();
    await Promise.all([handling, stopping]);
    assert.equal(resolvedBeforeWrite, false);
    assert.equal(initialRequests, kind === 'event' ? 0 : 1);
    assert.equal(requests, kind === 'event' || kind === 'provider_request' ? 0 : 1);
    assert.equal(continuations, 0);
    const persisted = await store.read();
    assert.equal(persisted.at(-1)?.kind, 'run_finished');
    assert.equal(runtime.trace.some((entry) => entry.kind === kind), true);
    assert.equal(persisted.filter((entry) => entry.kind === 'run_finished').at(-1)?.result.status, 'cancelled');
  });
}

it('blocks restart after an unknown effect and drops its late World receipt', { timeout: 2000 }, async () => {
  const executing = gate();
  const release = gate();
  class World extends FixtureWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      const outcome = await super.executeTool(call, context);
      executing.resolve();
      await release.promise;
      return outcome;
    }
  }
  const store = await session();
  const runtime = new Runtime({ agent: new TestAgent(), provider: new ScriptedProvider([
    { toolCalls: [{ callId: 'old', toolName: 'fixture.set', arguments: { key: 'x', value: 1 } }], finishReason: 'tool_calls' }, done,
  ]), world: new World(), session: store, state: new MemoryState() });
  await runtime.start();
  const handling = runtime.handleEvent(event);
  await executing.promise;
  await runtime.stop();
  await assert.rejects(runtime.start(), /diagnosis/);
  const before = await store.read();
  release.resolve();
  await handling;
  assert.deepEqual(await store.read(), before);
  assert.equal(runtime.diagnosis.status, 'blocked');
  assert.equal(runtime.diagnosis.issues.some(issue => issue.code === 'tool_unknown'), true);
  await runtime.stop();
  const old = (await store.read()).flatMap((entry) => entry.kind === 'tool_outcome' && entry.outcome.callId === 'old' ? [entry.outcome] : []);
  assert.equal(old.length, 1);
  assert.equal(old[0]?.status, 'unknown');
  assert.equal(runtime.trace.some((entry) => entry.kind === 'event' && entry.event.id === 'new'), false);
});

it('drops a late Provider result after a new generation has handled its own event', { timeout: 2000 }, async () => {
  const responding = gate();
  const release = gate();
  const store = await session();
  const provider = new ScriptedProvider(async (_request, index) => {
    if (index === 0) { responding.resolve(); await release.promise; }
    return done;
  });
  const runtime = new Runtime({ agent: new TestAgent(), provider, world: new FixtureWorld(), session: store, state: new MemoryState() });
  await runtime.start();
  const oldHandling = runtime.handleEvent(event);
  await responding.promise;
  await runtime.stop();
  await runtime.start();
  await runtime.handleEvent({ ...event, id: 'current' });
  const before = await store.read();
  release.resolve();
  await oldHandling;
  assert.deepEqual(await store.read(), before);
  assert.equal(runtime.status, 'running');
  await runtime.stop();
});

it('ignores an initial Agent request completed after stop', { timeout: 2000 }, async () => {
  const preparing = gate();
  const release = gate();
  const base = new TestAgent();
  const store = await session();
  const agent: Agent = {
    id: base.id, declareSession: () => base.declareSession(),
    initialRequest: async (input, context) => { preparing.resolve(); await release.promise; return base.initialRequest(input, context); },
    nextRequest: (input, context) => base.nextRequest(input, context),
  };
  let requests = 0;
  const runtime = new Runtime({ agent, provider: new ScriptedProvider(() => { requests++; return done; }), world: new FixtureWorld(), session: store, state: new MemoryState() });
  await runtime.start();
  const handling = runtime.handleEvent(event);
  await preparing.promise;
  await runtime.stop();
  release.resolve();
  await handling;
  assert.equal(requests, 0);
  assert.deepEqual((await store.read()).map((entry) => entry.kind), ['trigger_received', 'event', 'run_started', 'run_finished']);
});

it('gives cleanup a live signal and aborts it when its deadline expires', { timeout: 2000 }, async () => {
  let cleanupSignal: AbortSignal | undefined;
  let abortedAtEntry: boolean | undefined;
  class World extends FixtureWorld {
    override async stop(signal?: AbortSignal) {
      cleanupSignal = signal;
      abortedAtEntry = signal?.aborted;
      await new Promise<void>(() => undefined);
    }
  }
  const runtime = new Runtime({ agent: new TestAgent(), provider: new ScriptedProvider([done]), world: new World(), session: await session(), state: new MemoryState(), cleanupDeadlineMs: 5 });
  await runtime.start();
  await runtime.stop();
  assert.equal(abortedAtEntry, false);
  assert.equal(cleanupSignal?.aborted, true);
});

it('reports a real storage failure only after all accepted writes have settled', { timeout: 2000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-write-error-'));
  await writeFile(join(directory, 'occupied'), 'not a directory');
  const broken = new JsonlSessionStore(join(directory, 'occupied', 'session.jsonl'));
  const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
  const firstWriting = gate();
  const secondWriting = gate();
  const releaseFirst = gate();
  const releaseSecond = gate();
  let writes = 0;
  const delayed: SessionStore = {
    read: () => store.read(),
    append: async (entry) => {
      if (writes++ === 0) {
        firstWriting.resolve(); await releaseFirst.promise; await broken.append(entry);
      } else {
        secondWriting.resolve(); await releaseSecond.promise; await store.append(entry);
      }
    },
  };
  const runtime = new Runtime({ agent: new TestAgent(), provider: new ScriptedProvider([done]), world: new FixtureWorld(), session: delayed, state: new MemoryState() });
  await runtime.start();
  const failedHandling = runtime.handleEvent(event);
  await firstWriting.promise;
  const otherHandling = runtime.handleEvent({ ...event, id: 'other' });
  await secondWriting.promise;
  const stopping = runtime.stop();
  const rejectedStop = assert.rejects(stopping, AggregateError);
  releaseFirst.resolve();
  assert.equal((await failedHandling).code, 'storage_error');
  assert.equal(runtime.status, 'stopping');
  await assert.rejects(runtime.start(), /stopping/);
  releaseSecond.resolve();
  await Promise.all([otherHandling, rejectedStop]);
  assert.equal(runtime.status, 'stopped');
  assert.deepEqual((await store.read()).map((entry) => entry.kind), ['trigger_received', 'run_finished']);
  assert.equal(runtime.trace.some((entry) => entry.kind === 'provider_request'), false);
});
