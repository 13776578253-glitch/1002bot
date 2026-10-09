import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { it, type TestContext } from 'node:test';
import { ConversationAgent } from '../../src/agent/conversation-agent.ts';
import { composeRuntime } from '../../src/runtime/compose.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import type { Agent, Event, ExternalTrigger, HeartbeatSource, OutputEvent, ProviderResponse, SessionEntry, SessionStore, ToolCall, ToolExecutionContext, ToolOutcome, WorldEventSink } from '../../src/protocol/index.ts';
import { STANDARD_TRIGGER_LIMITS, legacyWorldTriggerId } from '../../src/protocol/index.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';
import { runTerminal } from '../../src/console/terminal.ts';

function gate<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const done = (content = 'done'): ProviderResponse => ({ toolCalls: [], finishReason: 'stop', message: { role: 'assistant', content } });
const event = (id: string): Event => ({ id, source: 'fixture', type: 'fixture.input', occurredAt: '2020-01-01T00:00:00Z', payload: { text: id } });
const input = (inputId: string) => ({ inputId, source: 'console', content: { kind: 'text' as const, text: inputId } });
const call = (callId: string): ToolCall => ({ callId, toolName: 'fixture.set', arguments: { key: callId, value: 7 } });
class Ticks implements HeartbeatSource {
  readonly callbacks: (() => void)[] = [];
  stops = 0;
  subscribe(tick: () => void) { this.callbacks.push(tick); return () => { this.stops++; }; }
  tick() { this.callbacks.at(-1)!(); }
}
class PerceptionWorld extends FixtureWorld {
  readonly sinks: WorldEventSink[] = [];
  unsubscribed = 0;
  subscribeEvents(sink: WorldEventSink) { this.sinks.push(sink); return () => { this.unsubscribed++; }; }
  push(id: string) { return this.sinks.at(-1)!(event(id)); }
}
async function setup(t: TestContext, responses: ConstructorParameters<typeof ScriptedProvider>[0], options: {
  world?: FixtureWorld; ticks?: Ticks; validityMs?: number; agent?: Agent;
  wrap?: (store: SessionStore) => SessionStore; limits?: { admissionIds?: number; pendingInputs?: number; snapshotEntries?: number }; eventBytes?: number;
} = {}) {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-trigger-')), 'session.jsonl'));
  const world = options.world ?? new PerceptionWorld();
  const runtime = composeRuntime({ world, session: options.wrap?.(store) ?? store, state: new MemoryState(),
    agent: options.agent ?? new ConversationAgent({ sessionId: 'trigger-session' }), provider: new ScriptedProvider(responses),
    ...(options.ticks ? { heartbeat: { source: options.ticks, ...(options.validityMs ? { validityMs: options.validityMs } : {}) } } : {}),
    ...(options.limits ? { inputLimits: options.limits } : {}), ...(options.eventBytes ? { eventBytes: options.eventBytes } : {}) });
  const output: OutputEvent[] = [];
  runtime.triggers.subscribe((value) => output.push(value));
  await runtime.start();
  t.after(() => runtime.stop());
  return { runtime, store, world, output };
}

it('returns accepted before a blocked reception append and waits for it before model execution', { timeout: 3000 }, async (t) => {
  const writing = gate(); const release = gate(); let requests = 0;
  t.after(() => release.resolve());
  const { runtime, store } = await setup(t, () => { requests++; return done(); }, { wrap: (store) => ({
    read: () => store.read(), append: async (entry) => { if (entry.kind === 'trigger_received') { writing.resolve(); await release.promise; } await store.append(entry); },
  }) });
  const receipt = await runtime.triggers.submit({ kind: 'world_event', event: event('blocked') });
  await writing.promise; await turn();
  const before = requests;
  release.resolve(); await runtime.triggers.idle();
  assert.equal(receipt.status, 'accepted'); assert.equal(before, 0); assert.equal(requests, 1);
  assert.equal((await store.read())[0]?.kind, 'trigger_received');
  assert.equal(runtime.triggers.inspect('world_event', legacyWorldTriggerId('blocked'))?.result?.persisted, true);
});

