import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { it, type TestContext } from 'node:test';
import { Runtime } from '../../src/runtime/runtime.ts';
import { ConversationAgent } from '../../src/agent/conversation-agent.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import { TaskObservationWorld } from '../fixtures/task-observation-world.ts';
import { ManualHeartbeat, runM5Sample } from '../../scripts/m5-sample.ts';
import { TaskTools } from '../../src/agent/task-tools.ts';
import type { Agent, AgentContext, InputLimits, JsonObject, ProviderResponse, SessionEntry, SessionStore, TaskLimits, TaskRunPort, ToolCall, ToolExecutionContext, UserInput, WorldStream } from '../../src/protocol/index.ts';
import { STANDARD_TASK_LIMITS } from '../../src/protocol/index.ts';

const stop = (text = 'done'): ProviderResponse => ({ finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: text } });
const tool = (name: string, args: JsonObject, callId = name): ProviderResponse => ({ finishReason: 'tool_calls', toolCalls: [{ callId, toolName: name, arguments: args }] });
const wakeAt = '2030-01-01T00:00:00.000Z';
const create = (intent = 'observe later') => tool('agent_task_create', { intent, status: 'waiting', schedule: { wakeAt } });
const input = (inputId: string) => ({ inputId, source: 'console', content: { kind: 'text' as const, text: inputId } });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function gate() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function setup(t: TestContext, responses: ConstructorParameters<typeof ScriptedProvider>[0], options: { directory?: string; wrap?: (store: JsonlSessionStore) => SessionStore; agent?: Agent; limits?: Partial<TaskLimits>; inputLimits?: Partial<InputLimits>; worldFactory?: (directory: string, stream: WorldStream) => TaskObservationWorld } = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'bot-task-'));
  const path = join(directory, 'session.jsonl');
  const store = new JsonlSessionStore(path);
  const ticks = new ManualHeartbeat();
  const clock = { now: Date.parse('2029-01-01T00:00:00Z') };
  const stream = { streamId: 'facts', epoch: 'tasks-1' };
  const world = options.worldFactory?.(directory, stream) ?? new TaskObservationWorld(directory, stream, 'tasks');
  const runtime = new Runtime({ world, session: options.wrap?.(store) ?? store, state: new MemoryState(),
    agent: options.agent ?? new ConversationAgent({ sessionId: 'tasks', tasks: true }), provider: new ScriptedProvider(responses), worldStreams: [stream], heartbeat: { source: ticks }, taskClock: () => clock.now,
    ...(options.limits ? { taskLimits: options.limits } : {}), ...(options.inputLimits ? { inputLimits: options.inputLimits } : {}) });
  await runtime.start();
  t.after(async () => { await runtime.stop().catch(() => undefined); });
  return { runtime, store, directory, path, ticks, clock, world, stream };
}
async function run(runtime: Runtime, id: string) { await runtime.inputs.submit(input(id)); await runtime.triggers.idle(); return runtime.inputs.inspect(id)!.result!; }

it('closes ordered perception, task waiting, one-shot wake and explicit completion across fresh runtimes', { timeout: 6000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-task-sample-'));
  const seed = await runM5Sample(directory, 'seed');
  assert.equal(seed.progress?.settledPrefix, 1);
  assert.equal(seed.task?.status, 'waiting'); assert.equal(seed.task?.schedule?.consumedByRunId, undefined);
  const wake = await runM5Sample(directory, 'wake');
  assert.equal(wake.task?.status, 'completed'); assert.equal(wake.task?.schedule?.revision, 1);
  assert.equal(wake.observation?.value, 7); assert.equal(wake.observation?.version, 1);
  assert.equal(wake.modelCalls, 4); assert.equal(wake.tasks?.length, 0);
  const inspect = await runM5Sample(directory, 'inspect');
  assert.equal(inspect.modelCalls, 0); assert.equal(inspect.task?.lastAttempt?.status, 'succeeded');
  assert.equal(inspect.diagnosis.status, 'ready');
});

