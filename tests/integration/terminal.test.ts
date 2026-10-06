import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { it } from 'node:test';
import { ConversationAgent } from '../../src/agent/conversation-agent.ts';
import { runTerminal } from '../../src/console/terminal.ts';
import { ScriptedProvider } from '../../src/providers/scripted-provider.ts';
import { Runtime } from '../../src/runtime/runtime.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';
import type { ProviderResponse } from '../../src/protocol/index.ts';

async function create(responses: ConstructorParameters<typeof ScriptedProvider>[0]) {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-terminal-')), 'session.jsonl'));
  const runtime = new Runtime({ agent: new ConversationAgent({ sessionId: 'terminal-test' }), provider: new ScriptedProvider(responses), world: new FixtureWorld(), session: store, state: new MemoryState() });
  const input = new PassThrough();
  const output = new PassThrough();
  let transcript = '';
  output.on('data', (chunk: Buffer) => { transcript += chunk.toString(); });
  await runtime.start();
  const running = runTerminal(runtime, { input, output });
  return { runtime, store, input, running, transcript: () => transcript };
}
const done = (reply: string): ProviderResponse => ({ toolCalls: [], finishReason: 'stop', message: { role: 'assistant', content: reply } });

it('submits consecutive and multiline text, escapes commands, and drains the queue on EOF', { timeout: 3000 }, async () => {
  const { runtime, store, input, running, transcript } = await create((request) => done(request.messages.at(-1)!.content));
  input.end('first\n/begin\n第一行\n第二行\n/send\n//literal\n/status\n');
  await running;
  assert.equal(runtime.status, 'stopped');
  const inputs = (await store.read()).filter((entry) => entry.kind === 'input').map((entry) => entry.input.content.text);
  assert.deepEqual(inputs, ['first', '第一行\n第二行', '/literal']);
  assert.equal((await store.read()).filter((entry) => entry.kind === 'run_finished').length, 3);
  assert.ok(transcript().indexOf('accepted #1') < transcript().indexOf('run_started'));
  assert.match(transcript(), /第一行\n第二行/);
  assert.match(transcript(), /Runtime=stopped/);
});

it('cancels the active input and remains interactive for the following input', { timeout: 3000 }, async () => {
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const { runtime, store, input, running, transcript } = await create((_request, index) => {
    if (!index) { entered(); return new Promise(() => undefined); }
    return done('next reply');
  });
  input.write('old\n');
  await ready;
  input.end('/cancel\nnext\n');
  await running;
  assert.match(transcript(), /cancelled/);
  assert.match(transcript(), /next reply/);
  assert.equal((await store.read()).filter((entry) => entry.kind === 'run_finished').length, 2);
  assert.equal(runtime.status, 'stopped');
});

it('quits an uncooperative model without waiting for its completion', { timeout: 3000 }, async () => {
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const { runtime, input, running, transcript } = await create(() => { entered(); return new Promise(() => undefined); });
  input.write('old\n');
  await ready;
  input.end('/quit\n');
  await running;
  assert.equal(runtime.status, 'stopped');
  assert.match(transcript(), /cancelled runtime_stopped persisted=true/);
});

it('handles stop/start commands locally and discards an unfinished multiline input', { timeout: 3000 }, async () => {
  const { store, input, running, transcript } = await create(() => done('ready'));
  input.end('/stop\nwhile-stopped\n/start\nready\n/begin\nunsubmitted\n');
  await running;
  assert.match(transcript(), /rejected not_running/);
  const inputs = (await store.read()).filter((entry) => entry.kind === 'input').map((entry) => entry.input.content.text);
  assert.deepEqual(inputs, ['ready']);
  assert.match(transcript(), /未提交的多行输入已丢弃/);
});

it('prints model rounds and tool errors even when the model omits the diagnostic', { timeout: 3000 }, async () => {
  const { input, running, transcript } = await create([
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'failure', toolName: 'fixture.fail', arguments: { message: 'fixture diagnostic' } }] },
    done('Reply without tool details'),
  ]);
  input.end('diagnose\n');
  await running;
  assert.match(transcript(), /round=1 provider_started/);
  assert.match(transcript(), /round=2 provider_finished stop/);
  assert.match(transcript(), /tool_finished failure fixture\.fail failed fixture_failure: fixture diagnostic/);
});
