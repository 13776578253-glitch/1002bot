import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, type TestContext } from 'node:test';
import { ConversationAgent } from '../../src/agent/conversation-agent.ts';
import type { InputLimits, OutputEvent, ProviderResponse, SessionEntry, SessionStore, ToolCall, ToolExecutionContext, ToolOutcome, UserInput } from '../../src/protocol/index.ts';
import { STANDARD_INPUT_LIMITS } from '../../src/protocol/index.ts';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import { Runtime } from '../../src/runtime/runtime.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';

const text = (inputId: string, value = inputId): UserInput => ({ inputId, source: 'test', content: { kind: 'text', text: value } });
const done = (reply = 'done'): ProviderResponse => ({ finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: reply } });
const calls = (...toolCalls: ToolCall[]): ProviderResponse => ({ finishReason: 'tool_calls', toolCalls });
const call = (callId: string, toolName = 'fixture.set', args: ToolCall['arguments'] = { key: 'x', value: 7 }): ToolCall => ({ callId, toolName, arguments: args });
function gate<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function setup(t: TestContext, responses: ConstructorParameters<typeof ScriptedProvider>[0], options: { world?: FixtureWorld; limits?: Partial<InputLimits>; wrap?: (store: SessionStore) => SessionStore } = {}) {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-input-')), 'session.jsonl'));
  const world = options.world ?? new FixtureWorld();
  const runtime = new Runtime({ agent: new ConversationAgent({ sessionId: 'input-test' }), provider: new ScriptedProvider(responses),
    world, session: options.wrap?.(store) ?? store, state: new MemoryState(), ...(options.limits ? { inputLimits: options.limits } : {}) });
  const events: OutputEvent[] = [];
  runtime.inputs.subscribe((event) => events.push(event));
  await runtime.start();
  t.after(() => runtime.stop());
  return { runtime, store, world, events };
}
function wait(runtime: Runtime, type: OutputEvent['type'], inputId?: string): Promise<OutputEvent> {
  return new Promise((resolve) => {
    const off = runtime.inputs.subscribe((event) => { if (event.type === type && (!inputId || event.inputId === inputId)) { off(); resolve(event); } });
  });
}

it('accepts FIFO inputs and completes two tool rounds through real JSONL and World', { timeout: 3000 }, async (t) => {
  const { runtime, store, world, events } = await setup(t, (request) => {
    const latest = request.messages.at(-1)!;
    if (latest.role === 'user') return latest.content === 'set then read' ? calls(call('write')) : done(latest.content);
    const outcome = JSON.parse(latest.content) as ToolOutcome;
    return outcome.callId === 'write' ? calls(call('read', 'fixture.get', { key: 'x' })) : done(`value=${JSON.stringify(outcome.output)}`);
  });
  assert.equal((await runtime.inputs.submit(text('one', 'set then read'))).status, 'accepted');
  assert.equal((await runtime.inputs.submit(text('two', 'second'))).status, 'accepted');
  await runtime.inputs.idle();
  assert.equal(world.value('x'), 7);
  assert.equal(runtime.inputs.inspect('one')?.result?.reply, 'value=7');
  assert.equal(runtime.inputs.inspect('two')?.result?.reply, 'second');
  assert.deepEqual(events.filter((event) => event.type === 'run_finished').map((event) => event.inputId), ['one', 'two']);
  const entries = await store.read();
  assert.equal(entries.filter((entry) => entry.kind === 'run_finished').length, 2);
  assert.equal(entries.filter((entry) => entry.kind === 'tool_outcome').length, 2);
  assert.ok(events.filter((event) => event.type === 'run_finished').every((event) => event.result?.persisted));
});