it('does no model work before due time and never consumes the same arrangement twice', { timeout: 5000 }, async t => {
  let calls = 0;
  const { runtime, ticks, clock, store } = await setup(t, (_request, index) => { ++calls; return index === 0 ? create() : stop(); });
  await run(runtime, 'create'); ticks.tick(); await runtime.triggers.idle(); assert.equal(calls, 2);
  clock.now = Date.parse(wakeAt); ticks.tick(); await runtime.triggers.idle(); assert.equal(calls, 3);
  for (let i = 0; i < 3; ++i) { ticks.tick(); await runtime.triggers.idle(); }
  assert.equal(calls, 3); assert.equal(runtime.tasks.snapshot()[0]?.status, 'waiting');
  assert.equal((await store.read()).filter(entry => entry.kind === 'task_claimed').length, 1);
  assert.equal(runtime.tasks.snapshot()[0]?.revision, 1);
});

it('keeps consumption through content updates and permits only an explicit new schedule to rearm', { timeout: 5000 }, async t => {
  const responses = [create(), stop(), stop(), tool('agent_task_update', { taskId: 'task-1', expectedRevision: 1, intent: 'still waiting' }), stop(),
    tool('agent_task_update', { taskId: 'task-1', expectedRevision: 2, schedule: { wakeAt } }), stop(), stop()];
  const { runtime, ticks, clock, store } = await setup(t, responses);
  await run(runtime, 'create'); clock.now = Date.parse(wakeAt); ticks.tick(); await runtime.triggers.idle();
  const consumed = runtime.tasks.snapshot()[0]!.schedule!.consumedByRunId;
  await run(runtime, 'edit'); ticks.tick(); await runtime.triggers.idle();
  assert.equal(runtime.tasks.snapshot()[0]?.schedule?.consumedByRunId, consumed);
  assert.equal(runtime.tasks.snapshot()[0]?.scheduleRevision, 1);
  await run(runtime, 'rearm'); ticks.tick(); await runtime.triggers.idle();
  const task = runtime.tasks.snapshot()[0]!;
  assert.equal(task.scheduleRevision, 2); assert.notEqual(task.schedule?.consumedByRunId, consumed);
  assert.equal((await store.read()).filter(entry => entry.kind === 'task_claimed').length, 2);
});

it('processes only one of several due tasks per heartbeat', { timeout: 5000 }, async t => {
  const { runtime, ticks, clock, store } = await setup(t, [create('first'), stop(), create('second'), stop(), stop(), stop()]);
  await run(runtime, 'first'); await run(runtime, 'second'); clock.now = Date.parse(wakeAt);
  ticks.tick(); ticks.tick(); await runtime.triggers.idle();
  assert.equal((await store.read()).filter(entry => entry.kind === 'task_claimed').length, 1);
  ticks.tick(); await runtime.triggers.idle();
  assert.equal((await store.read()).filter(entry => entry.kind === 'task_claimed').length, 2);
});

it('publishes only confirmed changes and preserves entered commits through cancellation before the next run', { timeout: 5000 }, async t => {
  const writing = gate(), release = gate(); let port: TaskRunPort | undefined;
  class CapturingAgent extends ConversationAgent {
    override async initialInputRequest(value: UserInput, context: AgentContext) { port ??= context.tasks; return super.initialInputRequest(value, context); }
  }
  t.after(() => release.resolve());
  const requests: string[] = [];
  const { runtime, store } = await setup(t, (request, index) => { requests.push(JSON.stringify(request)); return index === 0 ? create() : stop(); }, {
    agent: new CapturingAgent({ sessionId: 'tasks', tasks: true }), wrap: store => ({ read: () => store.read(), scan: signal => store.scan(signal), append: async entry => {
      if (entry.kind === 'task_changed') { writing.resolve(); await release.promise; } await store.append(entry);
    } }),
  });
  await runtime.inputs.submit(input('A')); await writing.promise;
  assert.equal(runtime.tasks.snapshot().length, 0);
  await runtime.inputs.submit(input('B-queued')); await runtime.inputs.cancel('A'); await turn();
  assert.equal(runtime.inputs.inspect('B-queued')?.status, 'queued');
  release.resolve(); await runtime.triggers.idle();
  assert.equal(runtime.tasks.snapshot()[0]?.status, 'waiting'); assert.equal(runtime.inputs.inspect('A')?.result?.status, 'cancelled');
  assert.equal(runtime.inputs.inspect('B-queued')?.result?.status, 'succeeded');
  const entries = await store.read();
  const change = entries.findIndex(entry => entry.kind === 'task_changed');
  const terminal = entries.findIndex(entry => entry.kind === 'run_finished' && entry.inputId === 'A');
  assert.ok(change < terminal); assert.equal(entries.some(entry => entry.kind === 'tool_outcome' && entry.outcome.status === 'unknown'), false);
  await assert.rejects(async () => port!.update({ taskId: 'task-1', expectedRevision: 1, intent: 'late' }), /no longer owns/);
  assert.equal((await store.read()).filter(entry => entry.kind === 'task_changed').length, 1);
  assert.equal(requests[1]?.includes('Confirmed Agent tasks'), true);
});

