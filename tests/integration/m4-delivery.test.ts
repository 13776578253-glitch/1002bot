import assert from 'node:assert/strict';
import { mkdtemp, appendFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it, type TestContext } from 'node:test';
import { Runtime } from '../../src/runtime/runtime.ts';
import { diagnoseSession } from '../../src/runtime/session-preflight.ts';
import { ConversationAgent } from '../../src/agent/conversation-agent.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import { STANDARD_INPUT_LIMITS, STANDARD_HISTORY_LIMITS, worldTriggerId } from '../../src/protocol/index.ts';
import type { Event, Provider, SessionEntry, SessionStore, World, WorldDelivery, WorldStream } from '../../src/protocol/index.ts';
import { OrderedFixtureWorld } from '../fixtures/ordered-world.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';

const stream: WorldStream = { streamId: 'facts', epoch: 'producer-1' };
const fact = (sequence: number): WorldDelivery => ({ ...stream, sequence, event: { id: `fact-${sequence}`, source: 'fixture', type: 'fixture.input', occurredAt: '2026-10-09T00:00:00Z', payload: { sequence } } });
const done = () => ({ finishReason: 'stop' as const, toolCalls: [], message: { role: 'assistant' as const, content: 'done' } });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function gate() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function setup(t: TestContext, options: { provider?: Provider; world?: World; directory?: string; wrap?: (store: JsonlSessionStore) => SessionStore; positions?: number; allowStopFailure?: boolean } = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'bot-m4-test-'));
  const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
  const world = options.world ?? new FixtureWorld();
  const runtime = new Runtime({ world, agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: options.provider ?? new ScriptedProvider(() => done()),
    session: options.wrap ? options.wrap(store) : store, state: new MemoryState(), worldStreams: [stream],
    ...(options.positions ? { deliveryLimits: { positions: options.positions } } : {}) });
  t.after(async () => { try { await runtime.stop(); } catch (error) { if (!options.allowStopFailure) throw error; assert.ok(error instanceof AggregateError); } });
  await runtime.start();
  return { runtime, store, world, directory };
}

it('confirms memory admission before saving and binds duplicates to the original saved fact', { timeout: 5000 }, async t => {
  const writing = gate(), release = gate(); let calls = 0;
  const { runtime, store } = await setup(t, { provider: new ScriptedProvider(() => { ++calls; return done(); }), wrap: store => ({
    read: () => store.read(), scan: signal => store.scan(signal), append: async entry => {
      if (entry.kind === 'trigger_received') { writing.resolve(); await release.promise; } await store.append(entry);
    },
  }) });
  const original = fact(1);
  const receipt = await runtime.deliveries.submit(original);
  assert.equal(receipt.status, 'accepted'); await writing.promise;
  let saved = false; const waiting = runtime.deliveries.waitSaved(original).then(() => { saved = true; });
  assert.equal((await runtime.deliveries.submit(fact(1))).status, 'duplicate');
  original.event.payload = { changed: true };
  await turn(); assert.equal(saved, false); assert.equal(calls, 0);
  assert.deepEqual(runtime.deliveries.progress(stream.streamId), { worldId: 'fixture-world', ...stream, admittedTail: 1, receivedPrefix: 0, settledPrefix: 0, nextExpectedSequence: 2, uncompacted: 1, accepting: true });
  release.resolve(); await waiting; await runtime.triggers.idle();
  assert.equal(calls, 1);
  const received = (await store.read()).find(entry => entry.kind === 'trigger_received');
  assert.equal(received?.kind, 'trigger_received');
  if (received?.kind === 'trigger_received' && received.trigger.kind === 'world_event') assert.deepEqual(received.trigger.event.payload, { sequence: 1 });
  assert.equal(runtime.deliveries.progress(stream.streamId).settledPrefix, 1);
  assert.equal(runtime.triggers.inspect('world_event', receipt.triggerId)?.result?.persisted, true);
});

