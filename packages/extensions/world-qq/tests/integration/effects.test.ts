import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { ScriptedProvider } from '1002bot';
import { binding, message, setup, until, context, done } from '../helpers/peer.ts';

for (const mode of ['lost', 'async', 'malformed', 'disconnect', 'failed'] as const) {
  it(`preserves unknown for ${mode} send and cancels later queued work without resending`, async t => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
    const provider = new ScriptedProvider(async () => { calls++; await gate; return { finishReason: 'tool_calls', toolCalls: [{ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'reply' } }] }; });
    const { peer, world, runtime, store, config } = await setup(t, { provider }); peer.sendMode = mode; t.after(() => release());
    await runtime.start(); peer.push(message(-1)); await until(() => calls === 1);
    peer.push(message(-2)); await until(() => runtime.deliveries.progress(world.stream.streamId).receivedPrefix === 2); release();
    await runtime.triggers.idle();
    assert.equal(peer.sends.length, 1); assert.equal(calls, 1);
    const records = await store.read();
    const results = records.filter(row => row.kind === 'run_finished').map(row => row.result.status);
    assert.ok(results.includes('failed')); assert.ok(results.includes('cancelled'));
    const outcome = records.find(row => row.kind === 'tool_outcome'); assert.equal(outcome?.outcome.status, 'unknown');
    if (mode === 'async') assert.deepEqual((outcome?.outcome.output as { evidence: unknown }).evidence, { submitted: true, status: 'async', retcode: 1, messageId: null });
    const journal = await readFile(config.journalPath, 'utf8'); assert.match(journal, /intent/); assert.match(journal, /unknown/);
    assert.equal(world.inspect().sourceStopped, true);
  });
}
it('matches out-of-order echoes and ignores late replies to expired requests', async t => {
  const { peer, world, runtime } = await setup(t); await runtime.start(); peer.push(message(-1)); peer.push(message(-2));
  await until(() => world.inspect().sequence === 2); peer.holdQueries = true;
  const query = (id: number, callId: string) => world.executeTool({ callId, toolName: 'qq.get_message', arguments: { message_id: id, fresh: true } }, context());
  const first = query(-1, 'first'), second = query(-2, 'second'); await until(() => peer.queries.length === 2);
  for (const pending of [...peer.queries].reverse()) peer.reply(pending.socket, pending.action, peer.messages.get(Number(pending.action.params.message_id)));
  assert.deepEqual((await Promise.all([first, second])).map(result => result.callId), ['first', 'second']);
  const expired = query(-1, 'expired'); await until(() => peer.queries.length === 3); assert.equal((await expired).status, 'failed');
  const fresh = query(-2, 'fresh'); await until(() => peer.queries.length === 4);
  const old = peer.queries[2]!, current = peer.queries[3]!;
  assert.notEqual(old.action.echo, current.action.echo);
  peer.reply(old.socket, old.action, peer.messages.get(-1)); peer.reply(current.socket, current.action, peer.messages.get(-2));
  const result = await fresh; assert.equal(result.status, 'succeeded'); assert.equal((result.output as { message: { messageId: number } }).message.messageId, -2);
});
it('classifies cancellation after a recorded external send as unknown and closes pending waits', async t => {
  const { peer, world } = await setup(t); await world.start(context().signal); peer.sendMode = 'lost';
  const controller = new AbortController();
  const pending = world.executeTool({ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'reply' } }, context(controller.signal));
  await until(() => peer.sends.length === 1); controller.abort(); assert.equal((await pending).status, 'unknown');
  const start = performance.now(); await world.stop(context().signal); assert.ok(performance.now() - start < world.limits.cleanupMs); assert.equal(peer.sends.length, 1);
});
it('cancels before submission and rejects arbitrary recipients without effects', async t => {
  const { peer, world } = await setup(t); await world.start(context().signal);
  const controller = new AbortController(); controller.abort();
  assert.equal((await world.executeTool({ callId: 'cancel', toolName: 'qq.send_text', arguments: { text: 'reply' } }, context(controller.signal))).status, 'cancelled');
  assert.equal((await world.executeTool({ callId: 'recipient', toolName: 'qq.send_text', arguments: { text: 'reply', group_id: 999 } }, context())).status, 'failed');
  assert.equal(peer.sends.length, 0);
});
it('returns unknown if an actual confirmed send exceeds the remaining journal capacity', async t => {
  const { peer, world, runtime } = await setup(t); await runtime.start();
  // 真实协议发送保留在对端；将领域记录总容量限制在意图之后，确认追加因此失败。
  const intentBytes = Buffer.byteLength(JSON.stringify({ kind: 'intent', operationId: 'x'.repeat(36), callId: 'send', text: 'reply', at: '2026-10-11T00:00:00.000Z' }) + '\n');
  Object.assign(world.limits, { journalBytes: world.inspect().journalBytes + intentBytes + 1, reserveBytes: 1 });
  const result = await world.executeTool({ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'reply' } }, context());
  assert.equal(result.status, 'unknown'); assert.equal(result.error?.code, 'confirmation_failed'); assert.equal(peer.sends.length, 1);
  assert.equal((await world.executeTool({ callId: 'get', toolName: 'qq.get_message', arguments: { message_id: -100 } }, context())).status, 'failed');
});
it('revalidates account after reconnect and never captures an unconfirmed account', async t => {
  const { peer, world } = await setup(t); peer.accountId = 999; peer.beforeLogin = [message()];
  await assert.rejects(world.start(context().signal), /startup/); assert.equal(world.inspect().sequence, 0); assert.equal(world.inspect().connected, false);
});
it('stops a waiting send without leaving live sockets or replaying intent', async t => {
  const { peer, world, config } = await setup(t); await world.start(context().signal); peer.sendMode = 'lost';
  const pending = world.executeTool({ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'reply' } }, context());
  await until(() => peer.sends.length === 1); await world.stop(context().signal); assert.equal((await pending).status, 'unknown');
  assert.equal(world.inspect().connected, false); assert.equal(peer.sends.length, 1); assert.match(await readFile(config.journalPath, 'utf8'), /unknown/);
});
it('does not overwrite an existing native key with a colliding send confirmation', async t => {
  const { peer, world } = await setup(t); await world.start(context().signal);
  peer.push(message(-100)); await until(() => world.inspect().sequence === 1);
  const result = await world.executeTool({ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'reply' } }, context());
  assert.equal(result.status, 'unknown'); assert.equal(peer.sends.length, 1); assert.match(world.inspect().diagnostic?.message ?? '', /collides/);
});