it('lets continuation see its confirmed task while keeping queued input facts outside the active run', { timeout: 5000 }, async t => {
  const writing = gate(), release = gate(); const requests: string[] = [];
  t.after(() => release.resolve());
  const { runtime } = await setup(t, (request, index) => { requests.push(JSON.stringify(request)); return index === 0 ? create('A task') : stop(); }, { wrap: store => ({
    read: () => store.read(), scan: signal => store.scan(signal), append: async entry => { if (entry.kind === 'task_changed') { writing.resolve(); await release.promise; } await store.append(entry); },
  }) });
  await runtime.inputs.submit(input('A')); await writing.promise; await runtime.inputs.submit(input('B-exclusive-text')); release.resolve(); await runtime.triggers.idle();
  assert.equal(requests[1]?.includes('A task'), true); assert.equal(requests[1]?.includes('B-exclusive-text'), false);
  assert.equal(requests[2]?.includes('B-exclusive-text'), true);
});

it('waits for an entered task write beyond its tool deadline and preserves the confirmed receipt', { timeout: 5000 }, async t => {
  const writing = gate(), release = gate(); t.after(() => release.resolve());
  const { runtime, store } = await setup(t, [create(), stop()], { inputLimits: { toolMs: 10 }, wrap: store => ({
    read: () => store.read(), scan: signal => store.scan(signal), append: async entry => { if (entry.kind === 'task_changed') { writing.resolve(); await release.promise; } await store.append(entry); },
  }) });
  await runtime.inputs.submit(input('deadline')); await writing.promise;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(runtime.inputs.inspect('deadline')?.status, 'running'); assert.equal(runtime.tasks.snapshot().length, 0);
  release.resolve(); await runtime.triggers.idle();
  assert.equal(runtime.inputs.inspect('deadline')?.result?.status, 'succeeded');
  assert.equal((await store.read()).find(entry => entry.kind === 'tool_outcome')?.kind, 'tool_outcome');
  assert.equal((await store.read()).some(entry => entry.kind === 'tool_outcome' && entry.outcome.status === 'unknown'), false);
});

it('times out a noncooperating Agent tool and rejects its late commit without halting later input', { timeout: 5000 }, async t => {
  const release = gate(), late = gate(); const tools = new TaskTools(); let lateCode = '';
  class SlowAgent extends ConversationAgent {
    override readonly taskTools = { tools: () => tools.tools(), executeTool: async (call: import('../../src/protocol/index.ts').ToolCall, context: AgentContext) => {
      await release.promise;
      const outcome = await tools.executeTool(call, context); lateCode = outcome.error?.code ?? ''; late.resolve(); return outcome;
    } };
  }
  t.after(() => release.resolve());
  const { runtime, store } = await setup(t, [create(), stop()], { agent: new SlowAgent({ sessionId: 'tasks' }), inputLimits: { toolMs: 10 } });
  const result = await run(runtime, 'slow'); assert.equal(result.code, 'tool_timeout'); assert.equal(runtime.status, 'running');
  release.resolve(); await late.promise;
  assert.equal(lateCode, 'task_revoked'); assert.equal(runtime.tasks.snapshot().length, 0);
  assert.equal((await run(runtime, 'next')).status, 'succeeded');
  assert.equal((await store.read()).some(entry => entry.kind === 'task_changed'), false);
});