it('serializes Console, World and heartbeat without cancelling the active model or merging triggers', { timeout: 3000 }, async (t) => {
  const started = gate(); const release = gate(); const ticks = new Ticks(); const world = new PerceptionWorld();
  let requests = 0;
  const { runtime, store, output } = await setup(t, async () => { if (requests++ === 0) { started.resolve(); await release.promise; } return done(); }, { world, ticks });
  await runtime.inputs.submit(input('console-first')); await started.promise;
  await world.push('world-next'); ticks.tick(); ticks.tick(); await runtime.inputs.submit(input('console-last'));
  await turn(); const before = requests; const first = runtime.inputs.inspect('console-first')?.status;
  release.resolve(); await runtime.triggers.idle();
  assert.equal(before, 1); assert.equal(first, 'running'); assert.equal(requests, 3);
  assert.deepEqual(output.filter((value) => value.type === 'run_finished').map((value) => value.triggerKind), ['user_input', 'world_event', 'heartbeat', 'user_input']);
  assert.equal(output.find((value) => value.type === 'heartbeat_skipped')?.error?.code, 'heartbeat_pending');
  assert.equal((await store.read()).filter((entry) => entry.kind === 'trigger_received').length, 4);
  assert.equal(runtime.status, 'running');
});

it('keeps queued facts out of active tool continuation and delivers committed history to the next trigger', { timeout: 3000 }, async (t) => {
  const executing = gate(); const release = gate(); const texts: string[][] = [];
  class World extends PerceptionWorld {
    override async executeTool(value: ToolCall, context: ToolExecutionContext) {
      executing.resolve(); await release.promise; return super.executeTool(value, context);
    }
  }
  const { runtime, world } = await setup(t, (request, index) => {
    texts.push(request.messages.filter((message) => message.role === 'user').map((message) => message.content));
    return index === 0 ? { toolCalls: [call('effect')], finishReason: 'tool_calls' } : done();
  }, { world: new World() });
  const first = runtime.handleEvent(event('A')); await executing.promise;
  await (world as World).push('B'); release.resolve(); await first; await runtime.triggers.idle();
  assert.equal(texts.length, 3);
  assert.equal(texts[1]!.some((text) => text.includes('"id":"B"')), false);
  assert.equal(texts[2]!.some((text) => text.includes('"id":"A"')), true);
  assert.equal(texts[2]!.some((text) => text.includes('"id":"B"')), true);
  assert.equal(world.value('effect'), 7);
});

it('keeps reception-only facts outside every Agent context while preserving the Session archive', { timeout: 3000 }, async (t) => {
  const views: SessionEntry[][] = [];
  const agent: Agent = {
    id: 'history-agent', declareSession: () => ({ sessionId: 'history', persistent: true, maxTurns: 2 }),
    initialRequest: async (_event, context) => ({ sessionId: context.session.sessionId, tools: [], messages: [{ role: 'user', content: JSON.stringify(context.history) }] }),
    nextRequest: async () => undefined,
  };
  const { runtime, store } = await setup(t, (request) => { views.push(JSON.parse(request.messages[0]!.content) as SessionEntry[]); return done(); }, { agent });
  await Promise.all([runtime.handleEvent(event('A')), runtime.handleEvent(event('B'))]);
  const delivered = (view: SessionEntry[]) => view.flatMap((entry) => entry.kind === 'event' ? [entry.event.id] : []);
  assert.deepEqual(delivered(views[0]!), ['A']); assert.deepEqual(delivered(views[1]!), ['A', 'B']);
  assert.equal(views.flat().some((entry) => entry.kind === 'trigger_received'), false);
  assert.equal((await store.read()).filter((entry) => entry.kind === 'trigger_received').length, 2);
});

