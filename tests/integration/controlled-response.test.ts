import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it, type TestContext } from 'node:test';
import { ConversationAgent } from '../../src/agent/conversation-agent.ts';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import { Runtime } from '../../src/runtime/runtime.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import type { ProviderRequest, ProviderResponse, SessionStore, ToolCall, UserInput, HeartbeatOptions, InputLimits, ResponseLimits, ToolExecutionContext, ToolOutcome } from '../../src/protocol/index.ts';
import { ResponseWorld } from '../fixtures/response-world.ts';

const input = (inputId: string, text = inputId): UserInput => ({ inputId, source: 'test', content: { kind: 'text', text } });
const reply = (text = 'done'): ProviderResponse => ({ finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: text } });
const tool = (callId: string, toolName: string, argumentsValue: ToolCall['arguments']): ProviderResponse => ({ finishReason: 'tool_calls', toolCalls: [{ callId, toolName, arguments: argumentsValue }] });
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function until(test: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1500;
  while (!await test()) { if (Date.now() > deadline) throw new Error('Condition did not finish'); await new Promise(resolve => setTimeout(resolve, 2)); }
}
async function setup(t: TestContext, model: (request: ProviderRequest, index: number) => ProviderResponse | Promise<ProviderResponse>, options: {
  stopReleases?: boolean; wrap?: (store: SessionStore) => SessionStore; tasks?: boolean; heartbeat?: HeartbeatOptions; taskClock?: () => number;
  limits?: Partial<ResponseLimits>; inputLimits?: Partial<InputLimits>; makeWorld?: (path: string) => ResponseWorld } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'response-run-'));
  const world = options.makeWorld?.(join(folder, 'world.json')) ?? new ResponseWorld(join(folder, 'world.json'), options.stopReleases ?? true);
  const store = new JsonlSessionStore(join(folder, 'session.jsonl'));
  const requests: ProviderRequest[] = [];
  const runtime = new Runtime({ world, agent: new ConversationAgent({ sessionId: 'response-test', tasks: !!options.tasks, operations: true, includeUnsuccessfulHistory: true }),
    provider: new ScriptedProvider((request, index) => { requests.push(structuredClone(request)); return model(request, index); }),
    session: options.wrap?.(store) ?? store, state: new MemoryState(), responsiveness: options.limits ?? {}, includeUnsuccessfulHistory: true, cleanupDeadlineMs: 30,
    ...(options.heartbeat ? { heartbeat: options.heartbeat } : {}), ...(options.taskClock ? { taskClock: options.taskClock } : {}), ...(options.inputLimits ? { inputLimits: options.inputLimits } : {}) });
  await runtime.start(); t.after(async () => { world.releaseAll(); await world.stop(); await runtime.stop(); });
  return { runtime, world, store, requests, folder };
}
const ordinary = (request: ProviderRequest): ProviderResponse => {
  const last = request.messages.at(-1)!;
  if (last.role === 'user' && last.content.startsWith('observe ')) return tool('read', 'fixture.observe', { label: last.content.slice(8) });
  return reply(last.role === 'user' ? last.content : 'observed');
};

it('settles a yielded read before FIFO continuation and keeps late evidence out of automatic failed history', { timeout: 4000 }, async t => {
  const { runtime, world, store, requests } = await setup(t, ordinary);
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  const target = runtime.responses!.snapshot().active!;
  await runtime.inputs.submit(input('C')); await runtime.inputs.submit(input('B'));
  assert.equal(runtime.responses!.yield(target).status, 'requested');
  await runtime.inputs.idle();
  assert.equal(runtime.inputs.inspect('A')?.result?.status, 'cancelled');
  assert.equal(runtime.status, 'running');
  const beforeLate = await store.read();
  assert.deepEqual(beforeLate.filter(entry => entry.kind === 'run_finished').map(entry => entry.inputId), ['A', 'C', 'B']);
  assert.equal(runtime.responses!.snapshot().operations.length, 1);
  assert.equal(runtime.responses!.yield(target).status, 'rejected');
  world.release('A'); await until(() => runtime.responses!.snapshot().operations.length === 0);
  const late = await runtime.responses!.readLate({ runId: target.runId, callId: 'read' });
  assert.equal(late?.result.status, 'returned'); assert.equal(late?.origin.runId, target.runId);
  await runtime.inputs.submit(input('D')); await runtime.inputs.idle();
  assert.ok(requests.every(request => !JSON.stringify(request).includes('fixture-epoch')));
  assert.equal((await store.read()).filter(entry => entry.kind === 'operation_late').length, 1);
  assert.equal((await runtime.inspectSession()).status, 'ready');
});