it('consumes a saved claim even when normal stop prevents the first model call', { timeout: 5000 }, async t => {
  const writing = gate(), release = gate(); let calls = 0; t.after(() => release.resolve());
  const { runtime, ticks, clock, store } = await setup(t, (_request, index) => { ++calls; return index === 0 ? create() : stop(); }, { wrap: store => ({
    read: () => store.read(), scan: signal => store.scan(signal), append: async entry => { if (entry.kind === 'task_claimed') { writing.resolve(); await release.promise; } await store.append(entry); },
  }) });
  await run(runtime, 'create'); clock.now = Date.parse(wakeAt); ticks.tick(); await writing.promise;
  assert.equal(runtime.tasks.snapshot()[0]?.schedule?.consumedByRunId, undefined);
  const stopped = runtime.stop(); await turn(); assert.equal(runtime.status, 'stopping');
  release.resolve(); await stopped;
  assert.equal(calls, 2); assert.ok(runtime.tasks.snapshot()[0]?.schedule?.consumedByRunId);
  assert.equal(runtime.tasks.snapshot()[0]?.lastAttempt?.status, 'cancelled');
  await runtime.start(); ticks.tick(); await runtime.triggers.idle();
  assert.equal(calls, 2); assert.equal((await store.read()).filter(entry => entry.kind === 'task_claimed').length, 1);
});

for (const stage of ['task_changed', 'task_claimed'] as const) it(`stops admission on ${stage} storage failure without dispatching the unconfirmed attempt`, { timeout: 5000 }, async t => {
  let calls = 0;
  const { runtime, ticks, clock } = await setup(t, (_request, index) => { ++calls; return index === 0 ? create() : stop(); }, { wrap: store => ({
    read: () => store.read(), scan: signal => store.scan(signal), append: entry => entry.kind === stage ? Promise.reject(new Error('task disk unavailable')) : store.append(entry),
  }) });
  await run(runtime, 'create');
  if (stage === 'task_claimed') { clock.now = Date.parse(wakeAt); ticks.tick(); await runtime.triggers.idle(); }
  await turn();
  assert.equal(runtime.diagnosis.status, 'blocked'); assert.equal((await runtime.inputs.submit(input('later'))).status, 'rejected');
  assert.equal(calls, stage === 'task_changed' ? 1 : 2);
  if (stage === 'task_changed') assert.equal(runtime.tasks.snapshot().length, 0);
  else assert.equal(runtime.tasks.snapshot()[0]?.schedule?.consumedByRunId, undefined);
});

it('retains successful effects in a failed attempt and actually supplies full evidence to a subsequent model turn', { timeout: 6000 }, async t => {
  let failedRun = ''; const requests: string[] = [];
  const { runtime, ticks, clock, world, store } = await setup(t, (request, index) => {
    requests.push(JSON.stringify(request));
    if (index === 0) return create(); if (index === 1) return stop();
    if (index === 2) return tool('fixture.set', { key: 'answer', value: 7 }, 'actual-effect');
    if (index === 3) return { finishReason: 'error', toolCalls: [], error: { code: 'ordinary_failure', message: 'model failed after effect' } };
    if (index === 4) return tool('agent_task_evidence', { taskId: 'task-1', runId: failedRun });
    if (index === 6) return tool('agent_task_update', { taskId: 'task-1', expectedRevision: 1, schedule: { wakeAt } });
    return stop();
  });
  await run(runtime, 'create'); clock.now = Date.parse(wakeAt); ticks.tick(); await runtime.triggers.idle();
  const task = runtime.tasks.snapshot()[0]!; failedRun = task.lastAttempt!.runId;
  assert.equal(task.lastAttempt?.status, 'failed'); assert.equal(task.lastAttempt?.effects.find(effect => effect.callId === 'actual-effect')?.status, 'succeeded');
  ticks.tick(); await runtime.triggers.idle(); assert.equal(requests.length, 4);
  assert.equal((await world.observation('answer')).version, 1);
  const inspected = await run(runtime, 'inspect-effects'); assert.equal(inspected.status, 'succeeded');
  assert.equal(requests[4]?.includes('ordinary_failure'), true); assert.equal(requests[4]?.includes('actual-effect'), true);
  const evidence = (await store.read()).find(entry => entry.kind === 'tool_outcome' && entry.outcome.toolName === 'agent_task_evidence');
  assert.equal(evidence?.kind === 'tool_outcome' && evidence.outcome.status, 'succeeded');
  assert.equal(requests[5]?.includes('model failed after effect'), true);
  assert.equal(requests[5]?.includes('actual-effect'), true);
  await assert.rejects(runtime.tasks.evidence('task-1', failedRun, 64), /exceeds its budget/);
  await run(runtime, 'rearm-after-inspection'); ticks.tick(); await runtime.triggers.idle();
  assert.equal(requests[8]?.includes('actual-effect'), true); assert.equal(requests[8]?.includes('ordinary_failure'), true);
  assert.equal(runtime.tasks.snapshot()[0]?.effectAttempt?.runId, failedRun);
  assert.equal((await world.observation('answer')).version, 1);
});