it('returns each handleEvent result independently of snapshot eviction', { timeout: 3000 }, async (t) => {
  const { runtime, output } = await setup(t, (_request, index) => done(`reply-${index}`), { limits: { snapshotEntries: 1 } });
  const results = await Promise.all(['one', 'two', 'three'].map((id) => runtime.handleEvent(event(id))));
  assert.deepEqual(results.map((result) => result.reply), ['reply-0', 'reply-1', 'reply-2']);
  assert.equal(runtime.triggers.inspect('world_event', legacyWorldTriggerId('one')), undefined);
  assert.equal(output.filter((value) => value.type === 'run_finished').length, 3);
});

it('rejects a stale World sink and stale tick after restart and detaches both sources', { timeout: 3000 }, async (t) => {
  const ticks = new Ticks(); const world = new PerceptionWorld();
  const { runtime, store } = await setup(t, [done()], { ticks, world });
  const oldSink = world.sinks[0]!; const oldTick = ticks.callbacks[0]!;
  await runtime.stop(); await runtime.start();
  const before = (await store.read()).length;
  assert.equal((await oldSink(event('late')) as { code: string }).code, 'stale_generation');
  oldTick(); assert.equal((await store.read()).length, before);
  assert.equal((await world.push('current')).status, 'accepted'); await runtime.triggers.idle();
  assert.equal(world.unsubscribed, 1); assert.equal(ticks.stops, 1);
  assert.equal(runtime.triggers.inspect('world_event', legacyWorldTriggerId('current'))?.result?.status, 'succeeded');
});

it('records no-action heartbeats without model calls or external identity exhaustion', { timeout: 3000 }, async (t) => {
  const ticks = new Ticks(); let requests = 0;
  const { runtime, store } = await setup(t, () => { requests++; return done(); }, { ticks, limits: { admissionIds: 1 } });
  for (let index = 0; index < 4; index++) { ticks.tick(); await runtime.triggers.idle(); }
  assert.equal(requests, 0);
  assert.equal((await runtime.inputs.submit(input('external'))).status, 'accepted'); await runtime.triggers.idle();
  assert.equal((await store.read()).filter((entry) => entry.kind === 'heartbeat').length, 4);
  assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: event('separate-world') })).status, 'accepted');
  await runtime.triggers.idle();
  assert.equal((await runtime.inputs.submit(input('exhausted')) as { code: string }).code, 'admission_limit');
  assert.equal(runtime.status, 'running');
});

it('lets the Agent request model and tool work from a heartbeat and returns to waiting', { timeout: 3000 }, async (t) => {
  const ticks = new Ticks();
  const agent = new ConversationAgent({ sessionId: 'heartbeat-session', heartbeatRequest: async (tick, context) => ({
    sessionId: context.session.sessionId, tools: context.tools ?? [], messages: [{ role: 'user', content: JSON.stringify(tick) }],
  }) });
  const { runtime, world, output } = await setup(t, [{ toolCalls: [call('tick-effect')], finishReason: 'tool_calls' }, { toolCalls: [], finishReason: 'stop' }], { ticks, agent });
  ticks.tick(); await runtime.triggers.idle();
  assert.equal(world.value('tick-effect'), 7);
  const final = output.find((value) => value.type === 'run_finished');
  assert.equal(final?.triggerKind, 'heartbeat'); assert.equal(final?.result?.status, 'succeeded');
  assert.equal(runtime.status, 'running');
});

it('expires a queued heartbeat without interrupting the active trigger or calling the model for the tick', { timeout: 3000 }, async (t) => {
  const ticks = new Ticks(); const started = gate(); const release = gate(); let requests = 0;
  const { runtime, store, output } = await setup(t, async () => { requests++; started.resolve(); await release.promise; return done(); }, { ticks, validityMs: 10 });
  const first = runtime.handleEvent(event('active')); await started.promise;
  const expired = new Promise<void>((resolve) => { runtime.triggers.subscribe((value) => { if (value.type === 'run_finished' && value.triggerKind === 'heartbeat') resolve(); }); });
  ticks.tick(); await expired; release.resolve(); await first; await runtime.triggers.idle();
  assert.equal(requests, 1);
  assert.equal(output.find((value) => value.type === 'run_finished' && value.triggerKind === 'heartbeat')?.result?.code, 'trigger_expired');
  assert.equal((await store.read()).filter((entry) => entry.kind === 'trigger_received').length, 2);
});

