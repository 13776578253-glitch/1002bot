/** Offline M5 closes task creation, one-shot wake, actual observation/effect and fresh-process diagnosis. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Runtime } from '../src/runtime/runtime.ts';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { TaskObservationWorld } from '../tests/fixtures/task-observation-world.ts';
import type { HeartbeatSource, ProviderResponse, SessionStore } from '../src/protocol/index.ts';

const stream = { streamId: 'facts', epoch: 'task-fixture-1' };
const wakeAt = '2030-01-01T00:00:00.000Z';
const stop: ProviderResponse = { finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: 'confirmed' } };
export class ManualHeartbeat implements HeartbeatSource {
  private callback: (() => void) | undefined;
  subscribe(tick: () => void) { this.callback = tick; return () => { this.callback = undefined; }; }
  tick(): void { this.callback?.(); }
}
export async function runM5Sample(directory: string, phase: 'seed' | 'wake' | 'inspect' | 'crash_claim') {
  const world = new TaskObservationWorld(directory, stream, 'm5-sample');
  const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
  const ticks = new ManualHeartbeat();
  let modelCalls = 0;
  const responses: ProviderResponse[] = phase === 'seed' ? [
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'create', toolName: 'agent_task_create', arguments: { intent: 'Check answer later and set it to 7.', status: 'waiting', data: { entity: 'answer' }, schedule: { wakeAt } } }] }, stop,
  ] : [
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'observe', toolName: 'fixture.observe', arguments: { key: 'answer' } }] },
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'effect', toolName: 'fixture.set', arguments: { key: 'answer', value: 7 } }] },
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'complete', toolName: 'agent_task_update', arguments: { taskId: 'task-1', expectedRevision: 1, status: 'completed' } }] }, stop,
  ];
  // 独立子进程在认领实际保存后、Runtime 发布确认前退出，留下需诊断的未结清 run。
  const session: SessionStore = phase === 'crash_claim' ? { read: () => store.read(), scan: signal => store.scan(signal), append: async entry => { await store.append(entry); if (entry.kind === 'task_claimed') process.exit(23); } } : store;
  const runtime = new Runtime({ world, session, state: new MemoryState(), agent: new ConversationAgent({ sessionId: 'm5-sample', tasks: true }),
    provider: new ScriptedProvider((_request, index) => { ++modelCalls; if (phase === 'inspect') throw new Error('Inspection must not call a model'); return responses[index]!; }),
    worldStreams: [stream], heartbeat: { source: ticks }, taskClock: () => Date.parse(phase === 'seed' ? '2029-01-01T00:00:00Z' : wakeAt) });
  try {
    await runtime.start();
    if (phase === 'seed') {
      const observation = await world.observation('answer');
      await world.send(await world.prepare({ id: 'seed', source: 'fixture', type: 'fixture.observation', occurredAt: new Date().toISOString(), payload: observation }));
      await runtime.triggers.idle();
    } else { ticks.tick(); await runtime.triggers.idle(); }
    return { phase, modelCalls, tasks: runtime.tasks.snapshot(), task: await runtime.tasks.read('task-1'), observation: await world.observation('answer'),
      progress: runtime.deliveries.progress(stream.streamId), diagnosis: runtime.diagnosis, status: runtime.status };
  } catch (error) {
    if (phase !== 'inspect') throw error;
    return { phase, modelCalls, blocked: error instanceof Error ? error.message : String(error), diagnosis: runtime.diagnosis, worldLifecycle: world.lifecycle };
  } finally { await runtime.stop(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? await mkdtemp(join(tmpdir(), 'bot-m5-'));
  const phase = process.argv[3];
  if (phase === 'seed' || phase === 'wake' || phase === 'inspect' || phase === 'crash_claim') console.log(JSON.stringify(await runM5Sample(directory, phase)));
  else console.log(JSON.stringify({ directory, seed: await runM5Sample(directory, 'seed'), wake: await runM5Sample(directory, 'wake'), inspect: await runM5Sample(directory, 'inspect') }));
}