it('keeps old active observations from overwriting newer World push facts', { timeout: 4000 }, async t => {
  const { runtime, world } = await setup(t, ordinary);
  world.hold('old'); await runtime.inputs.submit(input('old', 'observe old')); await world.entered('old');
  const target = runtime.responses!.snapshot().active!;
  await world.publish(7); assert.equal(world.latest.version, 1);
  runtime.responses!.yield(target); await runtime.inputs.idle();
  world.release('old'); await until(() => runtime.responses!.snapshot().operations.length === 0);
  assert.deepEqual(world.latest, { entity: 'answer', epoch: 'fixture-epoch', version: 1, value: 7 });
  const old = await runtime.responses!.readLate({ runId: target.runId, callId: 'read' });
  assert.equal((old?.result.outcome?.output as { observation: { version: number } }).observation.version, 0);
});

it('refuses a safe yield during an actual write and keeps forced cancellation unknown', { timeout: 4000 }, async t => {
  const { runtime, world, store } = await setup(t, request => request.messages.at(-1)?.role === 'user'
    ? tool('write', 'fixture.write', { value: 7, label: 'write', effects: 'none' }) : reply());
  world.hold('write'); await runtime.inputs.submit(input('write')); await world.entered('write');
  await runtime.inputs.submit(input('later'));
  const refused = runtime.responses!.yield(runtime.responses!.snapshot().active!);
  assert.equal(refused.status, 'rejected'); if (refused.status === 'rejected') assert.equal(refused.code, 'unsafe_operation');
  assert.equal(JSON.parse(await readFile(world.path, 'utf8')).value, 7);
  await runtime.inputs.cancel('write'); await runtime.inputs.idle(); await runtime.stop();
  assert.ok((await store.read()).some(entry => entry.kind === 'tool_outcome' && entry.outcome.status === 'unknown'));
  assert.equal(runtime.inputs.inspect('later')?.result?.status, 'cancelled');
  assert.equal((await store.read()).filter(entry => entry.kind === 'operation_late').length, 0);
});

it('does not execute a cancelled Provider late response containing an action', { timeout: 4000 }, async t => {
  const started = gate<void>(), late = gate<ProviderResponse>();
  const { runtime, world, store } = await setup(t, (_request, index) => { if (!index) { started.resolve(); return late.promise; } return reply(); });
  await runtime.inputs.submit(input('A')); await started.promise;
  await runtime.inputs.submit(input('B')); runtime.responses!.yield(runtime.responses!.snapshot().active!);
  await runtime.inputs.idle(); late.resolve(tool('bad', 'fixture.write', { value: 99 }));
  await until(() => runtime.responses!.snapshot().operations.length === 0);
  assert.equal(JSON.parse(await readFile(world.path, 'utf8')).value, 0);
  assert.ok((await store.read()).some(entry => entry.kind === 'operation_late' && entry.origin.kind === 'provider' && entry.result.status === 'discarded'));
  assert.equal((await runtime.inspectSession()).status, 'ready');
});

it('bounds repeated logical yields while retaining unfinished physical calls', { timeout: 4000 }, async t => {
  const { runtime, world } = await setup(t, ordinary);
  for (const label of ['A', 'B', 'C']) {
    world.hold(label); await runtime.inputs.submit(input(label, `observe ${label}`)); await world.entered(label);
    const target = runtime.responses!.snapshot().active!;
    const receipt = runtime.responses!.yield(target);
    if (label !== 'C') { assert.equal(receipt.status, 'requested'); await runtime.inputs.idle(); }
    else { assert.equal(receipt.status, 'rejected'); if (receipt.status === 'rejected') assert.equal(receipt.code, 'yield_capacity'); }
  }
  assert.equal(runtime.responses!.snapshot().operations.length, runtime.responses!.limits.pendingOperations);
  world.release('A'); await until(() => runtime.responses!.snapshot().operations.length === 2);
  assert.equal(runtime.responses!.yield(runtime.responses!.snapshot().active!).status, 'requested');
  await runtime.inputs.idle(); world.release('B'); world.release('C');
  await until(() => runtime.responses!.snapshot().operations.length === 0);
});

