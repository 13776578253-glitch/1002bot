import assert from 'node:assert/strict';
import { it } from 'node:test';
import { composeQQChat } from '../../compose.ts';
import { ChatFixture, untilChat, type WireRequest } from '../../chat-fixture.ts';
import { runChatSample } from '../../chat-offline.ts';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

it('runs memory QQ follow-up and sent-message reference dialogue and starts a fresh composition', async () => {
  const result = await runChatSample();
  assert.deepEqual(result.replies, ['收到：blue', '此前：收到：blue', '引用：收到：blue']);
  assert.equal(result.restartedReply, '此前：无历史'); assert.equal(result.storage, 'memory');
  assert.equal(result.diagnosis.status, 'ready'); assert.deepEqual(result.errors, []);
});
it('keeps a confirmed QQ reply visible after the enclosing run fails and measures the actual HTTP wire', async () => {
  const fixture = new ChatFixture(); await fixture.start(); const provider = fixture.provider();
  const chat = composeQQChat(fixture.config, provider);
  try {
    await chat.runtime.start(); fixture.failAfterSend = true; fixture.push('first reply');
    await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === 1);
    fixture.push('repeat'); await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === 2);
    assert.equal(fixture.replies[1]!.text, '此前：收到：first reply');
    const entries = await chat.session.read(), terminals = entries.filter(entry => entry.kind === 'run_finished');
    assert.deepEqual(terminals.map(entry => entry.result.status), ['failed', 'succeeded']);
    assert.equal(chat.runtime.status, 'running'); assert.equal(chat.agent.taskTools, undefined);
    assert.ok(entries.every(entry => entry.kind !== 'task_changed' && entry.kind !== 'heartbeat'));
    const requests = entries.filter(entry => entry.kind === 'provider_request');
    assert.deepEqual(requests.map(entry => provider.measureRequest(entry.request)), fixture.requestBytes);
    assert.ok(fixture.requests.every(request => request.tools.every(tool => /^[a-zA-Z0-9_-]+$/.test(tool.name))));
    assert.ok(entries.filter(entry => entry.kind === 'tool_call').every(entry => entry.call.toolName === 'qq.send_text'));
    const prior = fixture.requests[2]!.input.filter(item => item.type === 'function_call');
    assert.ok(prior.some(item => (item.arguments as string).includes('first reply')));
    assert.deepEqual(fixture.modelErrors, []);
  } finally { await chat.runtime.stop(); await fixture.close(); }
});
it('queues a new QQ message without preemption and keeps it out of the active continuation', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const fixture = new ChatFixture(async (request: WireRequest, index) => {
    if (index === 0) await gate;
    const last = request.input.at(-1)!;
    if (last.type === 'function_call_output') return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] };
    const event = JSON.parse(last.content as string) as { payload: { text: string } };
    return { output: [{ type: 'function_call', call_id: `send-${index}`, name: request.tools[1]!.name, arguments: JSON.stringify({ text: event.payload.text }) }] };
  });
  await fixture.start(); const chat = composeQQChat(fixture.config, fixture.provider());
  try {
    await chat.runtime.start(); fixture.push('active-first'); await untilChat(() => fixture.requests.length === 1);
    fixture.push('queued-second'); await untilChat(() => chat.world.inspect().savedPrefix === 2);
    assert.equal(fixture.requests.length, 1); release();
    await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === 2);
    assert.deepEqual(fixture.replies.map(reply => reply.text), ['active-first', 'queued-second']);
    assert.ok(fixture.requests.slice(0, 2).every(request => !JSON.stringify(request.input).includes('queued-second')));
    assert.deepEqual((await chat.session.read()).filter(entry => entry.kind === 'run_finished').map(entry => entry.result.status), ['succeeded', 'succeeded']);
  } finally { release(); await chat.runtime.stop(); await fixture.close(); }
});
it('stops memory dialogue after an unconfirmed actual send and cancels queued messages', async () => {
  const fixture = new ChatFixture(); await fixture.start(); fixture.loseSendConfirmation = true;
  const chat = composeQQChat(fixture.config, fixture.provider());
  try {
    await chat.runtime.start(); fixture.push('uncertain'); fixture.push('queued');
    await untilChat(() => chat.runtime.status === 'stopped');
    const entries = await chat.session.read();
    assert.equal(fixture.replies.length, 1);
    assert.ok(entries.some(entry => entry.kind === 'tool_outcome' && entry.outcome.status === 'unknown'));
    assert.ok(entries.some(entry => entry.kind === 'run_finished' && entry.result.status === 'cancelled'));
    assert.equal((await chat.runtime.inspectSession()).status, 'blocked');
  } finally { await chat.runtime.stop(); await fixture.close(); }
});
it('halts memory capture at journal capacity before sending an unrecorded message', async () => {
  const fixture = new ChatFixture(); await fixture.start();
  const chat = composeQQChat({ ...fixture.config, limits: { ...fixture.config.limits, journalBytes: 4096, reserveBytes: 2048 } }, fixture.provider());
  try {
    await chat.runtime.start(); fixture.push('large'.repeat(500)); await untilChat(() => chat.world.inspect().sourceStopped);
    assert.equal(fixture.requests.length, 0); assert.equal(chat.world.inspect().sequence, 0);
    assert.ok(chat.world.inspect().journalBytes <= chat.world.limits.journalBytes);
  } finally { await chat.runtime.stop(); await fixture.close(); }
});
it('closes the Runtime when a required memory Session receipt exceeds total capacity', async () => {
  const fixture = new ChatFixture(); await fixture.start();
  const chat = composeQQChat(fixture.config, fixture.provider(), { sessionLimits: { bytes: 1024 } });
  try {
    await chat.runtime.start(); fixture.push('large'.repeat(500)); await untilChat(() => chat.runtime.status === 'stopped');
    assert.equal(fixture.requests.length, 0); assert.ok(chat.runtime.diagnosis.issues.some(issue => issue.code === 'storage_error'));
    await assert.rejects(chat.session.read(), /capacity/);
  } finally { await chat.runtime.stop(); await fixture.close(); }
});
it('filters non-message/self/other-conversation events and preserves native deduplication in memory', async () => {
  const fixture = new ChatFixture(); await fixture.start(); const chat = composeQQChat(fixture.config, fixture.provider());
  const raw = { post_type: 'message', self_id: 10001, message_type: 'group', group_id: 20001, user_id: 30001, message_id: 777,
    time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text: 'single' } }] };
  try {
    await chat.runtime.start();
    for (const patch of [{ post_type: 'notice' }, { post_type: 'message_sent' }, { user_id: 10001 }, { group_id: 99999 }, {}, {}]) fixture.pushRaw({ ...raw, ...patch });
    await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === 1);
    assert.equal(chat.world.inspect().sequence, 1); assert.equal(fixture.replies.length, 1);
    fixture.pushRaw({ ...raw, message: [{ type: 'text', data: { text: 'conflicting content' } }] });
    await untilChat(() => chat.world.inspect().sourceStopped);
    assert.equal(chat.world.inspect().diagnostic?.code, 'native_identity_conflict'); assert.equal(chat.world.inspect().sequence, 1);
  } finally { await chat.runtime.stop(); await fixture.close(); }
});
it('preserves one composition across stop/start and keeps history within the actual request budget', async () => {
  const fixture = new ChatFixture(); await fixture.start();
  const cap = 7000, provider = fixture.provider();
  const chat = composeQQChat(fixture.config, provider, { inputLimits: { requestBytes: cap, reserveBytes: 1500 } });
  try {
    await chat.runtime.start();
    for (let index = 0; index < 10; index++) {
      fixture.push(`topic-${index} ${'字'.repeat(100)}`);
      await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === index + 1);
    }
    assert.equal(fixture.replies.length, 10); assert.ok(fixture.requestBytes.every(bytes => bytes <= cap));
    assert.ok(!JSON.stringify(fixture.requests.at(-1)!.input).includes('topic-0'));
    for (const request of fixture.requests) {
      const calls = request.input.filter(item => item.type === 'function_call');
      assert.ok(calls.every(call => request.input.filter(item => item.type === 'function_call_output' && item.call_id === call.call_id).length === 1));
    }
    await chat.runtime.stop(); await chat.runtime.start(); fixture.push('repeat');
    await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === 11);
    assert.ok(fixture.replies.at(-1)!.text.includes('topic-9')); assert.equal(chat.world.inspect().sequence, 11);
    assert.equal(fixture.actions.filter(action => action.action === 'get_msg').length, 0);
  } finally { await chat.runtime.stop(); await fixture.close(); }
});
it('runs the complete memory chat in a fresh process without creating Session, journal or lock files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-chat-empty-'));
  const script = fileURLToPath(new URL('../../chat-offline.ts', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-strip-types', script, '--sample'], { cwd: directory, timeout: 15_000 });
  const result = JSON.parse(stdout) as { rounds: number; restartedReply: string; storage: string };
  assert.equal(result.rounds, 3); assert.equal(result.storage, 'memory'); assert.equal(result.restartedReply, '此前：无历史');
  assert.deepEqual(await readdir(directory), []);
});