it('rejects sequence gaps and unregistered epochs without reserving positions', async t => {
  const { runtime } = await setup(t);
  assert.equal((await runtime.triggers.submit({ kind: 'world_event', event: fact(1).event }) as { code: string }).code, 'ordered_required');
  assert.equal((await runtime.deliveries.submit(fact(2)) as { code: string }).code, 'sequence_gap');
  assert.equal((await runtime.deliveries.submit({ ...fact(1), epoch: 'other' }) as { code: string }).code, 'epoch_mismatch');
  assert.equal((await runtime.deliveries.submit({ ...fact(1), streamId: 'other' }) as { code: string }).code, 'unregistered_stream');
  assert.equal((await runtime.deliveries.submit({ ...fact(1), sequence: 0 }) as { code: string }).code, 'invalid_sequence');
  assert.equal(runtime.deliveries.progress(stream.streamId).admittedTail, 0);
  const receipt = await runtime.deliveries.submit(fact(1)); assert.equal(receipt.status, 'accepted');
  if (receipt.status === 'accepted') assert.equal(receipt.queueSequence, 1);
  await runtime.triggers.idle();
});

for (const phase of ['received', 'effect', 'terminal'] as const) {
  it(`does not replay fixture effects after an actual process exits at ${phase}`, { timeout: 15000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bot-m4-exit-'));
    const script = fileURLToPath(new URL('../../scripts/m4-crash-probe.ts', import.meta.url));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', script, directory, phase], { windowsHide: true });
      let error = ''; child.stderr.on('data', chunk => { error += String(chunk); });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
    });
    const sessionPath = join(directory, 'session.jsonl'), before = await readFile(sessionPath);
    let calls = 0; const world = new FixtureWorld();
    const rebuilt = new Runtime({ world, provider: new ScriptedProvider(() => { ++calls; return done(); }), agent: new ConversationAgent({ sessionId: 'm4-test' }),
      session: new JsonlSessionStore(sessionPath), state: new MemoryState(), worldStreams: [stream] });
    if (phase === 'terminal') {
      await rebuilt.start();
      const entries = await new JsonlSessionStore(sessionPath).read();
      const original = entries.find(entry => entry.kind === 'trigger_received');
      assert.equal(original?.kind, 'trigger_received');
      if (original?.kind === 'trigger_received' && original.trigger.kind === 'world_event') assert.equal((await rebuilt.deliveries.submit({ ...stream, sequence: 1, event: original.trigger.event })).status, 'duplicate');
    } else { await assert.rejects(rebuilt.start(), /diagnosis/); assert.equal(rebuilt.diagnosis.status, 'blocked'); }
    assert.equal(calls, 0); assert.deepEqual(await readFile(sessionPath), before);
    if (phase !== 'received') assert.equal(await readFile(join(directory, 'effect.txt'), 'utf8'), 'effect\n');
    await rebuilt.stop();
  });
}

it('retains cancelled terminal positions behind the active prefix and bounds repeated cancellation', { timeout: 5000 }, async t => {
  const started = gate(), release = gate(); let calls = 0;
  const { runtime } = await setup(t, { positions: 3, provider: new ScriptedProvider(async () => { if (++calls === 1) { started.resolve(); await release.promise; } return done(); }) });
  await runtime.deliveries.submit(fact(1)); await started.promise;
  const second = await runtime.deliveries.submit(fact(2)), third = await runtime.deliveries.submit(fact(3));
  await runtime.triggers.cancel('world_event', second.triggerId); await runtime.triggers.cancel('world_event', third.triggerId);
  const progress = runtime.deliveries.progress(stream.streamId);
  assert.equal(progress.receivedPrefix, 3); assert.equal(progress.settledPrefix, 0); assert.equal(progress.uncompacted, 3);
  assert.equal((await runtime.deliveries.submit(fact(2)) as { stage: string }).stage, 'settled');
  assert.equal((await runtime.deliveries.submit(fact(4)) as { code: string }).code, 'delivery_window_full');
  release.resolve(); await runtime.triggers.idle();
  assert.equal(runtime.deliveries.progress(stream.streamId).settledPrefix, 3);
  assert.equal(runtime.deliveries.progress(stream.streamId).uncompacted, 0);
  assert.equal((await runtime.deliveries.submit(fact(4))).status, 'accepted'); await runtime.triggers.idle();
  assert.equal(calls, 2);
});

