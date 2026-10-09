/** Offline process-exit probe leaves real Session and fixture effect evidence at controlled boundaries. */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { Runtime } from '../src/runtime/runtime.ts';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import { OrderedFixtureWorld } from '../tests/fixtures/ordered-world.ts';
import type { SessionEntry, ToolCall, ToolExecutionContext, ToolOutcome } from '../src/protocol/index.ts';

const requestedDirectory = process.argv[2], phase = process.argv[3];
if (!requestedDirectory || !['received', 'effect', 'terminal'].includes(phase ?? '')) throw new Error('Expected directory and received/effect/terminal');
const directory = requestedDirectory;
const stream = { streamId: 'facts', epoch: 'producer-1' };
class Store extends JsonlSessionStore {
  override async append(entry: SessionEntry): Promise<void> {
    await super.append(entry);
    if (phase === 'received' && entry.kind === 'trigger_received' || phase === 'terminal' && entry.kind === 'run_finished') process.exit(0);
  }
}
class World extends OrderedFixtureWorld {
  override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
    const outcome = await super.executeTool(call, context);
    await appendFile(join(directory, 'effect.txt'), 'effect\n', 'utf8');
    if (phase === 'effect') process.exit(0);
    return outcome;
  }
}
const world = new World(join(directory, 'producer.jsonl'), stream, 'm4-test');
const runtime = new Runtime({ world, agent: new ConversationAgent({ sessionId: 'm4-test' }), session: new Store(join(directory, 'session.jsonl')), state: new MemoryState(), worldStreams: [stream],
  provider: new ScriptedProvider((_request, index) => index === 0 ? { finishReason: 'tool_calls', toolCalls: [{ callId: 'write', toolName: 'fixture.set', arguments: { key: 'x', value: 7 } }] }
    : { finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: 'done' } }) });
await runtime.start();
const delivery = await world.prepare({ id: 'one', type: 'fixture.input', source: 'fixture', occurredAt: '2026-10-09T00:00:00Z', payload: null });
await world.send(delivery);
await runtime.triggers.idle();
throw new Error('Probe did not exit at its expected boundary');