it('keeps a heartbeat slot occupied while its expired terminal append is blocked', { timeout: 3000 }, async (t) => {
  const ticks = new Ticks(); const started = gate(); const modelRelease = gate(); const writing = gate(); const writeRelease = gate();
  t.after(() => { modelRelease.resolve(); writeRelease.resolve(); });
  const { runtime, store, output } = await setup(t, async () => { started.resolve(); await modelRelease.promise; return done(); }, {
    ticks, validityMs: 10, wrap: (store) => ({ read: () => store.read(), append: async (entry) => {
      if (entry.kind === 'run_finished' && entry.triggerKind === 'heartbeat') { writing.resolve(); await writeRelease.promise; }
      await store.append(entry);
    } }),
  });
  const first = runtime.handleEvent(event('active')); await started.promise;
  ticks.tick(); await writing.promise; ticks.tick();
  writeRelease.resolve(); modelRelease.resolve(); await first; await runtime.triggers.idle();
  assert.equal(output.find((value) => value.type === 'heartbeat_skipped')?.error?.code, 'heartbeat_pending');
  assert.equal((await store.read()).filter((entry) => entry.kind === 'trigger_received').length, 2);
});

it('rejects full mixed queues without consuming IDs and diagnoses skipped heartbeats', { timeout: 3000 }, async (t) => {
  const started = gate(); const release = gate(); const ticks = new Ticks();
  const { runtime, output } = await setup(t, async (_request, index) => { if (index === 0) { started.resolve(); await release.promise; } return done(); }, { ticks, limits: { pendingInputs: 1 } });
  const first = runtime.handleEvent(event('active')); await started.promise;
  await runtime.inputs.submit(input('pending'));
  const rejected = await runtime.triggers.submit({ kind: 'world_event', event: event('retry-id') }); ticks.tick();
  release.resolve(); await first; await runtime.triggers.idle();
  assert.equal((rejected as { code: string }).code, 'queue_full');
  assert.equal(output.find((value) => value.type === 'heartbeat_skipped')?.error?.code, 'queue_full');
  assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: event('retry-id') })).status, 'accepted');
  await runtime.triggers.idle();
});

it('retains old World facts by default, separates kind identities and rejects changed-source duplicates', { timeout: 3000 }, async (t) => {
  const { runtime } = await setup(t, () => done());
  await runtime.inputs.submit(input('same'));
  assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: event('same') })).status, 'accepted');
  await runtime.triggers.idle();
  assert.equal(runtime.triggers.inspect('world_event', legacyWorldTriggerId('same'))?.result?.status, 'succeeded');
  assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: { ...event('same'), source: 'changed' } }) as { code: string }).code, 'duplicate_trigger');
  await runtime.stop(); await runtime.start();
  assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: event('same') }) as { code: string }).code, 'duplicate_trigger');
});

it('diagnoses explicitly expired World facts and preserves their reception without executing', { timeout: 3000 }, async (t) => {
  let requests = 0;
  const { runtime, store } = await setup(t, () => { requests++; return done(); });
  await runtime.triggers.submit({ kind: 'world_event', event: event('expired'), expiresAt: '2020-01-02T00:00:00Z' });
  await runtime.triggers.idle();
  assert.equal(requests, 0); assert.equal(runtime.triggers.inspect('world_event', legacyWorldTriggerId('expired'))?.result?.code, 'trigger_expired');
  assert.equal((await store.read()).filter((entry) => entry.kind === 'trigger_received').length, 1);
});

