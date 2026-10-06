import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeRuntime } from '../src/runtime/compose.ts';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import type { Event } from '../src/protocol/index.ts';
import { FixtureWorld } from '../tests/fixtures/fixture-world.ts';
import { TestAgent } from '../tests/fixtures/test-agent.ts';

const directory = await mkdtemp(join(tmpdir(), '1002bot-m1-'));
const world = new FixtureWorld();
const runtime = composeRuntime({
  agent: new TestAgent(),
  provider: new ScriptedProvider([
    { toolCalls: [{ callId: 'sample-1', toolName: 'fixture.set', arguments: { key: 'count', value: 1 } }], finishReason: 'tool_calls' },
    { message: { role: 'assistant', content: 'done' }, toolCalls: [], finishReason: 'stop' },
  ]),
  session: new JsonlSessionStore(join(directory, 'session.jsonl')),
  state: new MemoryState(),
  world,
});
const event: Event = { id: 'sample-event', type: 'fixture.input', source: 'sample', occurredAt: new Date().toISOString(), payload: { value: 'run' } };
await runtime.start();
await runtime.handleEvent(event);
await runtime.stop();
console.log(JSON.stringify({ status: runtime.status, value: world.value('count'), entries: runtime.trace.length, sessionPath: join(directory, 'session.jsonl') }));
