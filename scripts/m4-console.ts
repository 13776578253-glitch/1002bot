/** Offline source console exercises World delivery and core controls without a production frontend. */
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Runtime } from '../src/runtime/runtime.ts';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import { OrderedFixtureWorld } from '../tests/fixtures/ordered-world.ts';
import { STANDARD_TRIGGER_LIMITS } from '../src/protocol/index.ts';
import type { Event, JsonValue, ProviderResponse } from '../src/protocol/index.ts';

const directory = process.argv[2] ?? await mkdtemp(join(tmpdir(), 'bot-m4-console-'));
const stream = { streamId: 'facts', epoch: 'console-1' };
let modelCalls = 0;
let tick: (() => void) | undefined;
function build() {
  const world = new OrderedFixtureWorld(join(directory, 'producer.jsonl'), stream, 'm4-console');
  const provider = new ScriptedProvider((request): ProviderResponse => {
    ++modelCalls;
    const last = request.messages.at(-1)!;
    if (last.role === 'tool') return { finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: last.content } };
    let text = last.content;
    try { const parsed = JSON.parse(text) as { payload?: { text?: string } }; if (typeof parsed.payload?.text === 'string') text = parsed.payload.text; } catch { /* Plain Console text follows the same fixture commands. */ }
    const match = /^(get|set|fail)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text);
    if (!match) return { finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: text } };
    let value: JsonValue = match[3] ?? null;
    try { value = JSON.parse(match[3] ?? 'null') as JsonValue; } catch { /* Fixture values may be plain text. */ }
    return { finishReason: 'tool_calls', toolCalls: [{ callId: randomUUID(), toolName: `fixture.${match[1]!}`,
      arguments: match[1] === 'get' ? { key: match[2]! } : match[1] === 'fail' ? { message: match[2]! } : { key: match[2]!, value } }] };
  });
  const runtime = new Runtime({ world, provider, agent: new ConversationAgent({ sessionId: 'm4-console' }), session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState(), worldStreams: [stream],
    heartbeat: { source: { subscribe(callback) { tick = callback; return () => { if (tick === callback) tick = undefined; }; } } } });
  return { world, runtime };
}
let { world, runtime } = build();
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
const lines = createInterface({ input: process.stdin });
// 启动期间先收集管道输入，避免 EOF 在异步装配完成前关闭行迭代器。
const commands = lines[Symbol.asyncIterator]();
try {
  try { await runtime.start(); } catch (error) { output({ error: error instanceof Error ? error.message : String(error), diagnosis: runtime.diagnosis }); }
  process.stdout.write('离线 M4：fact set key 7 / input get key / replay 1 / progress / restart / tick / diagnose / quit\n');
  output({ directory });
  for await (const line of commands) {
    try {
      if (line === 'quit') break;
      if (line === 'progress') { output(runtime.deliveries.progress(stream.streamId)); continue; }
      if (line === 'diagnose') { output(await runtime.inspectSession()); continue; }
      if (line === 'restart') { await runtime.stop(); ({ world, runtime } = build()); await runtime.start(); output({ restarted: true, progress: runtime.deliveries.progress(stream.streamId) }); continue; }
      if (runtime.status !== 'running') throw new Error('Runtime is not running; inspect diagnose');
      if (line === 'tick') { tick!(); await runtime.triggers.idle(); output({ heartbeat: 'settled', modelCalls }); continue; }
      const before = modelCalls;
      if (line.startsWith('fact ')) {
        const event: Event = { id: randomUUID(), source: 'fixture', type: 'fixture.input', occurredAt: new Date().toISOString(), payload: { text: line.slice(5) } };
        if (Buffer.byteLength(JSON.stringify(event)) > STANDARD_TRIGGER_LIMITS.eventBytes) throw new Error('Fixture fact exceeds Event capacity');
        const delivery = await world.prepare(event), receipt = await world.send(delivery); await runtime.triggers.idle();
        output({ receipt, result: runtime.triggers.inspect('world_event', receipt.triggerId)?.result, modelCalls: modelCalls - before, progress: runtime.deliveries.progress(stream.streamId) });
      } else if (/^replay \d+$/.test(line)) {
        const receipt = await world.send(await world.original(Number(line.slice(7)))); await runtime.triggers.idle(); output({ receipt, modelCalls: modelCalls - before });
      } else if (line.startsWith('input ')) {
        const receipt = await runtime.inputs.submit({ inputId: randomUUID(), source: 'console', content: { kind: 'text', text: line.slice(6) } }); await runtime.inputs.idle(); output({ receipt, result: runtime.inputs.inspect(receipt.inputId)?.result });
      } else output({ error: 'Unknown fixture command' });
    } catch (error) { output({ error: error instanceof Error ? error.message : String(error), diagnosis: runtime.diagnosis }); }
  }
} finally { lines.close(); await runtime.triggers.idle(); await runtime.stop(); }