it('validates Event JSON capacity and identity before allocating a queue sequence', { timeout: 3000 }, async (t) => {
  const { runtime } = await setup(t, () => done(), { eventBytes: 256 });
  const bad = [ { ...event('bad'), occurredAt: 'invalid' }, { ...event('bad'), payload: 'x'.repeat(STANDARD_TRIGGER_LIMITS.eventBytes) }, { ...event('bad'), payload: Number.NaN } ];
  for (const value of bad) assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: value })).status, 'rejected');
  const cyclic = event('bad'); cyclic.payload = { self: cyclic as unknown as never };
  assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: cyclic })).status, 'rejected');
  const forged = { kind: 'heartbeat', id: 'forged', source: 'client', occurredAt: event('x').occurredAt, expiresAt: event('x').occurredAt };
  assert.equal((await runtime.triggers.submit(forged as unknown as ExternalTrigger)).status, 'rejected');
  const valid = await runtime.triggers.submit({ kind: 'world_event', event: event('bad') });
  assert.equal(valid.status, 'accepted'); if (valid.status === 'accepted') assert.equal(valid.queueSequence, 1);
  await runtime.triggers.idle();
});

for (const kind of ['trigger_received', 'provider_request', 'tool_outcome', 'run_finished', 'read'] as const) {
  it(`stops every trigger source after required ${kind} storage fails`, { timeout: 3000 }, async (t) => {
    const brokenDir = await mkdtemp(join(tmpdir(), 'bot-trigger-broken-'));
    await writeFile(join(brokenDir, 'occupied'), 'file');
    const broken = new JsonlSessionStore(join(brokenDir, 'occupied', 'session.jsonl'));
    await writeFile(join(brokenDir, 'corrupt.jsonl'), '{invalid JSON}\n');
    const unreadable = new JsonlSessionStore(join(brokenDir, 'corrupt.jsonl'));
    const started = gate(); const release = gate(); let requests = 0;
    const { runtime, world, output } = await setup(t, async (_request, index) => { requests++; if (index > 0) return done(); started.resolve(); await release.promise; return { toolCalls: [call('effect')], finishReason: 'tool_calls' }; }, { wrap: (store) => ({
      read: () => kind === 'read' ? unreadable.read() : store.read(),
      append: (entry) => entry.kind === kind ? broken.append(entry) : store.append(entry),
    }) });
    const first = runtime.handleEvent(event('failed'));
    const second = runtime.handleEvent(event('queued'));
    if (kind === 'tool_outcome' || kind === 'run_finished') { await started.promise; release.resolve(); }
    else release.resolve();
    const results = await Promise.all([first, second]); await runtime.stop().catch(() => undefined);
    assert.equal(results[0]?.code, 'storage_error'); assert.equal(runtime.status, 'stopped');
    assert.equal(output.filter((value) => value.type === 'run_finished').length, 2);
    assert.equal(world.value('effect'), kind === 'tool_outcome' || kind === 'run_finished' ? 7 : undefined);
    assert.equal(requests, kind === 'run_finished' ? 2 : kind === 'tool_outcome' ? 1 : 0);
    assert.equal((await runtime.inputs.submit(input('later'))).status, 'rejected');
  });
}

for (const failReceipt of [false, true]) {
  it(`stops mixed queued work after a World Event effect throws${failReceipt ? ' and its unknown append fails' : ''}`, { timeout: 3000 }, async (t) => {
    const entered = gate(); const release = gate(); const ticks = new Ticks();
    class World extends PerceptionWorld {
      override async executeTool(value: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
        await super.executeTool(value, context); entered.resolve(); await release.promise; throw new Error('receipt lost');
      }
    }
    let requests = 0;
    const { runtime, world, output } = await setup(t, () => { requests++; return { toolCalls: [call('effect'), call('unexecuted')], finishReason: 'tool_calls' }; }, {
      world: new World(), ticks, wrap: (store) => ({ read: () => store.read(), append: (entry) => {
        if (failReceipt && entry.kind === 'tool_outcome') return Promise.reject(new Error('receipt storage failed'));
        return store.append(entry);
      } }),
    });
    const first = runtime.handleEvent(event('effect-event')); await entered.promise;
    await runtime.inputs.submit(input('waiting')); ticks.tick(); release.resolve(); await first; await runtime.stop();
    assert.equal(requests, 1); assert.equal(world.value('effect'), 7); assert.equal(world.value('unexecuted'), undefined);
    assert.equal(runtime.inputs.inspect('waiting')?.result?.status, 'cancelled');
    const unknown = output.find((value) => value.type === 'tool_finished' && value.callId === 'effect');
    assert.equal(unknown?.status, 'unknown'); assert.equal(unknown?.error?.message, 'receipt lost');
    assert.equal(unknown?.triggerKind, 'world_event'); assert.equal(unknown?.triggerId, legacyWorldTriggerId('effect-event'));
    assert.equal(output.filter((value) => value.type === 'run_finished').length, 3);
  });
}

