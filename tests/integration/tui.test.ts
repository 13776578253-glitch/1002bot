import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { it } from 'node:test';
import { ConversationAgent } from '1002bot';
import { runTerminal } from '../../src/console/terminal.ts';
import { runTui, SCREEN_ENTER, SCREEN_LEAVE, type TuiInput, type TuiOutput } from '@1002bot/tui';
import { ScriptedProvider } from '1002bot';
import { Runtime } from '1002bot';
import { JsonlSessionStore } from '1002bot';
import { MemoryState } from '1002bot';
import { FixtureWorld } from '../fixtures/fixture-world.ts';
import type { ProviderResponse } from '1002bot';

async function eventually(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('TUI condition did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function create(responses: ConstructorParameters<typeof ScriptedProvider>[0], tty = true) {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-tui-test-')), 'session.jsonl'));
  const runtime = new Runtime({ agent: new ConversationAgent({ sessionId: 'tui-test' }), provider: new ScriptedProvider(responses),
    world: new FixtureWorld(), session: store, state: new MemoryState() });
  const input = new PassThrough() as PassThrough & TuiInput;
  input.isTTY = tty; input.isRaw = false;
  const rawTransitions: boolean[] = [];
  input.setRawMode = (mode) => { input.isRaw = mode; rawTransitions.push(mode); return input; };
  const output = new PassThrough() as TuiOutput;
  output.isTTY = tty; output.columns = 100; output.rows = 24;
  let transcript = '';
  output.on('data', (chunk: Buffer) => { transcript += chunk.toString(); });
  await runtime.start();
  const running = runTui(runtime, { input, output, fallback: runTerminal });
  return { runtime, store, input, output, running, rawTransitions, transcript: () => transcript };
}
const done = (reply: string): ProviderResponse => ({ finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: reply } });