it('detects conflicting active facts while accepting semantically identical JSON key order', { timeout: 5000 }, async t => {
  const started = gate(), release = gate();
  const { runtime } = await setup(t, { provider: new ScriptedProvider(async () => { started.resolve(); await release.promise; return done(); }) });
  await runtime.deliveries.submit(fact(1)); await started.promise;
  const reordered = fact(1); reordered.event = { payload: reordered.event.payload, occurredAt: reordered.event.occurredAt, type: reordered.event.type, source: reordered.event.source, id: reordered.event.id };
  assert.equal((await runtime.deliveries.submit(reordered)).status, 'duplicate');
  assert.equal((await runtime.deliveries.submit({ ...fact(1), event: { ...fact(1).event, payload: 'changed' } }) as { code: string }).code, 'delivery_conflict');
  assert.equal((await runtime.deliveries.submit({ ...fact(1), expiresAt: '2030-01-01T00:00:00Z' }) as { code: string }).code, 'delivery_conflict');
  release.resolve(); await runtime.triggers.idle();
});

it('keeps original producer identities after losing a saved acknowledgement and rebuilding both sides', { timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-m4-producer-'));
  const sourcePath = join(directory, 'producer.jsonl');
  const world = new OrderedFixtureWorld(sourcePath, stream, 'm4-test');
  const first = await setup(t, { directory, world });
  const prepared = await world.prepare(fact(1).event);
  await first.runtime.deliveries.submit(prepared); await first.runtime.triggers.idle();
  // 保存已完成但来源未记录确认，模拟确认丢失；生产者日志仍持有原事实。
  assert.equal(world.producerProgress.pending, 1); await first.runtime.stop();
  let calls = 0;
  const rebuilt = new OrderedFixtureWorld(sourcePath, stream, 'm4-test');
  const second = await setup(t, { directory, world: rebuilt, provider: new ScriptedProvider(() => { ++calls; return done(); }) });
  const same = await rebuilt.original(1);
  assert.deepEqual(same, prepared);
  assert.equal((await rebuilt.send(same)).status, 'duplicate'); assert.equal(calls, 0);
  assert.equal(rebuilt.producerProgress.pending, 0);
  const next = await rebuilt.prepare(fact(2).event); assert.equal(next.sequence, 2);
  assert.equal((await rebuilt.send(next)).status, 'accepted'); await second.runtime.triggers.idle(); assert.equal(calls, 1);
  assert.equal((await world.ports[0]!.submit(prepared) as { code: string }).code, 'stale_generation');
});

it('processes beyond the old default World identity quota without consuming Console capacity', { timeout: 90000 }, async t => {
  let calls = 0, scans = 0, fullReads = 0;
  const { runtime, store } = await setup(t, { provider: new ScriptedProvider(() => { ++calls; return done(); }), wrap: store => ({
    append: entry => store.append(entry), read: async () => { ++fullReads; return store.read(); }, scan: signal => { ++scans; return store.scan(signal); },
  }) });
  const total = STANDARD_INPUT_LIMITS.admissionIds + 1;
  for (let sequence = 1; sequence <= total; ++sequence) {
    assert.equal((await runtime.deliveries.submit(fact(sequence))).status, 'accepted'); await runtime.triggers.idle();
  }
  assert.equal(calls, total); assert.equal(scans, 1); assert.equal(fullReads, 0);
  assert.equal(runtime.deliveries.progress(stream.streamId).settledPrefix, total);
  assert.equal(runtime.deliveries.progress(stream.streamId).uncompacted, 0);
  assert.ok(runtime.diagnosis.history.runs <= STANDARD_HISTORY_LIMITS.runs); assert.ok(runtime.trace.length <= STANDARD_HISTORY_LIMITS.traceEntries);
  assert.equal((await runtime.inputs.submit({ inputId: 'console-after-world', source: 'console', content: { kind: 'text', text: 'hello' } })).status, 'accepted');
  await runtime.triggers.idle();
  assert.equal((await runtime.deliveries.submit(fact(1))).status, 'duplicate'); assert.equal(calls, total + 1);
  let terminals = 0; for await (const entry of store.scan()) if (entry.kind === 'run_finished') ++terminals;
  assert.equal(terminals, total + 1);
});