it('reports unfinished physical cleanup and forbids restart until a subsequent stop settles it', { timeout: 4000 }, async t => {
  const { runtime, world } = await setup(t, ordinary, { stopReleases: false });
  world.hold('old'); await runtime.inputs.submit(input('old', 'observe old')); await world.entered('old');
  runtime.responses!.yield(runtime.responses!.snapshot().active!); await runtime.inputs.idle();
  await assert.rejects(runtime.stop(), AggregateError); assert.equal(runtime.status, 'stopping');
  await assert.rejects(runtime.start(), /stopping/);
  world.release('old'); await until(() => runtime.responses!.snapshot().operations.length === 0);
  await runtime.stop(); assert.equal(runtime.status, 'stopped'); await runtime.start();
  await runtime.inputs.submit(input('new')); await runtime.inputs.idle(); assert.equal(runtime.inputs.inspect('new')?.result?.status, 'succeeded');
});

it('waits for detachment confirmation before finalizing the old run or executing a queued input', { timeout: 4000 }, async t => {
  const saving = gate<void>(), release = gate<void>();
  const { runtime, world, requests } = await setup(t, ordinary, { wrap: store => ({ read: () => store.read(), scan: signal => store.scan!(signal), append: async entry => {
    if (entry.kind === 'operation_detached') { saving.resolve(); await release.promise; } await store.append(entry);
  } }) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A'); await runtime.inputs.submit(input('B'));
  runtime.responses!.yield(runtime.responses!.snapshot().active!); await saving.promise;
  assert.equal(runtime.inputs.inspect('B')?.status, 'queued'); assert.equal(requests.length, 1);
  release.resolve(); await runtime.inputs.idle(); world.release('A'); await until(() => runtime.responses!.snapshot().operations.length === 0);
  assert.equal(runtime.inputs.inspect('B')?.result?.status, 'succeeded');
});

it('rejects duplicated late archive facts before opening a new World', { timeout: 4000 }, async t => {
  const { runtime, world, store, folder } = await setup(t, ordinary);
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  runtime.responses!.yield(runtime.responses!.snapshot().active!); await runtime.inputs.idle(); world.release('A');
  await until(() => runtime.responses!.snapshot().operations.length === 0); await runtime.stop();
  const record = (await store.read()).find(entry => entry.kind === 'operation_late')!; await store.append(record);
  const nextWorld = new ResponseWorld(join(folder, 'not-opened.json'));
  const next = new Runtime({ world: nextWorld, provider: new ScriptedProvider([reply()]), agent: new ConversationAgent({ sessionId: 'response-test' }),
    session: store, state: new MemoryState(), responsiveness: {} });
  await assert.rejects(next.start(), /diagnosis/); await assert.rejects(stat(nextWorld.path), { code: 'ENOENT' });
  assert.ok(next.diagnosis.issues.some(issue => issue.code === 'operation_pairing'));
});

it('delivers original late evidence through an explicit Agent tool and rejects partial query budgets', { timeout: 4000 }, async t => {
  const { runtime, world, requests } = await setup(t, request => {
    const last = request.messages.at(-1)!;
    if (last.role === 'user' && last.content === 'evidence') {
      const cancelled = request.messages.find(message => message.role === 'tool' && message.toolCallId === 'read')!;
      const original = JSON.parse(cancelled.content).output.operation;
      return tool('evidence', 'agent_operation_evidence', { runId: original.runId, callId: original.callId });
    }
    return ordinary(request);
  });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  const target = runtime.responses!.snapshot().active!; runtime.responses!.yield(target); await runtime.inputs.idle();
  world.release('A'); await until(() => runtime.responses!.snapshot().operations.length === 0);
  assert.ok(requests.every(request => !JSON.stringify(request).includes('fixture-epoch')));
  await assert.rejects(runtime.responses!.readLate({ runId: target.runId, callId: 'read', bytes: 1 }), /budget/);
  await runtime.inputs.submit(input('query', 'evidence')); await runtime.inputs.idle();
  const evidenceRequest = requests.find(request => request.messages.at(-1)?.toolCallId === 'evidence')!;
  const evidence = JSON.parse(evidenceRequest.messages.at(-1)!.content).output;
  assert.equal(evidence.origin.runId, target.runId); assert.equal(evidence.result.outcome.output.observation.version, 0);
});

it('stores oversized late observations as explicit discards without a partial payload', { timeout: 4000 }, async t => {
  class LargeWorld extends ResponseWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      const outcome = await super.executeTool(call, context); return { ...outcome, output: { data: 'x'.repeat(40 * 1024) } };
    }
  }
  const { runtime, world } = await setup(t, ordinary, { makeWorld: path => new LargeWorld(path) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  const target = runtime.responses!.snapshot().active!; runtime.responses!.yield(target); await runtime.inputs.idle(); world.release('A');
  await until(() => runtime.responses!.snapshot().operations.length === 0);
  const late = await runtime.responses!.readLate({ runId: target.runId, callId: 'read' });
  assert.equal(late?.result.status, 'discarded'); assert.equal(late?.result.error?.code, 'late_capacity'); assert.equal(late?.result.outcome, undefined);
  assert.equal((await runtime.inspectSession()).status, 'ready');
});

it('preserves an already returned World receipt when the operator yields at the same completion boundary', { timeout: 4000 }, async t => {
  let yielding!: () => void;
  class ReturningWorld extends ResponseWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      const result = await super.executeTool(call, context); queueMicrotask(() => queueMicrotask(yielding)); return result;
    }
  }
  const { runtime, store } = await setup(t, ordinary, { makeWorld: path => new ReturningWorld(path) });
  yielding = () => { const target = runtime.responses!.snapshot().active; if (target) runtime.responses!.yield(target); };
  await runtime.inputs.submit(input('read', 'observe immediate')); await runtime.inputs.idle();
  const records = await store.read();
  assert.ok(records.some(entry => entry.kind === 'tool_outcome' && entry.outcome.status === 'succeeded'));
  assert.equal(records.filter(entry => entry.kind === 'tool_outcome').length, 1);
  assert.equal(runtime.inputs.inspect('read')?.result?.status, 'cancelled');
  assert.equal(records.filter(entry => entry.kind === 'operation_late').length, 0);
});