it('frees active capacity on completion, never reuses task identity and reads archived intent', { timeout: 5000 }, async t => {
  const { runtime, store } = await setup(t, [create('first'), stop(), create('over capacity'), stop(),
    tool('agent_task_update', { taskId: 'task-1', expectedRevision: 1, status: 'completed' }), stop(), create('second'), stop()], { limits: { activeTasks: 1 } });
  await run(runtime, 'create'); await run(runtime, 'overflow');
  assert.equal(runtime.tasks.snapshot().length, 1);
  assert.equal((await store.read()).some(entry => entry.kind === 'tool_outcome' && entry.outcome.error?.code === 'task_capacity'), true);
  await run(runtime, 'complete'); await run(runtime, 'new');
  assert.equal(runtime.tasks.snapshot()[0]?.taskId, 'task-2');
  assert.equal((await runtime.tasks.read('task-1'))?.status, 'completed');
  assert.equal((await runtime.tasks.read('task-1'))?.lastAttempt?.status, 'succeeded');
});

it('rejects stale expected revision and oversized state without changing the confirmed task', { timeout: 5000 }, async t => {
  const { runtime, store } = await setup(t, [create(), stop(),
    tool('agent_task_update', { taskId: 'task-1', expectedRevision: 2, intent: 'stale' }), stop(),
    create('x'.repeat(STANDARD_TASK_LIMITS.stateBytes)), stop()]);
  await run(runtime, 'create'); await run(runtime, 'stale'); await run(runtime, 'huge');
  assert.equal(runtime.tasks.snapshot()[0]?.revision, 1);
  const errors = (await store.read()).flatMap(entry => entry.kind === 'tool_outcome' && entry.outcome.error ? [entry.outcome.error.code] : []);
  assert.ok(errors.includes('task_conflict')); assert.ok(errors.includes('task_limit'));
});

it('bounds model task candidates and puts the selected due task ahead of omitted items', { timeout: 5000 }, async t => {
  const requests: string[] = [];
  const first = tool('agent_task_create', { intent: 'future', status: 'waiting', schedule: { wakeAt: '2031-01-01T00:00:00Z' } });
  const responses = [first, stop(), create('due'), stop(), stop()];
  const { runtime, ticks, clock } = await setup(t, (request, index) => { requests.push(request.messages.find(message => message.content.startsWith('Confirmed Agent tasks:'))!.content); return responses[index]!; },
    { limits: { stateBytes: 256, viewBytes: 640 } });
  await run(runtime, 'future'); await run(runtime, 'due'); clock.now = Date.parse(wakeAt); ticks.tick(); await runtime.triggers.idle();
  const view = JSON.parse(requests[4]!.slice('Confirmed Agent tasks: '.length).split('. A claimed')[0]!) as { items: { taskId: string }[]; omitted: number };
  assert.equal(view.items[0]?.taskId, 'task-2'); assert.equal(view.omitted, 1);
});

it('bounds effect references while retaining real totals, run identity and disk evidence', { timeout: 5000 }, async t => {
  const batch: ProviderResponse = { finishReason: 'tool_calls', toolCalls: [
    { callId: 'one', toolName: 'fixture.set', arguments: { key: 'answer', value: 1 } },
    { callId: 'two', toolName: 'fixture.observe', arguments: { key: 'answer' } },
    { callId: 'three', toolName: 'fixture.set', arguments: { key: 'answer', value: 2 } },
    { callId: 'task', toolName: 'agent_task_create', arguments: { intent: 'remember effects', status: 'active' } },
  ] };
  const { runtime, world } = await setup(t, [batch, stop()], { limits: { effects: 2 } });
  await run(runtime, 'effects'); const task = runtime.tasks.snapshot()[0]!;
  assert.equal(task.effectAttempt?.effects.length, 2); assert.equal(task.effectAttempt?.omittedEffects, 1);
  assert.equal(task.effectAttempt?.effectTotals.succeeded, 3); assert.equal((await world.observation('answer')).version, 2);
  const evidence = await runtime.tasks.evidence(task.taskId, task.effectAttempt!.runId);
  assert.equal(evidence.filter(entry => entry.kind === 'tool_outcome' && entry.owner === 'world').length, 3);
});