for (const crash of ['received', 'tool_call', 'unknown', 'terminal_missing', 'corrupt'] as const) {
  it(`blocks new execution and preserves archived evidence after ${crash}`, { timeout: 5000 }, async t => {
    const { runtime, store, directory } = await setup(t);
    const identity = { worldId: 'fixture-world', ...stream, sequence: 1 };
    const association = { triggerKind: 'world_event' as const, triggerId: worldTriggerId(identity), generation: runtime.generation, delivery: identity };
    await runtime.stop();
    if (crash === 'corrupt') await appendFile(join(directory, 'session.jsonl'), '{truncated', 'utf8');
    else {
      await store.append({ kind: 'trigger_received', at: '2026-10-09T00:00:00Z', trigger: { kind: 'world_event', event: fact(1).event, delivery: identity }, queueSequence: 1, ...association });
      if (crash !== 'received') {
        await store.append({ kind: 'run_started', at: '2026-10-09T00:00:00Z', inputId: association.triggerId, ...association, runId: 'interrupted' });
        if (crash !== 'terminal_missing') {
          await store.append({ kind: 'tool_call', at: '2026-10-09T00:00:00Z', call: { callId: 'effect', toolName: 'fixture.set', arguments: { key: 'x', value: 7 } }, ...association, runId: 'interrupted' });
          if (crash === 'unknown') {
            await store.append({ kind: 'tool_outcome', at: '2026-10-09T00:00:00Z', outcome: { callId: 'effect', toolName: 'fixture.set', status: 'unknown' }, ...association, runId: 'interrupted' });
            await store.append({ kind: 'run_finished', at: '2026-10-09T00:00:00Z', inputId: association.triggerId, result: { status: 'failed', code: 'tool_unknown', persisted: true }, ...association, runId: 'interrupted' });
          }
        }
      }
    }
    const before = await readFile(join(directory, 'session.jsonl'));
    const readOnly = await diagnoseSession(new JsonlSessionStore(join(directory, 'session.jsonl')), { worldId: 'fixture-world', sessionId: 'm4-test', worldStreams: [stream] });
    assert.equal(readOnly.status, 'blocked'); assert.deepEqual(await readFile(join(directory, 'session.jsonl')), before);
    let calls = 0; const world = new FixtureWorld();
    const rebuilt = new Runtime({ world, provider: new ScriptedProvider(() => { ++calls; return done(); }), agent: new ConversationAgent({ sessionId: 'm4-test' }),
      session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState(), worldStreams: [stream] });
    await assert.rejects(rebuilt.start(), /diagnosis/);
    assert.equal(rebuilt.diagnosis.status, 'blocked'); assert.equal(calls, 0); assert.deepEqual(world.lifecycle, []);
    assert.deepEqual(await readFile(join(directory, 'session.jsonl')), before);
    if (crash === 'unknown') { assert.equal(rebuilt.deliveries.progress(stream.streamId).settledPrefix, 1); assert.ok(rebuilt.diagnosis.issues.some(issue => issue.code === 'tool_unknown')); }
    await rebuilt.stop();
  });
}