it('shows World and heartbeat identities in Console while EOF drains the shared queue', { timeout: 3000 }, async (t) => {
  const ticks = new Ticks(); const world = new PerceptionWorld(); const started = gate(); const release = gate();
  const { runtime } = await setup(t, async (_request, index) => { if (index === 0) { started.resolve(); await release.promise; } return done(); }, { ticks, world });
  let display = '';
  const stream = new PassThrough();
  const terminal = runTerminal(runtime, { input: stream, output: new Writable({ write(chunk, _encoding, callback) { display += String(chunk); callback(); } }) });
  stream.write('console\n'); await started.promise;
  await world.push('visible-world'); ticks.tick(); stream.end(); release.resolve(); await terminal;
  assert.ok(display.includes(`[world_event:${legacyWorldTriggerId('visible-world')}] source=fixture`));
  assert.match(display, /\[heartbeat:\d+:\d+\] source=runtime/);
  assert.equal(runtime.status, 'stopped');
});

it('detaches a subscription returned after a synchronous source callback stops startup', { timeout: 3000 }, async (t) => {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-source-start-')), 'session.jsonl'));
  let detached = 0; let requests = 0; let stopping: Promise<void> | undefined;
  class World extends FixtureWorld {
    subscribeEvents(sink: WorldEventSink) { void sink(event('startup')); return () => { detached++; }; }
  }
  const runtime = composeRuntime({ agent: new ConversationAgent({ sessionId: 'startup' }), world: new World(), session: store, state: new MemoryState(),
    provider: new ScriptedProvider(() => { requests++; return done(); }) });
  t.after(() => runtime.stop());
  runtime.triggers.subscribe((value) => { if (value.type === 'queued') stopping = runtime.stop(); });
  await assert.rejects(runtime.start(), /cancelled/); await stopping;
  assert.equal(detached, 1); assert.equal(requests, 0); assert.equal(runtime.status, 'stopped');
  assert.equal((await store.read()).filter((entry) => entry.kind === 'run_finished').at(-1)?.result.status, 'cancelled');
});

it('cleans up a failed World subscription and can start the next generation', { timeout: 3000 }, async (t) => {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-source-fail-')), 'session.jsonl'));
  class World extends PerceptionWorld {
    attempts = 0;
    override subscribeEvents(sink: WorldEventSink) { if (this.attempts++ === 0) throw new Error('subscription failed'); return super.subscribeEvents(sink); }
  }
  const world = new World();
  const runtime = composeRuntime({ agent: new ConversationAgent({ sessionId: 'subscription' }), world, session: store, state: new MemoryState(), provider: new ScriptedProvider([done()]) });
  t.after(() => runtime.stop());
  await assert.rejects(runtime.start(), /subscription failed/);
  assert.equal(runtime.status, 'stopped'); assert.equal(world.lifecycle.at(-1), 'stop');
  await runtime.start(); assert.equal((await world.push('new-source')).status, 'accepted'); await runtime.triggers.idle();
  assert.equal(runtime.triggers.inspect('world_event', legacyWorldTriggerId('new-source'))?.result?.status, 'succeeded');
});
