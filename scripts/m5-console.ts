/** The offline task console drives public inputs, ordered perception and manual time without a real bot. */
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
import { TaskObservationWorld } from '../tests/fixtures/task-observation-world.ts';
import { ManualHeartbeat } from './m5-sample.ts';
import type { JsonObject, JsonValue, ProviderResponse, TaskSnapshot, ToolOutcome } from '../src/protocol/index.ts';
import { STANDARD_TRIGGER_LIMITS } from '../src/protocol/index.ts';

const directory = process.argv[2] ?? await mkdtemp(join(tmpdir(), 'bot-m5-console-'));
const stream = { streamId: 'facts', epoch: 'task-console-1' };
// 手动推进任务时钟；来源接收与过期仍遵守 Runtime 的真实时间期限。
let clock = Date.parse('2029-01-01T00:00:00Z');
let modelCalls = 0;
const ticks = new ManualHeartbeat();
function build() {
  const world = new TaskObservationWorld(directory, stream, 'm5-console');
  const provider = new ScriptedProvider((request): ProviderResponse => {
    ++modelCalls;
    const last = request.messages.at(-1)!;
    const viewText = request.messages.find(message => message.content.startsWith('Confirmed Agent tasks:'))!.content;
    const view = JSON.parse(viewText.slice('Confirmed Agent tasks: '.length).split('. A claimed')[0]!) as { items: TaskSnapshot[]; selectedTaskId: string | null };
    const selected = view.items.find(task => task.taskId === view.selectedTaskId);
    const call = (toolName: string, args: JsonObject): ProviderResponse => ({ finishReason: 'tool_calls', toolCalls: [{ callId: randomUUID(), toolName, arguments: args }] });
    const reply = (content: string): ProviderResponse => ({ finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content } });
    // 此脚本模型固定执行观察、写入、完成链；生产 Agent 的判断由实际 Provider 承担。
    if (last.role === 'tool') {
      const outcome = JSON.parse(last.content) as ToolOutcome;
      if (outcome.status !== 'succeeded') return reply(last.content);
      if (selected && outcome.toolName === 'fixture.observe') return call('fixture.set', { key: selected.data.key!, value: selected.data.value! });
      if (selected && outcome.toolName === 'fixture.set') return call('agent_task_update', { taskId: selected.taskId, expectedRevision: selected.revision, status: 'completed' });
      return reply(last.content);
    }
    let text = last.content;
    try { const event = JSON.parse(text) as { kind?: string; payload?: { text?: string } }; if (event.kind === 'heartbeat' && selected) return call('fixture.observe', { key: selected.data.key! }); if (event.payload?.text) text = event.payload.text; }
    catch { /* Fixture commands are ordinary input text. */ }
    const match = /^wait\s+(\S+)\s+(\S+)\s+(\d+)$/.exec(text);
    if (match) {
      const delay = Number(match[3]); if (!Number.isSafeInteger(delay) || delay > 86_400_000) return reply('Fixture delay must be 0–86400000 ms');
      let value: JsonValue = match[2]!; try { value = JSON.parse(match[2]!) as JsonValue; } catch { /* Plain fixture text is a value. */ }
      return call('agent_task_create', { intent: `Observe ${match[1]} and set its value.`, status: 'waiting', data: { key: match[1]!, value }, schedule: { wakeAt: new Date(clock + delay).toISOString() } });
    }
    return reply('Scripted model: wait key JSON-value delay-ms');
  });
  const runtime = new Runtime({ world, provider, session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState(),
    agent: new ConversationAgent({ sessionId: 'm5-console', tasks: true }), worldStreams: [stream], heartbeat: { source: ticks }, taskClock: () => clock });
  return { world, runtime };
}
let { world, runtime } = build();
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
const lines = createInterface({ input: process.stdin });
// 启动等待前建立消费迭代器，保留管道输入在启动期间到达的命令与 EOF。
const commands = lines[Symbol.asyncIterator]();
try {
  await runtime.start();
  process.stdout.write('离线 M5：input wait answer 7 1000 / fact wait answer 7 1000 / tasks / advance 1000 / tick / read task-1 / get answer / restart / diagnose / quit\n');
  output({ directory, clock: new Date(clock).toISOString() });
  for await (const line of commands) {
    try {
      if (line === 'quit') break;
      if (line === 'diagnose') { output(await runtime.inspectSession()); continue; }
      if (line === 'tasks') { output({ tasks: runtime.tasks.snapshot() }); continue; }
      if (line.startsWith('read ')) { output({ task: await runtime.tasks.read(line.slice(5)) ?? null }); continue; }
      if (line.startsWith('get ')) { output({ observation: await world.observation(line.slice(4)) }); continue; }
      if (line === 'restart') { await runtime.stop(); ({ world, runtime } = build()); await runtime.start(); output({ restarted: true, tasks: runtime.tasks.snapshot() }); continue; }
      const before = modelCalls;
      if (line === 'tick' || /^advance \d+$/.test(line)) {
        if (line.startsWith('advance ')) { const step = Number(line.slice(8)); if (!Number.isSafeInteger(step) || step > 86_400_000) throw new Error('Fixture advance exceeds one day'); clock += step; }
        ticks.tick(); await runtime.triggers.idle(); output({ heartbeat: 'settled', clock: new Date(clock).toISOString(), modelCalls: modelCalls - before, tasks: runtime.tasks.snapshot() });
      } else if (line.startsWith('input ')) {
        const receipt = await runtime.inputs.submit({ inputId: randomUUID(), source: 'console', content: { kind: 'text', text: line.slice(6) } }); await runtime.inputs.idle(); output({ receipt, result: runtime.inputs.inspect(receipt.inputId)?.result });
      } else if (line.startsWith('fact ')) {
        const event = { id: randomUUID(), type: 'fixture.observation', source: 'fixture', occurredAt: new Date().toISOString(), payload: { text: line.slice(5), observation: await world.observation('answer') } };
        if (Buffer.byteLength(JSON.stringify(event)) > STANDARD_TRIGGER_LIMITS.eventBytes) throw new Error('Fixture fact exceeds Event capacity');
        const receipt = await world.send(await world.prepare(event)); await runtime.triggers.idle(); output({ receipt, result: runtime.triggers.inspect('world_event', receipt.triggerId)?.result, progress: runtime.deliveries.progress(stream.streamId) });
      } else output({ error: 'Unknown fixture command' });
    } catch (error) { output({ error: error instanceof Error ? error.message : String(error), diagnosis: runtime.diagnosis }); }
  }
} finally { lines.close(); await runtime.triggers.idle(); await runtime.stop(); }
