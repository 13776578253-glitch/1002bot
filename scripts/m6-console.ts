/** Offline operator entry exercises controlled yielding against real Session and versioned World files. */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { Runtime } from '../src/runtime/runtime.ts';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import type { ProviderRequest, ProviderResponse, ToolCall, ToolOutcome } from '../src/protocol/index.ts';
import { InputError } from '../src/protocol/index.ts';
import { ResponseWorld } from '../tests/fixtures/response-world.ts';

const done = (content: string): ProviderResponse => ({ finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content } });
const call = (toolName: string, argumentsValue: ToolCall['arguments']): ProviderResponse => ({ finishReason: 'tool_calls', toolCalls: [{ callId: 'call-1', toolName, arguments: argumentsValue }] });
function model(request: ProviderRequest): ProviderResponse {
  const last = request.messages.at(-1)!;
  if (last.role === 'user') {
    if (last.content.startsWith('observe ')) return call('fixture.observe', { label: last.content.slice(8) });
    if (last.content === 'current') return call('fixture.current', {});
    if (last.content.startsWith('evidence ')) return call('agent_operation_evidence', { runId: last.content.slice(9), callId: 'call-1' });
    return done(last.content);
  }
  const outcome = JSON.parse(last.content) as ToolOutcome;
  if (outcome.toolName === 'agent_operation_evidence') return done(`late=${JSON.stringify(outcome.output)}`);
  return done(`observed=${JSON.stringify(outcome.output)}`);
}
async function scene() {
  const folder = await mkdtemp(join(tmpdir(), 'm6-console-'));
  const world = new ResponseWorld(join(folder, 'world.json'));
  const session = new JsonlSessionStore(join(folder, 'session.jsonl'));
  const requests: ProviderRequest[] = [];
  const runtime = new Runtime({ world, session, state: new MemoryState(), responsiveness: {}, cleanupDeadlineMs: 1000,
    agent: new ConversationAgent({ sessionId: 'm6-sample', operations: true, includeUnsuccessfulHistory: true }), includeUnsuccessfulHistory: true,
    provider: new ScriptedProvider(request => { requests.push(structuredClone(request)); return model(request); }) });
  return { folder, world, session, requests, runtime };
}
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('Condition is still pending'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
/** 完整闭环先保持原调用未结束，再证明 FIFO、迟到隔离及明确证据读取。 */
export async function runResponseSample() {
  const { runtime, world, session, requests, folder } = await scene(); await runtime.start();
  try {
    world.hold('A'); await runtime.inputs.submit({ inputId: 'A', source: 'console', content: { kind: 'text', text: 'observe A' } }); await world.entered('A');
    const target = runtime.responses!.snapshot().active!;
    await runtime.inputs.submit({ inputId: 'B', source: 'console', content: { kind: 'text', text: 'current' } });
    await world.publish(7); assert.equal(runtime.responses!.yield(target).status, 'requested'); await runtime.inputs.idle();
    const a = runtime.inputs.inspect('A')!.result!, b = runtime.inputs.inspect('B')!.result!;
    assert.equal(a.status, 'cancelled'); assert.equal(b.status, 'succeeded'); assert.equal(runtime.status, 'running');
    assert.equal(runtime.responses!.snapshot().operations.length, 1);
    world.release('A'); await until(() => runtime.responses!.snapshot().operations.length === 0);
    const late = await runtime.responses!.readLate({ runId: target.runId, callId: 'call-1' });
    assert.equal(late?.result.status, 'returned'); assert.equal(world.latest.version, 1);
    assert.ok(requests.every(request => request.messages.every(message => !message.content.includes('"version":0'))));
    await runtime.inputs.submit({ inputId: 'query', source: 'console', content: { kind: 'text', text: `evidence ${target.runId}` } }); await runtime.inputs.idle();
    const evidence = requests.find(request => request.messages.at(-1)?.toolCallId === 'call-1' && request.messages.at(-1)?.content.includes('agent_operation_evidence'));
    assert.ok(evidence?.messages.at(-1)?.content.includes('"version":0'));
    const diagnosis = await runtime.inspectSession(); assert.equal(diagnosis.status, 'ready');
    return { folder, runtime: runtime.status, a, b, latest: world.latest, late, evidence: runtime.inputs.inspect('query')!.result,
      diagnosis, records: (await session.read()).length };
  } finally { world.releaseAll(); await runtime.stop(); }
}

/** 等待诊断时使用可退订监听器，超时后不保留无限的 idle 等待。 */
async function waitInput(runtime: Runtime, id: string): Promise<void> {
  if (runtime.inputs.inspect(id)?.result) return;
  await new Promise<void>((resolve, reject) => {
    const off = runtime.inputs.subscribe(event => { if (event.type === 'run_finished' && event.inputId === id) { clearTimeout(timer); off(); resolve(); } });
    const timer = setTimeout(() => { off(); reject(new Error('Input is still pending')); }, 3000);
    if (runtime.inputs.inspect(id)?.result) { clearTimeout(timer); off(); resolve(); }
  });
}
async function interactive(): Promise<void> {
  const { runtime, world, folder } = await scene();
  const lines = createInterface({ input: process.stdin });
  // 启动前消费管道输入，EOF 不会在订阅完成前丢失。
  const commands = lines[Symbol.asyncIterator]();
  let next = 0, quit = false;
  const write = (value: unknown) => console.log(typeof value === 'string' ? value : JSON.stringify(value));
  const off = runtime.inputs.subscribe(event => { if (event.type === 'run_finished') write({ event: event.type, inputId: event.inputId, runId: event.runId, result: event.result }); });
  lines.on('SIGINT', () => { quit = true; world.releaseAll(); lines.close(); void runtime.stop().catch(error => write(String(error))); });
  try {
    await runtime.start(); write({ folder, commands: 'input observe A | input current | wait A | finish input-ID | yield | release A | settle | push 7 | ops | late RUN CALL | diagnose | stop | start | quit' });
    for await (const line of commands) {
      if (quit) break;
      const [command, ...args] = line.trim().split(/\s+/);
      try {
        if (command === 'input') {
          const text = args.join(' '), label = text.startsWith('observe ') ? text.slice(8) : undefined;
          if (label) world.hold(label);
          const inputId = `input-${++next}`;
          const receipt = await runtime.inputs.submit({ inputId, source: 'console', content: { kind: 'text', text } });
          if (receipt.status === 'rejected' && label) world.release(label);
          write({ inputId, receipt });
        } else if (command === 'wait') await until(() => world.hasEntered(args[0] ?? ''));
        else if (command === 'finish') await waitInput(runtime, args[0] ?? '');
        else if (command === 'yield') { const target = runtime.responses!.snapshot().active; write(target ? runtime.responses!.yield(target) : { status: 'no_active_run' }); }
        else if (command === 'release') { world.release(args[0] ?? ''); write({ released: args[0] }); }
        else if (command === 'settle') await until(() => runtime.responses!.snapshot().operations.length === 0);
        else if (command === 'push') { const value = Number(args[0]); if (!Number.isFinite(value)) throw new Error('Expected a numeric World value'); write(await world.publish(value)); }
        else if (command === 'ops') write(runtime.responses!.snapshot());
        else if (command === 'late') write(await runtime.responses!.readLate({ runId: args[0] ?? '', callId: args[1] ?? '' }) ?? { found: false });
        else if (command === 'diagnose') write(await runtime.inspectSession());
        else if (command === 'stop') { await runtime.stop(); write({ runtime: runtime.status }); }
        else if (command === 'start') { await runtime.start(); write({ runtime: runtime.status }); }
        else if (command === 'quit') { quit = true; world.releaseAll(); await runtime.stop(); break; }
        else write('Use input, wait, finish, yield, release, settle, push, ops, late, diagnose, stop, start, quit');
      } catch (error) { write({ error: error instanceof Error ? error.message : String(error), runtime: runtime.status,
        ...(error instanceof AggregateError ? { causes: error.errors.map((cause: unknown) => ({ code: cause instanceof InputError ? cause.code : 'cleanup_error',
          message: cause instanceof Error ? cause.message : String(cause) })) } : {}) }); }
    }
  } finally { world.releaseAll(); await runtime.stop(); lines.close(); off(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--sample')) console.log(JSON.stringify(await runResponseSample()));
  else await interactive();
}