it('rejects invalid input, duplicates, a full pending queue and admission exhaustion', { timeout: 3000 }, async (t) => {
  const release = gate<ProviderResponse>();
  const started = gate();
  const { runtime } = await setup(t, async (_request, index) => { if (!index) { started.resolve(); return release.promise; } return done(); }, { limits: { pendingInputs: 1, admissionIds: 2 } });
  assert.equal((await runtime.inputs.submit({ ...text('bad'), extra: true } as UserInput)).status, 'rejected');
  assert.equal((await runtime.inputs.submit(text('large', '中'.repeat(STANDARD_INPUT_LIMITS.textBytes)))).status, 'rejected');
  await runtime.inputs.submit(text('first'));
  await started.promise;
  assert.equal((await runtime.inputs.submit(text('first')) as { code: string }).code, 'duplicate_input');
  await runtime.inputs.submit(text('second'));
  assert.equal((await runtime.inputs.submit(text('third')) as { code: string }).code, 'admission_limit');
  release.resolve(done());
  await runtime.inputs.idle();
  await runtime.stop();
  await runtime.start();
  assert.equal((await runtime.inputs.submit(text('first')) as { code: string }).code, 'duplicate_input');
});

it('counts queue capacity without the executing input and cancels queued input once', { timeout: 3000 }, async (t) => {
  const release = gate<ProviderResponse>();
  const started = gate();
  const { runtime, store } = await setup(t, () => { started.resolve(); return release.promise; }, { limits: { pendingInputs: 1 } });
  await runtime.inputs.submit(text('active'));
  await started.promise;
  assert.equal((await runtime.inputs.submit(text('queued'))).status, 'accepted');
  assert.equal((await runtime.inputs.submit(text('full')) as { code: string }).code, 'queue_full');
  assert.equal((await runtime.inputs.cancel('queued')).status, 'cancelled');
  assert.equal((await runtime.inputs.cancel('queued')).status, 'already_finished');
  release.resolve(done());
  await runtime.inputs.idle();
  assert.equal((await store.read()).filter((entry) => entry.kind === 'run_finished' && entry.inputId === 'queued').length, 1);
});

it('expires queued input independently of the active deadline', { timeout: 3000 }, async (t) => {
  const started = gate();
  const release = gate<ProviderResponse>();
  const { runtime } = await setup(t, () => { started.resolve(); return release.promise; }, { limits: { queueMs: 15 } });
  await runtime.inputs.submit(text('active'));
  await started.promise;
  const expired = wait(runtime, 'run_finished', 'queued');
  await runtime.inputs.submit(text('queued'));
  assert.equal((await expired).result?.code, 'queue_expired');
  release.resolve(done());
  await runtime.inputs.idle();
});

for (const response of [
  { toolCalls: [], finishReason: 'stop' as const },
  { toolCalls: [], finishReason: 'length' as const },
  { toolCalls: [], finishReason: 'error' as const, error: { code: 'model_failed', message: 'failed' } },
  calls(...Array.from({ length: STANDARD_INPUT_LIMITS.toolCalls + 1 }, (_, index) => call(`batch-${index}`))),
  calls(call('same'), call('same')),
]) {
  it(`ends malformed or incomplete model response as failed (${response.finishReason}, ${response.toolCalls.length} calls)`, { timeout: 3000 }, async (t) => {
    const { runtime, world } = await setup(t, [response]);
    await runtime.inputs.submit(text('bad'));
    await runtime.inputs.idle();
    assert.equal(runtime.inputs.inspect('bad')?.result?.status, 'failed');
    assert.equal(world.value('x'), undefined);
  });
}

it('ends a tool loop at its request limit without pretending there is a final reply', { timeout: 3000 }, async (t) => {
  const { runtime, world } = await setup(t, [calls(call('write'))], { limits: { providerCalls: 1 } });
  await runtime.inputs.submit(text('limit'));
  await runtime.inputs.idle();
  assert.equal(world.value('x'), 7);
  assert.equal(runtime.inputs.inspect('limit')?.result?.code, 'round_limit');
});

it('ignores a cancelled model completion and advances to the next input', { timeout: 3000 }, async (t) => {
  const started = gate();
  const release = gate<ProviderResponse>();
  const { runtime, store } = await setup(t, (_request, index) => { if (!index) { started.resolve(); return release.promise; } return done('next'); });
  await runtime.inputs.submit(text('old'));
  await started.promise;
  await runtime.inputs.submit(text('next'));
  await runtime.inputs.cancel('old');
  await runtime.inputs.idle();
  release.resolve(calls(call('late')));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runtime.inputs.inspect('old')?.result?.status, 'cancelled');
  assert.equal(runtime.inputs.inspect('next')?.result?.reply, 'next');
  assert.equal((await store.read()).some((entry) => entry.kind === 'tool_call'), false);
});