it('keeps unknown effects stopped even when their receipt storage fails', { timeout: 5000 }, async t => {
  class EffectsWorld extends FixtureWorld {
    override async executeTool(...args: Parameters<FixtureWorld['executeTool']>): Promise<never> { await super.executeTool(...args); throw new Error('effect happened without a receipt'); }
  }
  const world = new EffectsWorld();
  const { runtime } = await setup(t, { world, allowStopFailure: true, wrap: store => ({ read: () => store.read(), scan: signal => store.scan(signal), append: entry => entry.kind === 'tool_outcome' ? Promise.reject(new Error('receipt storage failed')) : store.append(entry) }),
    provider: new ScriptedProvider(() => ({ finishReason: 'tool_calls', toolCalls: [{ callId: 'write', toolName: 'fixture.set', arguments: { key: 'effect', value: 7 } }] })) });
  const first = await runtime.deliveries.submit(fact(1)), second = await runtime.deliveries.submit(fact(2)); await runtime.triggers.idle();
  assert.equal(world.value('effect'), 7);
  assert.equal(runtime.triggers.inspect('world_event', first.triggerId)?.result?.code, 'storage_error');
  assert.equal(runtime.triggers.inspect('world_event', second.triggerId)?.result?.status, 'cancelled');
  assert.equal(runtime.deliveries.progress(stream.streamId).accepting, false);
  await assert.rejects(runtime.start(), /stopping|diagnosis/);
});

for (const phase of ['scan', 'registration'] as const) {
  it(`does not open World after stop during startup ${phase}`, { timeout: 5000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'bot-m4-start-'));
    const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
    const started = gate(), release = gate(); const world = new FixtureWorld();
    const delayed: SessionStore = { read: () => store.read(), scan: async function* (signal) {
      if (phase === 'scan') { started.resolve(); await release.promise; } yield* store.scan(signal);
    }, append: async entry => { if (phase === 'registration' && entry.kind === 'world_stream_registered') { started.resolve(); await release.promise; } await store.append(entry); } };
    const runtime = new Runtime({ world, agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: new ScriptedProvider(() => done()), session: delayed, state: new MemoryState(), worldStreams: [stream] });
    t.after(() => runtime.stop());
    const starting = runtime.start(); const rejected = assert.rejects(starting, /cancelled/); await started.promise;
    let stopped = false; const stopping = runtime.stop().then(() => { stopped = true; });
    await turn(); if (phase === 'registration') assert.equal(stopped, false);
    release.resolve(); await Promise.all([stopping, rejected]);
    assert.equal(world.lifecycle.includes('start'), false); assert.equal(runtime.status, 'stopped');
  });
}

it('rejects changed registrations and legacy history without inventing a source watermark', async t => {
  const { runtime, directory } = await setup(t); await runtime.stop();
  const changed = new Runtime({ world: new FixtureWorld(), agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: new ScriptedProvider(() => done()),
    session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState(), worldStreams: [{ ...stream, epoch: 'new-epoch' }] });
  await assert.rejects(changed.start(), /diagnosis/); assert.equal(changed.diagnosis.issues[0]?.code, 'stream_binding');
  const legacyDirectory = await mkdtemp(join(tmpdir(), 'bot-m4-legacy-'));
  const store = new JsonlSessionStore(join(legacyDirectory, 'session.jsonl'));
  const legacy = new Runtime({ world: new FixtureWorld(), agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: new ScriptedProvider(() => done()), session: store, state: new MemoryState() });
  await legacy.start(); await legacy.handleEvent(fact(1).event); await legacy.stop();
  const adoption = new Runtime({ world: new FixtureWorld(), agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: new ScriptedProvider(() => done()), session: store, state: new MemoryState(), worldStreams: [stream] });
  await assert.rejects(adoption.start(), /diagnosis/); assert.equal(adoption.diagnosis.issues[0]?.code, 'legacy_source_boundary');
});