it('keeps a claimed task arrangement consumed after a heartbeat read is yielded', { timeout: 4000 }, async t => {
  let tick = () => {};
  const { runtime, world, requests } = await setup(t, request => {
    const last = request.messages.at(-1)!;
    if (last.role === 'user' && last.content === 'create') return tool('create', 'agent_task_create', { intent: 'observe later', status: 'waiting', schedule: { wakeAt: '2029-01-01T00:00:00.000Z' } });
    if (last.role === 'user' && last.content.includes('"kind":"heartbeat"')) return tool('read', 'fixture.observe', { label: 'wake' });
    return reply();
  }, { tasks: true, taskClock: () => Date.parse('2029-01-01T00:00:01.000Z'), heartbeat: { source: { subscribe: callback => { tick = callback; return () => { tick = () => {}; }; } } } });
  world.hold('wake'); await runtime.inputs.submit(input('create')); await runtime.inputs.idle(); tick(); await world.entered('wake');
  const target = runtime.responses!.snapshot().active!; runtime.responses!.yield(target); await runtime.inputs.idle();
  const before = runtime.tasks.snapshot()[0]!; assert.equal(before.schedule?.consumedByRunId, target.runId); assert.equal(before.status, 'waiting');
  const calls = requests.length; tick(); await runtime.inputs.idle(); assert.equal(requests.length, calls);
  world.release('wake'); await until(() => runtime.responses!.snapshot().operations.length === 0);
  assert.equal(runtime.tasks.snapshot()[0]?.schedule?.consumedByRunId, target.runId);
  assert.equal(runtime.tasks.snapshot()[0]?.lastAttempt?.status, 'cancelled');
  assert.equal((await runtime.inspectSession()).status, 'ready');
});

