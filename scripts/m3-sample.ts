import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { composeRuntime } from '../src/runtime/compose.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import type { OutputEvent, WorldEventSink } from '../src/protocol/index.ts';
import { FixtureWorld } from '../tests/fixtures/fixture-world.ts';

class SampleWorld extends FixtureWorld {
  private sink?: WorldEventSink;
  subscribeEvents(sink: WorldEventSink) { this.sink = sink; return () => { delete this.sink; }; }
  emit() { return this.sink!({ id: 'world-read', type: 'fixture.read', source: 'sample-world', occurredAt: new Date().toISOString(), payload: { key: 'answer' } }); }
}
const directory = await mkdtemp(join(tmpdir(), 'bot-m3-'));
const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
const world = new SampleWorld();
let tick!: () => void;
const runtime = composeRuntime({ world, session: store, state: new MemoryState(), agent: new ConversationAgent({ sessionId: 'm3-sample' }),
  heartbeat: { source: { subscribe(callback) { tick = callback; return () => undefined; } } },
  provider: new ScriptedProvider([
    { toolCalls: [{ callId: 'write', toolName: 'fixture.set', arguments: { key: 'answer', value: 7 } }], finishReason: 'tool_calls' },
    { message: { role: 'assistant', content: 'saved 7' }, toolCalls: [], finishReason: 'stop' },
    { toolCalls: [{ callId: 'read', toolName: 'fixture.get', arguments: { key: 'answer' } }], finishReason: 'tool_calls' },
    { message: { role: 'assistant', content: 'World observed 7' }, toolCalls: [], finishReason: 'stop' },
  ]),
});
const terminals: OutputEvent[] = [];
runtime.triggers.subscribe((event) => { if (event.type === 'run_finished') terminals.push(event); });
await runtime.start();
try {
  await runtime.inputs.submit({ inputId: 'console-write', source: 'sample-console', content: { kind: 'text', text: 'set answer 7' } });
  await world.emit(); tick(); tick();
  await runtime.triggers.idle();
  assert.deepEqual(terminals.map((event) => event.triggerKind), ['user_input', 'world_event', 'heartbeat']);
  assert.ok(terminals.every((event) => event.result?.status === 'succeeded' && event.result.persisted));
  assert.equal(world.value('answer'), 7);
  assert.equal(runtime.status, 'running');
  console.log(JSON.stringify({ status: runtime.status, value: world.value('answer'), results: terminals.map((event) => ({ kind: event.triggerKind, id: event.triggerId, result: event.result })), records: (await store.read()).length, sessionPath: join(directory, 'session.jsonl') }, null, 2));
} finally { await runtime.stop(); }