it('requires streaming storage for ordered delivery and separates legacy identity budgets', async t => {
  const base = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-m4-capability-')), 'session.jsonl'));
  const old: SessionStore = { append: entry => base.append(entry), read: () => base.read() };
  const ordered = new Runtime({ world: new FixtureWorld(), agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: new ScriptedProvider(() => done()), session: old, state: new MemoryState(), worldStreams: [stream] });
  await assert.rejects(ordered.start(), /Session.scan/);
  const legacy = new Runtime({ world: new FixtureWorld(), agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: new ScriptedProvider(() => done()), session: old, state: new MemoryState(), inputLimits: { admissionIds: 1 }, deliveryLimits: { legacyIds: 1 } });
  t.after(() => legacy.stop()); await legacy.start();
  await legacy.handleEvent(fact(1).event);
  assert.equal((await legacy.inputs.submit({ inputId: 'one', source: 'console', content: { kind: 'text', text: 'hi' } })).status, 'accepted'); await legacy.triggers.idle();
  assert.equal((await legacy.triggers.submit({ kind: 'world_event', event: fact(2).event }) as { code: string }).code, 'admission_limit');
  assert.equal(legacy.diagnosis.status, 'legacy_store');
});

it('inspects an empty Session without writing a registration or touching World lifecycle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-m4-inspect-'));
  const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
  const world = new FixtureWorld();
  const runtime = new Runtime({ world, agent: new ConversationAgent({ sessionId: 'm4-test' }), provider: new ScriptedProvider(() => done()), session: store, state: new MemoryState(), worldStreams: [stream] });
  assert.equal((await runtime.inspectSession()).status, 'ready'); assert.equal(runtime.status, 'new'); assert.deepEqual(world.lifecycle, []);
  await assert.rejects(readFile(join(directory, 'session.jsonl')), { code: 'ENOENT' });
  assert.equal((await store.read()).length, 0);
});

it('rebuilds producer and Runtime in separate processes without repeating the prior model or tool', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-m4-process-'));
  const script = fileURLToPath(new URL('../../scripts/m4-sample.ts', import.meta.url));
  const run = (phase: string) => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', script, directory, phase], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
  const first = JSON.parse(await run('first')) as { value: number; modelCalls: number };
  const second = JSON.parse(await run('second')) as { value: number; callsBeforeNew: number; modelCalls: number; replay: { status: string }; progress: { settledPrefix: number } };
  assert.equal(first.value, 7); assert.equal(first.modelCalls, 2);
  assert.equal(second.replay.status, 'duplicate'); assert.equal(second.callsBeforeNew, 0); assert.equal(second.modelCalls, 2); assert.equal(second.value, 8); assert.equal(second.progress.settledPrefix, 2);
});

it('drains piped source-console commands across save, replay, restart and universal input', { timeout: 15000 }, async () => {
  const script = fileURLToPath(new URL('../../scripts/m4-console.ts', import.meta.url));
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', script], { windowsHide: true });
    let out = '', error = '';
    child.stdout.on('data', chunk => { out += String(chunk); }); child.stderr.on('data', chunk => { error += String(chunk); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(error)));
    child.stdin.end(['fact set answer 7', 'replay 1', 'restart', 'fact set answer 8', 'input get answer', 'tick', 'quit'].join('\n') + '\n');
  });
  const rows = stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line) as { receipt?: { status: string }; modelCalls?: number; restarted?: boolean; result?: { reply?: string }; progress?: { settledPrefix: number }; error?: string });
  assert.equal(rows.some(row => row.error), false);
  assert.equal(rows.find(row => row.receipt?.status === 'duplicate')?.modelCalls, 0);
  assert.equal(rows.find(row => row.restarted)?.progress?.settledPrefix, 1);
  const result = rows.find(row => row.result?.reply?.includes('fixture.get'))?.result?.reply;
  assert.equal(JSON.parse(result!).output, 8);
});
