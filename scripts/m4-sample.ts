/** Offline M4 proves producer identity, persisted frontiers and a fresh Runtime without replaying effects. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { composeRuntime } from '../src/runtime/compose.ts';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { OrderedFixtureWorld } from '../tests/fixtures/ordered-world.ts';
import type { Event } from '../src/protocol/index.ts';

export async function runM4Sample(directory: string, phase: 'first' | 'second') {
  const stream = { streamId: 'facts', epoch: 'fixture-1' };
  const world = new OrderedFixtureWorld(join(directory, 'producer.jsonl'), stream, 'm4-sample');
  let modelCalls = 0;
  const provider = new ScriptedProvider((_request, index) => {
    ++modelCalls;
    return index % 2 === 0 ? { finishReason: 'tool_calls', toolCalls: [{ callId: 'write', toolName: 'fixture.set', arguments: { key: 'answer', value: phase === 'first' ? 7 : 8 } }] }
      : { finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: 'saved' } };
  });
  const runtime = composeRuntime({ agent: new ConversationAgent({ sessionId: 'm4-sample' }), provider, world,
    session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState(), worldStreams: [stream] });
  await runtime.start();
  try {
    const replay = phase === 'second' ? await world.send(await world.original(1)) : undefined;
    const callsBeforeNew = modelCalls;
    const event: Event = { id: phase, source: 'fixture', type: 'fixture.input', occurredAt: new Date().toISOString(), payload: { phase } };
    const receipt = await world.send(await world.prepare(event));
    await runtime.triggers.idle();
    return { phase, receipt, ...(replay ? { replay } : {}), callsBeforeNew, modelCalls, value: world.value('answer'),
      progress: runtime.deliveries.progress(stream.streamId), producer: world.producerProgress, diagnosis: runtime.diagnosis.status,
      result: runtime.triggers.inspect('world_event', receipt.triggerId)?.result };
  } finally { await runtime.stop(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? await mkdtemp(join(tmpdir(), 'bot-m4-'));
  const phase = process.argv[3];
  if (phase === 'first' || phase === 'second') console.log(JSON.stringify(await runM4Sample(directory, phase)));
  else {
    console.log(JSON.stringify({ directory, first: await runM4Sample(directory, 'first'), second: await runM4Sample(directory, 'second') }));
  }
}