it('closes admission on detachment storage failure instead of executing the queued input', { timeout: 4000 }, async t => {
  const { runtime, world, requests } = await setup(t, ordinary, { wrap: store => ({ read: () => store.read(), scan: signal => store.scan!(signal),
    append: entry => entry.kind === 'operation_detached' ? Promise.reject(new Error('detachment storage unavailable')) : store.append(entry) }) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A'); await runtime.inputs.submit(input('B'));
  runtime.responses!.yield(runtime.responses!.snapshot().active!); await runtime.inputs.idle(); await until(() => runtime.status === 'stopped');
  assert.equal(runtime.inputs.inspect('A')?.result?.code, 'storage_error'); assert.equal(runtime.inputs.inspect('B')?.result?.status, 'cancelled');
  assert.equal(requests.length, 1); assert.ok(runtime.diagnosis.issues.some(issue => issue.code === 'storage_error'));
});

it('reports a late write failure and retains a blocked original archive', { timeout: 4000 }, async t => {
  const { runtime, world, store } = await setup(t, ordinary, { wrap: store => ({ read: () => store.read(), scan: signal => store.scan!(signal),
    append: entry => entry.kind === 'operation_late' ? Promise.reject(new Error('late storage unavailable')) : store.append(entry) }) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  runtime.responses!.yield(runtime.responses!.snapshot().active!); await runtime.inputs.idle(); world.release('A');
  await until(() => runtime.status === 'stopped');
  assert.ok(runtime.diagnosis.issues.some(issue => issue.code === 'storage_error'));
  assert.equal((await store.read()).filter(entry => entry.kind === 'operation_late').length, 0);
  assert.equal((await runtime.inspectSession()).status, 'blocked');
});

it('confirms immutable late values even when the producer and evidence consumer mutate their objects', { timeout: 4000 }, async t => {
  const saving = gate<void>(), release = gate<void>(); let returned: ToolOutcome | undefined;
  class MutableWorld extends ResponseWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> { returned = await super.executeTool(call, context); return returned; }
  }
  const { runtime, world } = await setup(t, ordinary, { makeWorld: path => new MutableWorld(path), wrap: store => ({ read: () => store.read(), scan: signal => store.scan!(signal), append: async entry => {
    if (entry.kind === 'operation_late') { saving.resolve(); await release.promise; } await store.append(entry);
  } }) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  const target = runtime.responses!.snapshot().active!; runtime.responses!.yield(target); await runtime.inputs.idle(); world.release('A'); await saving.promise;
  assert.equal(runtime.responses!.snapshot().operations[0]?.state, 'confirming');
  (returned!.output as { observation: { value: number } }).observation.value = 999; release.resolve();
  await until(() => runtime.responses!.snapshot().operations.length === 0);
  const first = await runtime.responses!.readLate({ runId: target.runId, callId: 'read' });
  assert.equal((first!.result.outcome!.output as { observation: { value: number } }).observation.value, 0);
  (first!.result.outcome!.output as { observation: { value: number } }).observation.value = 123;
  const second = await runtime.responses!.readLate({ runId: target.runId, callId: 'read' });
  assert.equal((second!.result.outcome!.output as { observation: { value: number } }).observation.value, 0);
});

it('enforces the combined external-call limit after repeated noncooperative Provider timeouts', { timeout: 4000 }, async t => {
  const replies = [gate<ProviderResponse>(), gate<ProviderResponse>(), gate<ProviderResponse>()];
  const { runtime, requests } = await setup(t, (_request, index) => replies[index]!.promise, { inputLimits: { providerMs: 10 } });
  for (let index = 0; index < runtime.responses!.limits.pendingOperations; index++) { await runtime.inputs.submit(input(`timeout-${index}`)); await runtime.inputs.idle(); }
  await runtime.inputs.submit(input('full')); await runtime.inputs.idle();
  assert.equal(runtime.inputs.inspect('full')?.result?.code, 'operation_capacity');
  assert.equal(requests.length, runtime.responses!.limits.pendingOperations);
  for (const response of replies) response.resolve(reply()); await until(() => runtime.responses!.snapshot().operations.length === 0);
  assert.equal((await runtime.inspectSession()).status, 'ready');
});

it('records a pure read late rejection without stopping the next successfully settled run', { timeout: 4000 }, async t => {
  class FailingWorld extends ResponseWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> { await super.executeTool(call, context); throw new Error('late observation unavailable'); }
  }
  const { runtime, world } = await setup(t, ordinary, { makeWorld: path => new FailingWorld(path) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  const target = runtime.responses!.snapshot().active!; await runtime.inputs.submit(input('B')); runtime.responses!.yield(target); await runtime.inputs.idle();
  world.release('A'); await until(() => runtime.responses!.snapshot().operations.length === 0);
  const late = await runtime.responses!.readLate({ runId: target.runId, callId: 'read' });
  assert.equal(late?.result.status, 'failed'); assert.match(late!.result.error!.message, /unavailable/);
  assert.equal(runtime.status, 'running'); assert.equal(runtime.inputs.inspect('B')?.result?.status, 'succeeded');
  assert.equal((await runtime.inspectSession()).status, 'ready');
});

it('quarantines a mismatched late receipt instead of routing it to another call', { timeout: 4000 }, async t => {
  class BadWorld extends ResponseWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> { return { ...await super.executeTool(call, context), callId: 'foreign' }; }
  }
  const { runtime, world } = await setup(t, ordinary, { makeWorld: path => new BadWorld(path) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  const target = runtime.responses!.snapshot().active!; runtime.responses!.yield(target); await runtime.inputs.idle(); world.release('A');
  await until(() => runtime.status === 'stopped');
  assert.equal((await runtime.responses!.readLate({ runId: target.runId, callId: 'read' }))?.result.error?.code, 'invalid_late_outcome');
  assert.equal((await runtime.inspectSession()).status, 'blocked');
});

it('keeps unclassified World reads on the conservative cancellation path', { timeout: 4000 }, async t => {
  class UnclassifiedWorld extends ResponseWorld {
    override tools() { return super.tools().map(({ effects: _effects, ...definition }) => definition); }
  }
  const { runtime, world, store } = await setup(t, ordinary, { makeWorld: path => new UnclassifiedWorld(path) });
  world.hold('A'); await runtime.inputs.submit(input('A', 'observe A')); await world.entered('A');
  const denied = runtime.responses!.yield(runtime.responses!.snapshot().active!);
  assert.equal(denied.status, 'rejected'); if (denied.status === 'rejected') assert.equal(denied.code, 'unsafe_operation');
  await runtime.inputs.cancel('A'); await runtime.inputs.idle(); await runtime.stop();
  assert.ok((await store.read()).some(entry => entry.kind === 'tool_outcome' && entry.outcome.status === 'unknown'));
});

it('reuses the same unresolved World cleanup across timed-out stop attempts', { timeout: 4000 }, async t => {
  const exit = gate<void>(), cleaned = gate<void>();
  class CleanupWorld extends ResponseWorld {
    cleanups = 0;
    override releaseAll(): void { exit.resolve(); super.releaseAll(); }
    override async stop(): Promise<void> { ++this.cleanups; await exit.promise; await super.stop(); cleaned.resolve(); }
  }
  const { runtime, world } = await setup(t, ordinary, { makeWorld: path => new CleanupWorld(path) });
  await assert.rejects(runtime.stop(), AggregateError); assert.equal(runtime.status, 'stopping');
  await assert.rejects(runtime.stop(), AggregateError); await assert.rejects(runtime.stop(), AggregateError);
  assert.equal((world as CleanupWorld).cleanups, 1); await assert.rejects(runtime.start(), /stopping/);
  world.releaseAll(); await cleaned.promise; await new Promise(resolve => setImmediate(resolve));
  await runtime.stop(); assert.equal(runtime.status, 'stopped');
});

it('preserves unknown after a real write returns an unsupported receipt status', { timeout: 4000 }, async t => {
  class InvalidStatusWorld extends ResponseWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      return { ...await super.executeTool(call, context), status: 'invalid' as ToolOutcome['status'] };
    }
  }
  const { runtime, world, store } = await setup(t, () => tool('write', 'fixture.write', { value: 7 }), { makeWorld: path => new InvalidStatusWorld(path) });
  await runtime.inputs.submit(input('write')); await runtime.inputs.submit(input('later')); await runtime.inputs.idle(); await runtime.stop();
  assert.equal(JSON.parse(await readFile(world.path, 'utf8')).version, 1);
  assert.ok((await store.read()).some(entry => entry.kind === 'tool_outcome' && entry.outcome.status === 'unknown'));
  assert.equal(runtime.inputs.inspect('later')?.result?.status, 'cancelled');
});