it('rejects redirected streams without a supplied fallback and leaves Runtime under caller control', async () => {
  const runtime = new Runtime({ agent: new ConversationAgent({ sessionId: 'tui-tty' }), provider: new ScriptedProvider([done('unused')]),
    world: new FixtureWorld(), session: new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-tui-tty-')), 'session.jsonl')), state: new MemoryState() });
  await runtime.start();
  try {
    await assert.rejects(runTui(runtime, { input: new PassThrough(), output: new PassThrough() }), /需要支持原始模式的 TTY/);
    assert.equal(runtime.status, 'running');
  } finally { await runtime.stop(); }
});

it('runs input through real Runtime while diagnostics preserve the next draft and grapheme cursor', { timeout: 4000 }, async () => {
  let release!: (response: ProviderResponse) => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const ui = await create(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  try {
    ui.input.write('first\x13'); await ready;
    ui.input.write('草稿👩‍💻\x1b[D');
    release(done('completed')); await ui.runtime.inputs.idle();
    await eventually(() => ui.transcript().includes('completed'));
    ui.input.write('新');
    await eventually(() => ui.transcript().includes('草稿新👩‍💻'));
    ui.input.write('\x03'); await ui.running;
    const inputs = (await ui.store.read()).filter(entry => entry.kind === 'input');
    assert.deepEqual(inputs.map(entry => entry.input.content.text), ['first']);
    assert.match(ui.transcript(), /persisted=true/);
    assert.ok(ui.transcript().startsWith(SCREEN_ENTER));
    assert.ok(ui.transcript().endsWith(SCREEN_LEAVE));
    assert.deepEqual(ui.rawTransitions, [true, false]);
    assert.equal(ui.input.listenerCount('data'), 0);
    assert.equal(ui.runtime.status, 'stopped');
  } finally { ui.input.write('\x03'); await ui.running; }
});

it('retains rejected text, handles lifecycle commands and submits bracketed multiline slash text', { timeout: 4000 }, async () => {
  const ui = await create(request => done(request.messages.at(-1)!.content));
  try {
    ui.input.write('/stop\x13'); await eventually(() => ui.runtime.status === 'stopped');
    await eventually(() => ui.transcript().includes('/stop · 完成'));
    ui.input.write('保留正文\x13');
    await eventually(() => ui.transcript().includes('拒绝 not_running'));
    const lastFrame = ui.transcript().slice(ui.transcript().lastIndexOf('\x1b[?25l'));
    assert.match(lastFrame, /› 保留正文/);
    ui.input.write('\x15/start\x13');
    await eventually(() => ui.transcript().includes('/start · 完成'));
    ui.input.write('\x1b[200~//第一行\r\n第二行\x1b[201~');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await ui.store.read()).filter(entry => entry.kind === 'input').length, 0);
    ui.input.write('\x13');
    await eventually(() => ui.transcript().includes('succeeded · persisted=true'));
    ui.input.end(); await ui.running;
    const inputs = (await ui.store.read()).filter(entry => entry.kind === 'input');
    assert.deepEqual(inputs.map(entry => entry.input.content.text), ['/第一行\n第二行']);
    assert.deepEqual(ui.rawTransitions, [true, false]);
  } finally { ui.input.write('\x03'); await ui.running; }
});

it('shows tool failures and final persistence independently and cancels an uncooperative input', { timeout: 4000 }, async () => {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const ui = await create((_request, index) => {
    if (index === 0) return { finishReason: 'tool_calls', toolCalls: [{ callId: 'failed-call', toolName: 'fixture.fail', arguments: { message: 'domain failure' } }] };
    if (index === 1) return done('reply without diagnostic');
    entered(); return new Promise(() => undefined);
  });
  try {
    ui.input.write('tool failure\x13');
    await eventually(() => ui.transcript().includes('reply without diagnostic'));
    assert.match(ui.transcript(), /fixture_failure: domain failure/);
    assert.match(ui.transcript(), /round=2/);
    ui.input.write('blocked\x13'); await ready;
    ui.input.write('/cancel\x13');
    await eventually(() => ui.transcript().includes('cancelled · persisted=true'));
    await eventually(() => ui.transcript().includes('取消回执'));
    ui.input.write('\x03'); await ui.running;
    assert.equal((await ui.store.read()).filter(entry => entry.kind === 'run_finished').length, 2);
  } finally { ui.input.write('\x03'); await ui.running; }
});

it('keeps the screen active during EOF draining and allows Ctrl+C to interrupt that drain', { timeout: 4000 }, async () => {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const ui = await create(() => { entered(); return new Promise(() => undefined); });
  try {
    ui.input.write('blocked\x13'); await ready;
    ui.input.write('\x04');
    await eventually(() => ui.transcript().includes('等待已受理输入完成后退出'));
    assert.equal(ui.input.isRaw, true);
    ui.input.write('\x03'); await ui.running;
    assert.equal(ui.runtime.status, 'stopped');
    assert.match(ui.transcript(), /persisted=true/);
    assert.deepEqual(ui.rawTransitions, [true, false]);
  } finally { ui.input.write('\x03'); await ui.running; }
});

it('restores raw mode and screen state when input fails', { timeout: 3000 }, async () => {
  const ui = await create(() => done('reply'));
  const rejected = assert.rejects(ui.running, /input failed/);
  ui.input.emit('error', new Error('input failed'));
  await rejected;
  assert.equal(ui.runtime.status, 'stopped');
  assert.deepEqual(ui.rawTransitions, [true, false]);
  assert.ok(ui.transcript().endsWith(SCREEN_LEAVE));
});

it('uses the existing line Console without raw mode or screen escapes for redirected streams', { timeout: 3000 }, async () => {
  const ui = await create(request => done(request.messages.at(-1)!.content), false);
  ui.input.end('plain input\n'); await ui.running;
  assert.match(ui.transcript(), /plain input/);
  assert.doesNotMatch(ui.transcript(), /\x1b/);
  assert.deepEqual(ui.rawTransitions, []);
});