it('keeps terminal attempt summaries within their byte budget when the failure code is very long', { timeout: 5000 }, async t => {
  const longCode = 'failure'.repeat(STANDARD_TASK_LIMITS.stateBytes);
  const { runtime, ticks, clock, store } = await setup(t, [create(), stop(), tool('fixture.set', { key: 'answer', value: 7 }),
    { finishReason: 'error', toolCalls: [], error: { code: longCode, message: 'failed after a real effect' } }]);
  await run(runtime, 'create'); clock.now = Date.parse(wakeAt); ticks.tick(); await runtime.triggers.idle();
  const task = runtime.tasks.snapshot()[0]!;
  assert.ok(Buffer.byteLength(JSON.stringify(task.lastAttempt)) <= STANDARD_TASK_LIMITS.stateBytes);
  assert.ok(Buffer.byteLength(JSON.stringify(task.effectAttempt)) <= STANDARD_TASK_LIMITS.stateBytes);
  assert.equal(task.effectAttempt?.effects[0]?.status, 'succeeded'); assert.equal(task.lastAttempt?.status, 'failed');
  assert.equal((await store.read()).find(entry => entry.kind === 'run_finished' && entry.runId === task.lastAttempt?.runId)?.kind, 'run_finished');
  assert.ok((await store.read()).some(entry => entry.kind === 'run_finished' && entry.result.code === longCode));
});

it('diagnoses task storage capability before opening World resources', { timeout: 3000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-task-capability-'));
  const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
  const world = new TaskObservationWorld(directory, { streamId: 'facts', epoch: 'e' }, 'tasks');
  const runtime = new Runtime({ world: { id: world.id, start: signal => world.start(signal), stop: () => world.stop(), tools: () => world.tools(), executeTool: (call, context) => world.executeTool(call, context) },
    session: { read: () => store.read(), append: entry => store.append(entry) }, state: new MemoryState(), agent: new ConversationAgent({ sessionId: 'tasks', tasks: true }), provider: new ScriptedProvider([]) });
  await assert.rejects(runtime.start(), /requires Session.scan/); assert.deepEqual(world.lifecycle, []);
});

it('rejects conflicting tool ownership before model or World tool execution', { timeout: 3000 }, async t => {
  let calls = 0;
  class ConflictingWorld extends TaskObservationWorld { override tools() { return [...super.tools(), { name: 'agent_task_create', description: 'conflict', inputSchema: { type: 'object' } }]; } }
  const { runtime, world } = await setup(t, () => { ++calls; return stop(); }, { worldFactory: (directory, stream) => new ConflictingWorld(directory, stream, 'tasks') });
  assert.equal((await run(runtime, 'conflict')).code, 'tool_name_conflict'); assert.equal(calls, 0);
  assert.equal((await world.observation('answer')).version, 0); assert.equal(runtime.status, 'running');
});

it('retains a consumed task and blocks queued work and restart after a real unconfirmed World effect', { timeout: 5000 }, async t => {
  const entered = gate(), release = gate(); t.after(() => release.resolve());
  class UnknownWorld extends TaskObservationWorld {
    override async executeTool(call: ToolCall, context: ToolExecutionContext) {
      const outcome = await super.executeTool(call, context);
      if (call.toolName === 'fixture.set') { entered.resolve(); await release.promise; return { ...outcome, status: 'unknown' as const, error: { code: 'unconfirmed', message: 'Effect occurred but its confirmation was lost' } }; }
      return outcome;
    }
  }
  const { runtime, ticks, clock, world } = await setup(t, [create(), stop(), tool('fixture.set', { key: 'answer', value: 7 })],
    { worldFactory: (directory, stream) => new UnknownWorld(directory, stream, 'tasks') });
  await run(runtime, 'create'); clock.now = Date.parse(wakeAt); ticks.tick(); await entered.promise;
  await runtime.inputs.submit(input('queued')); release.resolve(); await runtime.triggers.idle(); await runtime.stop();
  assert.equal((await world.observation('answer')).version, 1); assert.equal(runtime.inputs.inspect('queued')?.result?.status, 'cancelled');
  assert.equal(runtime.tasks.snapshot()[0]?.effectAttempt?.effectTotals.unknown, 1);
  assert.ok(runtime.tasks.snapshot()[0]?.schedule?.consumedByRunId);
  const before = world.lifecycle.length; await assert.rejects(runtime.start(), /requires diagnosis/); assert.equal(world.lifecycle.length, before);
});