for (const deadline of ['providerMs', 'runMs'] as const) {
  it(`terminates an uncooperative Provider at ${deadline}`, { timeout: 3000 }, async (t) => {
    const { runtime, events } = await setup(t, () => new Promise(() => undefined), { limits: { [deadline]: 15 } });
    await runtime.inputs.submit(text('timeout'));
    await runtime.inputs.idle();
    assert.equal(runtime.inputs.inspect('timeout')?.result?.code, deadline === 'providerMs' ? 'provider_timeout' : 'run_timeout');
    assert.equal(runtime.status, 'running');
    const finished = events.find((event) => event.type === 'provider_finished');
    assert.equal(finished?.round, 1);
    assert.equal(finished?.error?.code, deadline === 'providerMs' ? 'provider_timeout' : 'run_timeout');
  });
}

for (const cancel of [false, true]) {
  it(`${cancel ? 'cancels' : 'times out'} an unresolved tool, diagnoses the remaining batch and stops queued work`, { timeout: 3000 }, async (t) => {
    const entered = gate();
    const release = gate<ToolOutcome>();
    class World extends FixtureWorld {
      override async executeTool(_call: ToolCall, _context: ToolExecutionContext) { entered.resolve(); return release.promise; }
    }
    const { runtime, store, events } = await setup(t, [calls(call('executing'), call('not-started'))], { world: new World(), limits: { toolMs: cancel ? 1000 : 15 } });
    await runtime.inputs.submit(text('unknown'));
    await entered.promise;
    await runtime.inputs.submit(text('queued'));
    const stopped = wait(runtime, 'runtime_status');
    if (cancel) await runtime.inputs.cancel('unknown');
    await stopped;
    await runtime.stop();
    release.resolve({ callId: 'executing', toolName: 'fixture.set', status: 'succeeded', output: 99 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const outcomes = (await store.read()).filter((entry) => entry.kind === 'tool_outcome').map((entry) => [entry.outcome.callId, entry.outcome.status]);
    assert.deepEqual(outcomes, [['executing', 'unknown'], ['not-started', 'cancelled']]);
    assert.equal(runtime.inputs.inspect('queued')?.result?.status, 'cancelled');
    assert.equal(events.filter((event) => event.type === 'run_finished' && event.inputId === 'unknown').length, 1);
    assert.equal(runtime.status, 'stopped');
    const diagnostic = events.find((event) => event.type === 'tool_finished' && event.callId === 'executing');
    assert.equal(diagnostic?.round, 1);
    assert.equal(diagnostic?.error?.code, cancel ? 'cancelled' : 'tool_timeout');
  });
}

it('commits lifecycle terminals while stopping and drains a pending Session write', { timeout: 3000 }, async (t) => {
  const entered = gate();
  const release = gate();
  const { runtime, store, events } = await setup(t, [done()], { wrap: (real) => ({
    read: () => real.read(), append: async (entry) => { if (entry.kind === 'input') { entered.resolve(); await release.promise; } await real.append(entry); },
  }) });
  await runtime.inputs.submit(text('writing'));
  await entered.promise;
  await runtime.inputs.submit(text('queued'));
  const stopping = runtime.stop();
  let settled = false;
  void stopping.then(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(runtime.status, 'stopping');
  assert.equal((await runtime.inputs.submit(text('after-stop')) as { code: string }).code, 'not_running');
  release.resolve();
  await stopping;
  const entries = await store.read();
  assert.equal(entries.filter((entry) => entry.kind === 'run_finished').length, 2);
  assert.equal(entries.some((entry) => entry.kind === 'provider_request'), false);
  assert.equal(events.filter((event) => event.type === 'run_finished').length, 2);
});

it('publishes storage_error only after a failing terminal write and isolates listener mutation', { timeout: 3000 }, async (t) => {
  const { runtime, store, events } = await setup(t, [done('reply')], { wrap: (real) => ({
    read: () => real.read(), append: (entry) => entry.kind === 'run_finished' ? Promise.reject(new Error('disk failed')) : real.append(entry),
  }) });
  runtime.inputs.subscribe((event) => { event.type = 'queued'; throw new Error('listener failed'); });
  await runtime.inputs.submit(text('failed-write'));
  await runtime.inputs.idle();
  assert.equal(runtime.inputs.inspect('failed-write')?.result?.code, 'storage_error');
  assert.equal(runtime.inputs.inspect('failed-write')?.result?.persisted, false);
  assert.equal((await store.read()).some((entry) => entry.kind === 'run_finished'), false);
  assert.equal(events.filter((event) => event.type === 'run_finished').length, 1);
});

it('bounds output and snapshots while preserving duplicate IDs after eviction', { timeout: 3000 }, async (t) => {
  const { runtime } = await setup(t, () => done('reply'), { limits: { outputEntries: 3, snapshotEntries: 1 } });
  await runtime.inputs.submit(text('evicted'));
  await runtime.inputs.idle();
  await runtime.inputs.submit(text('retained'));
  await runtime.inputs.idle();
  assert.equal(runtime.inputs.inspect('evicted'), undefined);
  assert.equal((await runtime.inputs.submit(text('evicted')) as { code: string }).code, 'duplicate_input');
  const replay = runtime.inputs.eventsSince(0);
  assert.equal(replay.gap, true);
  assert.ok(replay.events.length <= 3);
  const snapshot = runtime.inputs.inspect('retained')!;
  snapshot.status = 'failed';
  assert.equal(runtime.inputs.inspect('retained')?.status, 'succeeded');
});

it('evicts whole completed runs, preserving native call/result pairs in the active run', { timeout: 3000 }, async (t) => {
  const requests: string[] = [];
  const { runtime, store } = await setup(t, (request, index) => {
    requests.push(JSON.stringify(request));
    if (index < 2) return done('reply');
    if (request.messages.at(-1)?.role === 'user') return calls(call('read', 'fixture.get', { key: 'x' }));
    return done('current complete');
  }, { limits: { requestBytes: 1800, reserveBytes: 400 } });
  for (const id of ['old1', 'old2']) { await runtime.inputs.submit(text(id, id + 'a'.repeat(600))); await runtime.inputs.idle(); }
  await runtime.inputs.submit(text('current'));
  await runtime.inputs.idle();
  const last = JSON.parse(requests.at(-1)!) as { messages: { role: string; content: string; toolCallId?: string; toolCalls?: ToolCall[] }[] };
  assert.equal(last.messages.some((message) => message.content.startsWith('old1')), false);
  assert.equal(last.messages.some((message) => message.toolCalls?.some((item) => item.callId === 'read')), true);
  assert.equal(last.messages.some((message) => message.toolCallId === 'read'), true);
  assert.equal((await store.read()).filter((entry) => entry.kind === 'input').length, 3);
});

it('preserves a successful side effect when its result exceeds the next request budget', { timeout: 3000 }, async (t) => {
  const value = 'x'.repeat(2500);
  const { runtime, store, world } = await setup(t, [calls(call('big', 'fixture.set', { key: 'x', value }))], { limits: { requestBytes: 1800, reserveBytes: 400 } });
  await runtime.inputs.submit(text('capacity'));
  await runtime.inputs.idle();
  assert.equal(world.value('x'), value);
  assert.equal(runtime.inputs.inspect('capacity')?.result?.code, 'context_limit');
  const entries = await store.read();
  assert.equal(entries.filter((entry) => entry.kind === 'provider_request').length, 1);
  assert.equal(entries.filter((entry) => entry.kind === 'tool_outcome' && entry.outcome.status === 'succeeded').length, 1);
});

it('holds the terminal event until the terminal Session append is durable', { timeout: 3000 }, async (t) => {
  const entered = gate();
  const release = gate();
  const { runtime, events, store } = await setup(t, [done()], { wrap: (real) => ({
    read: () => real.read(), append: async (entry) => { if (entry.kind === 'run_finished') { entered.resolve(); await release.promise; } await real.append(entry); },
  }) });
  await runtime.inputs.submit(text('terminal'));
  await entered.promise;
  assert.equal(runtime.inputs.inspect('terminal')?.status, 'write_pending');
  assert.equal(events.some((event) => event.type === 'run_finished'), false);
  assert.equal((await store.read()).some((entry) => entry.kind === 'run_finished'), false);
  const stopping = runtime.stop();
  release.resolve();
  await stopping;
  assert.equal(events.filter((event) => event.type === 'run_finished').length, 1);
  assert.equal(runtime.inputs.inspect('terminal')?.result?.persisted, true);
});

it('rejects the active context before sending a request when whole-run eviction cannot fit it', { timeout: 3000 }, async (t) => {
  let requests = 0;
  const { runtime } = await setup(t, () => { requests++; return done(); }, { limits: { requestBytes: 1800, reserveBytes: 400 } });
  await runtime.inputs.submit(text('context', '汉'.repeat(600)));
  await runtime.inputs.idle();
  assert.equal(runtime.inputs.inspect('context')?.result?.code, 'context_limit');
  assert.equal(requests, 0);
});

it('fails oversized Provider output before executing tools', { timeout: 3000 }, async (t) => {
  const { runtime, world } = await setup(t, [calls(call('large', 'fixture.set', { key: 'x', value: 'x'.repeat(1000) }))], { limits: { responseBytes: 200 } });
  await runtime.inputs.submit(text('response'));
  await runtime.inputs.idle();
  assert.equal(runtime.inputs.inspect('response')?.result?.code, 'response_limit');
  assert.equal(world.value('x'), undefined);
});

it('ends a Provider exception explicitly while keeping the queue usable', { timeout: 3000 }, async (t) => {
  const { runtime } = await setup(t, (_request, index) => { if (!index) throw new Error('offline error'); return done('next'); });
  await runtime.inputs.submit(text('broken'));
  await runtime.inputs.submit(text('next'));
  await runtime.inputs.idle();
  assert.equal(runtime.inputs.inspect('broken')?.result?.code, 'provider_error');
  assert.equal(runtime.inputs.inspect('next')?.result?.reply, 'next');
});

it('allows lifecycle status listeners to reenter start and stop without duplicating cleanup', { timeout: 3000 }, async (t) => {
  const { runtime, world } = await setup(t, []);
  await runtime.stop();
  let start: Promise<void> | undefined;
  let stop: Promise<void> | undefined;
  const off = runtime.inputs.subscribe((event) => {
    if (event.type === 'runtime_status' && event.status === 'starting') start = runtime.start();
    if (event.type === 'runtime_status' && event.status === 'stopping') stop = runtime.stop();
  });
  await runtime.start();
  await start;
  await runtime.stop();
  await stop;
  off();
  assert.deepEqual(world.lifecycle, ['start', 'stop', 'start', 'stop']);
});

it('cancels before dispatch when a tool progress listener stops Runtime', { timeout: 3000 }, async (t) => {
  const { runtime, world, store } = await setup(t, [calls(call('not-executed'))]);
  runtime.inputs.subscribe((event) => { if (event.type === 'tool_started') void runtime.stop(); });
  await runtime.inputs.submit(text('listener-stop'));
  await runtime.inputs.idle();
  await runtime.stop();
  assert.equal(world.value('x'), undefined);
  const outcomes = (await store.read()).filter((entry) => entry.kind === 'tool_outcome');
  assert.equal(outcomes[0]?.outcome.status, 'cancelled');
});

it('diagnoses a mismatched World receipt as unknown under the original call ID', { timeout: 3000 }, async (t) => {
  class World extends FixtureWorld {
    override async executeTool(tool: ToolCall, context: ToolExecutionContext) { return { ...await super.executeTool(tool, context), callId: 'wrong-id' }; }
  }
  const { runtime, world, store, events } = await setup(t, [calls(call('original-id'))], { world: new World() });
  await runtime.inputs.submit(text('mismatch'));
  await runtime.inputs.idle();
  await runtime.stop();
  assert.equal(world.value('x'), 7);
  assert.equal(runtime.inputs.inspect('mismatch')?.result?.code, 'invalid_tool_outcome');
  assert.deepEqual((await store.read()).filter((entry) => entry.kind === 'tool_outcome').map((entry) => [entry.outcome.callId, entry.outcome.status]), [['original-id', 'unknown']]);
  assert.equal(events.find((event) => event.type === 'tool_finished')?.error?.code, 'invalid_tool_outcome');
});

it('keeps the production Agent usable through the existing environment Event entry', { timeout: 3000 }, async (t) => {
  const { runtime, world, store } = await setup(t, (request, index) => {
    if (!index) return calls(call('event-write'));
    assert.ok(request.tools.some((tool) => tool.name === 'fixture.set'));
    assert.ok(request.messages.some((item) => item.role === 'tool' && item.toolCallId === 'event-write'));
    return done('event complete');
  });
  await runtime.handleEvent({ id: 'event', type: 'fixture.input', source: 'fixture', occurredAt: new Date().toISOString(), payload: 'write' });
  assert.equal(world.value('x'), 7);
  assert.equal((await store.read()).filter((entry) => entry.kind === 'provider_response').length, 2);
});

it('preserves an effect followed by a thrown receipt as unknown and cancels subsequent work', { timeout: 3000 }, async (t) => {
  const entered = gate();
  const release = gate();
  class World extends FixtureWorld {
    override async executeTool(tool: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      await super.executeTool(tool, context);
      entered.resolve();
      await release.promise;
      throw new Error('receipt lost after write');
    }
  }
  let requests = 0;
  const { runtime, world, store, events } = await setup(t, () => {
    return requests++ === 0 ? calls(call('effect'), call('not-started', 'fixture.set', { key: 'y', value: 9 })) : done('must not continue');
  }, { world: new World() });
  await runtime.inputs.submit(text('first'));
  await entered.promise;
  await runtime.inputs.submit(text('second'));
  release.resolve();
  await runtime.inputs.idle();
  assert.equal(world.value('x'), 7);
  assert.equal(world.value('y'), undefined);
  const outcomes = (await store.read()).filter((entry) => entry.kind === 'tool_outcome');
  assert.deepEqual(outcomes.map((entry) => [entry.outcome.callId, entry.outcome.status]), [['effect', 'unknown'], ['not-started', 'cancelled']]);
  assert.deepEqual(outcomes[0]?.outcome.error, { code: 'world_error', message: 'receipt lost after write' });
  assert.equal(runtime.inputs.inspect('first')?.result?.code, 'tool_unknown');
  assert.equal(runtime.inputs.inspect('second')?.result?.status, 'cancelled');
  assert.equal(requests, 1, 'Unknown tools must end both model continuation and the input queue');
  await runtime.stop();
  assert.equal(runtime.status, 'stopped');
  assert.equal(events.filter((event) => event.type === 'run_finished' && event.inputId === 'first').length, 1);
});

it('keeps unknown diagnostics and stops the queue even if every tool receipt append fails', { timeout: 3000 }, async (t) => {
  const entered = gate();
  const release = gate();
  class World extends FixtureWorld {
    override async executeTool(tool: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      await super.executeTool(tool, context);
      entered.resolve();
      await release.promise;
      return { callId: tool.callId, toolName: tool.toolName, status: 'unknown', error: { code: 'receipt_lost', message: 'Confirmation unavailable' } };
    }
  }
  let requests = 0;
  const { runtime, world, store, events } = await setup(t, () => {
    return requests++ === 0 ? calls(call('unknown'), call('not-started', 'fixture.set', { key: 'y', value: 9 })) : done('must not continue');
  }, { world: new World(), wrap: (real) => ({ read: () => real.read(), append: (entry) =>
    entry.kind === 'tool_outcome' ? Promise.reject(new Error('outcome append unavailable')) : real.append(entry),
  }) });
  await runtime.inputs.submit(text('first'));
  await entered.promise;
  await runtime.inputs.submit(text('second'));
  release.resolve();
  await runtime.inputs.idle();
  assert.equal(world.value('x'), 7);
  assert.equal(world.value('y'), undefined);
  assert.equal(runtime.inputs.inspect('first')?.result?.code, 'storage_error');
  assert.equal(runtime.inputs.inspect('second')?.result?.status, 'cancelled');
  assert.equal(requests, 1);
  const diagnostics = events.filter((event) => event.type === 'tool_finished');
  assert.deepEqual(diagnostics.map((event) => [event.callId, event.status]), [['unknown', 'unknown'], ['not-started', 'cancelled']]);
  assert.deepEqual(diagnostics[0]?.error, { code: 'receipt_lost', message: 'Confirmation unavailable' });
  assert.equal(diagnostics[0]?.round, 1);
  assert.equal((await store.read()).some((entry) => entry.kind === 'tool_outcome'), false);
  await runtime.stop();
  assert.equal(runtime.status, 'stopped');
});

it('reports model rounds and explicit tool failures independently of the final reply', { timeout: 3000 }, async (t) => {
  const { runtime, events } = await setup(t, [calls(call('failure', 'fixture.fail', { message: 'fixture diagnostic' })), done('Reply without tool details')]);
  await runtime.inputs.submit(text('diagnostics'));
  await runtime.inputs.idle();
  assert.deepEqual(events.filter((event) => event.type === 'provider_started' || event.type === 'provider_finished').map((event) => [event.type, event.round, event.status]), [
    ['provider_started', 1, undefined], ['provider_finished', 1, 'tool_calls'], ['provider_started', 2, undefined], ['provider_finished', 2, 'stop'],
  ]);
  const tool = events.find((event) => event.type === 'tool_finished');
  assert.equal(tool?.round, 1);
  assert.deepEqual(tool?.error, { code: 'fixture_failure', message: 'fixture diagnostic' });
  assert.equal(runtime.inputs.inspect('diagnostics')?.result?.status, 'succeeded');
});

it('publishes unknown and closes admission before waiting for its receipt write', { timeout: 3000 }, async (t) => {
  const entered = gate();
  const release = gate();
  class World extends FixtureWorld {
    override async executeTool(tool: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      await super.executeTool(tool, context);
      return { callId: tool.callId, toolName: tool.toolName, status: 'unknown' };
    }
  }
  const { runtime, events } = await setup(t, [calls(call('unknown'))], { world: new World(), wrap: (real) => ({
    read: () => real.read(), append: async (entry) => {
      if (entry.kind === 'tool_outcome') { entered.resolve(); await release.promise; throw new Error('receipt append failed'); }
      await real.append(entry);
    },
  }) });
  await runtime.inputs.submit(text('first'));
  await entered.promise;
  try {
    const diagnostic = events.find((event) => event.type === 'tool_finished');
    assert.equal(diagnostic?.status, 'unknown');
    assert.equal(diagnostic?.error?.code, 'tool_unknown');
    assert.equal((await runtime.inputs.submit(text('after-unknown')) as { code: string }).code, 'not_running');
    assert.equal(events.some((event) => event.type === 'run_finished'), false);
  } finally { release.resolve(); }
  await runtime.inputs.idle();
  await runtime.stop();
  assert.equal(runtime.inputs.inspect('first')?.result?.code, 'storage_error');
});

it('exposes only the public error fields and excludes private response and tool metadata', { timeout: 3000 }, async (t) => {
  class World extends FixtureWorld {
    override async executeTool(tool: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
      const outcome = await super.executeTool(tool, context);
      const error = { code: 'fixture_failure', message: 'Public tool reason', credentials: 'tool-private-sentinel', providerData: { output: ['tool-opaque'] } };
      return { ...outcome, error };
    }
  }
  const modelError = { code: 'model_failed', message: 'Public model reason', credentials: 'model-private-sentinel', providerData: { output: ['model-opaque'] } };
  const { runtime, events } = await setup(t, [
    calls(call('failure', 'fixture.fail', { message: 'failure' })),
    { finishReason: 'error', toolCalls: [], error: modelError, providerData: { providerId: 'scripted', output: [{ encrypted_content: 'native-private-sentinel' }] } },
  ], { world: new World() });
  await runtime.inputs.submit(text('public-error'));
  await runtime.inputs.idle();
  assert.deepEqual(events.find((event) => event.type === 'tool_finished')?.error, { code: 'fixture_failure', message: 'Public tool reason' });
  assert.deepEqual(events.find((event) => event.type === 'provider_finished' && event.round === 2)?.error, { code: 'model_failed', message: 'Public model reason' });
  const publicOutput = JSON.stringify({ events, cached: runtime.inputs.eventsSince(0), snapshot: runtime.inputs.inspect('public-error') });
  assert.doesNotMatch(publicOutput, /private-sentinel|providerData|encrypted_content|credentials|tool-opaque|model-opaque/);
});
