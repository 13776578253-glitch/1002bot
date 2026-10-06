import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import { composeRuntime } from '../../src/runtime/compose.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import type { Event, ToolCall, ToolExecutionContext, ToolOutcome, World } from '../../src/protocol/index.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';
import { TestAgent } from '../fixtures/test-agent.ts';

const event: Event = { id: 'event-1', type: 'fixture.input', source: 'test', occurredAt: '2026-10-04T00:00:00.000Z', payload: { text: 'hello' } };

const unknownOutcomeWorld: World = {
  id: 'unknown-outcome-world',
  async start(): Promise<void> {},
  async stop(): Promise<void> {},
  tools: () => [{ name: 'fixture.uncertain', description: 'Return an unconfirmed effect.', inputSchema: { type: 'object' } }],
  async executeTool(call: ToolCall, _context: ToolExecutionContext): Promise<ToolOutcome> {
    return { callId: call.callId, toolName: call.toolName, status: 'unknown' };
  },
};

describe('M1 vertical loop', () => {
  it('routes an event through a tool call and persists paired entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), '1002bot-test-'));
    const store = new JsonlSessionStore(join(dir, 'session.jsonl'));
    const world = new FixtureWorld();
    const runtime = composeRuntime({
      agent: new TestAgent(),
      provider: new ScriptedProvider([
        { toolCalls: [{ callId: 'call-1', toolName: 'fixture.set', arguments: JSON.stringify({ key: 'answer', value: 42 }) }], finishReason: 'tool_calls' },
        { message: { role: 'assistant', content: 'saved' }, toolCalls: [], finishReason: 'stop' },
      ]),
      session: store,
      state: new MemoryState(),
      world,
    });
    await runtime.start();
    await runtime.handleEvent(event);
    await runtime.stop();

    const entries = await store.read();
    assert.equal(world.value('answer'), 42);
    assert.equal(entries.filter((entry) => entry.kind === 'tool_call').length, 1);
    assert.equal(entries.filter((entry) => entry.kind === 'tool_outcome')[0]?.outcome.status, 'succeeded');
    assert.equal(entries.filter((entry) => entry.kind === 'provider_response').length, 2);
  });

  it('reports unknown tools, invalid arguments, and fixture failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), '1002bot-test-'));
    const store = new JsonlSessionStore(join(dir, 'session.jsonl'));
    const runtime = composeRuntime({
      agent: new TestAgent(),
      provider: new ScriptedProvider([
        { toolCalls: [
          { callId: 'unknown', toolName: 'fixture.missing', arguments: '{}' },
          { callId: 'invalid', toolName: 'fixture.set', arguments: '{' },
          { callId: 'failed', toolName: 'fixture.fail', arguments: { message: 'expected' } },
        ], finishReason: 'tool_calls' },
        { toolCalls: [], finishReason: 'stop' },
      ]),
      session: store,
      state: new MemoryState(),
      world: new FixtureWorld(),
    });
    await runtime.start();
    await runtime.handleEvent(event);
    await runtime.stop();
    const outcomes = (await store.read()).filter((entry) => entry.kind === 'tool_outcome').map((entry) => entry.outcome);
    assert.equal(outcomes[0]?.error?.code, 'unknown_tool');
    assert.equal(outcomes[1]?.error?.code, 'invalid_arguments');
    assert.equal(outcomes[2]?.error?.code, 'fixture_failure');
  });

  it('persists an unknown tool outcome with its callId', async () => {
    const dir = await mkdtemp(join(tmpdir(), '1002bot-test-'));
    const store = new JsonlSessionStore(join(dir, 'session.jsonl'));
    const runtime = composeRuntime({
      agent: new TestAgent(),
      provider: new ScriptedProvider([
        { toolCalls: [{ callId: 'uncertain-1', toolName: 'fixture.uncertain', arguments: '{}' }], finishReason: 'tool_calls' },
        { toolCalls: [], finishReason: 'stop' },
      ]),
      session: store,
      state: new MemoryState(),
      world: unknownOutcomeWorld,
    });
    await runtime.start();
    await runtime.handleEvent(event);
    await runtime.stop();

    const outcomes = (await store.read()).filter((entry) => entry.kind === 'tool_outcome');
    assert.deepEqual(outcomes[0]?.outcome, { callId: 'uncertain-1', toolName: 'fixture.uncertain', status: 'unknown' });
  });

  it('recovers JSONL session entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), '1002bot-test-'));
    const path = join(dir, 'session.jsonl');
    const first = new JsonlSessionStore(path);
    await first.append({ kind: 'event', at: event.occurredAt, event });
    await first.append({ kind: 'tool_outcome', at: event.occurredAt, outcome: { callId: 'recover', toolName: 'fixture.get', status: 'succeeded', output: null } });
    assert.equal((await new JsonlSessionStore(path).read()).length, 2);
  });

  it('records a provider failure as a structured error and ends the round', async () => {
    const dir = await mkdtemp(join(tmpdir(), '1002bot-test-'));
    const store = new JsonlSessionStore(join(dir, 'session.jsonl'));
    const runtime = composeRuntime({
      agent: new TestAgent(),
      provider: new ScriptedProvider(() => { throw new Error('provider unavailable'); }),
      session: store,
      state: new MemoryState(),
      world: new FixtureWorld(),
    });
    await runtime.start();
    await runtime.handleEvent(event);
    await runtime.stop();
    const responses = (await store.read()).filter((entry) => entry.kind === 'provider_response');
    assert.equal(responses[0]?.response.finishReason, 'error');
    assert.equal(responses[0]?.response.error?.code, 'provider_error');
  });
});