it('blocks task schema and consumption corruption before World startup', { timeout: 7000 }, async t => {
  const { runtime, store, directory, ticks, clock, stream } = await setup(t, [create(), stop(), stop()]);
  await run(runtime, 'create'); clock.now = Date.parse(wakeAt); ticks.tick(); await runtime.triggers.idle(); await runtime.stop();
  const entries = await store.read();
  const variations: ((entry: SessionEntry) => void)[] = [
    entry => { if (entry.kind === 'task_claimed') entry.scheduleRevision += 1; },
    entry => { if (entry.kind === 'task_changed') entry.task.revision += 1; },
    entry => { if (entry.kind === 'task_claimed') entry.sessionId = 'other-session'; },
    entry => { if (entry.kind === 'task_claimed') entry.checkedAt = '2029-01-01T00:00:00Z'; },
  ];
  for (const [index, mutate] of variations.entries()) {
    const copy = structuredClone(entries); copy.forEach(mutate); const path = join(directory, `corrupt-${index}.jsonl`);
    await writeFile(path, copy.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const world = new TaskObservationWorld(directory, stream, 'tasks');
    const next = new Runtime({ world, session: new JsonlSessionStore(path), state: new MemoryState(), agent: new ConversationAgent({ sessionId: 'tasks', tasks: true }), provider: new ScriptedProvider([]), worldStreams: [stream] });
    await assert.rejects(next.start(), /requires diagnosis/); assert.equal(next.diagnosis.status, 'blocked'); assert.deepEqual(world.lifecycle, []);
  }
});

async function child(directory: string, phase: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['--experimental-strip-types', 'scripts/m5-sample.ts', directory, phase], { cwd: globalThis.process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { process.kill(); reject(new Error(`Child phase ${phase} exceeded 8 seconds`)); }, 8000);
    process.stdout.on('data', chunk => { output += String(chunk); }); process.stderr.on('data', chunk => { output += String(chunk); });
    process.on('error', error => { clearTimeout(timer); reject(error); }); process.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}
it('rebuilds in independent processes and blocks a real exit after saved claim instead of replaying the attempt', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-task-process-'));
  const seed = await child(directory, 'seed'); assert.equal(seed.code, 0, seed.output);
  const crash = await child(directory, 'crash_claim'); assert.equal(crash.code, 23, crash.output);
  const inspection = await child(directory, 'inspect'); assert.equal(inspection.code, 0, inspection.output);
  const result = JSON.parse(inspection.output.trim()) as { diagnosis: { status: string }; modelCalls: number; worldLifecycle: string[] };
  assert.equal(result.diagnosis.status, 'blocked'); assert.equal(result.modelCalls, 0); assert.deepEqual(result.worldLifecycle, []);
  const raw = await readFile(join(directory, 'session.jsonl'), 'utf8');
  assert.equal(raw.split('\n').filter(line => line.includes('"kind":"task_claimed"')).length, 1);
});

it('rebuilds a clean waiting task and consumed completion in new operating-system processes', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-task-clean-process-'));
  for (const phase of ['seed', 'wake', 'inspect']) {
    const result = await child(directory, phase); assert.equal(result.code, 0, result.output);
    const report = JSON.parse(result.output) as { modelCalls: number; task: { status: string }; diagnosis: { status: string } };
    assert.equal(report.diagnosis.status, 'ready');
    if (phase === 'inspect') { assert.equal(report.modelCalls, 0); assert.equal(report.task.status, 'completed'); }
  }
});
