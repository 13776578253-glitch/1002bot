import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { it } from 'node:test';
import { ScriptedProvider } from '1002bot';
import type { WorldDeliveryPort, WorldDelivery } from '1002bot/protocol';
import { QQWorld } from '../../src/index.ts';
import { Peer, binding, message, setup, until, context, done } from '../helpers/peer.ts';

it('captures early messages after login, filters self/other conversations and deduplicates concurrently', async t => {
  const { peer, world, runtime, store } = await setup(t);
  peer.beforeLogin = [message(-1), message(-2, 'self', { user_id: binding.accountId }), message(-3, 'elsewhere', { group_id: 999 }), message(-4, 'sent', { post_type: 'message_sent' })];
  await runtime.start();
  for (let id = -1; id >= -8; id--) { peer.push(message(id)); peer.push(message(id)); }
  await until(() => runtime.deliveries.progress(world.stream.streamId).settledPrefix === 8);
  await until(() => world.inspect().savedPrefix === 8);
  const received = (await store.read()).filter(row => row.kind === 'trigger_received');
  assert.equal(received.length, 8); assert.deepEqual(received.map(row => row.delivery?.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(world.inspect().bufferedEntries, 0);
});
it('query/send/continuation persists the Session terminal and never automatically sends final text', async t => {
  const provider = new ScriptedProvider([
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'get', toolName: 'qq.get_message', arguments: { message_id: -1 } }] },
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'send', toolName: 'qq.send_text', arguments: { text: '[CQ:at,qq=999] @name' } }] }, done(),
  ]);
  const { peer, world, runtime, store } = await setup(t, { provider }); await runtime.start(); peer.push(message());
  await until(() => runtime.deliveries.progress(world.stream.streamId).settledPrefix === 1);
  assert.equal(peer.sends.length, 1); assert.deepEqual(peer.sends[0]!.params, { group_id: binding.conversation.id, message: [{ type: 'text', data: { text: '[CQ:at,qq=999] @name' } }] });
  const outcomes = (await store.read()).filter(row => row.kind === 'tool_outcome');
  assert.deepEqual(outcomes.map(row => row.outcome.status), ['succeeded', 'succeeded']);
  assert.ok((await store.read()).some(row => row.kind === 'run_finished' && row.result.persisted && row.result.status === 'succeeded'));
  const sent = await world.executeTool({ callId: 'sent', toolName: 'qq.get_message', arguments: { message_id: -100 } }, context());
  assert.equal(sent.status, 'succeeded'); assert.equal(world.inspect().sequence, 1);
});
it('requires known binding and complete remote evidence for a fresh observation', async t => {
  const { peer, world, runtime } = await setup(t); await runtime.start(); peer.push(message()); await until(() => world.inspect().sequence === 1);
  const query = (id: number, fresh = true) => world.executeTool({ callId: 'query', toolName: 'qq.get_message', arguments: { message_id: id, fresh } }, context());
  assert.equal((await query(999)).status, 'failed'); assert.equal(peer.actions.filter(a => a.action === 'get_msg').length, 0);
  const valid = await query(-1); assert.equal(valid.status, 'succeeded'); assert.equal((valid.output as { fresh: boolean }).fresh, true);
  for (const overrides of [{ self_id: undefined }, { group_id: 999 }, { time: 1 }, { user_id: 999 }, { message: [{ type: 'text', data: { text: 'collision' } }] }]) {
    peer.messages.set(-1, message(-1, 'hello', overrides)); assert.equal((await query(-1)).status, 'failed');
  }
  assert.equal((await query(-1, false)).status, 'succeeded');
});
it('survives saved restart and reconnection without renumbering or accepting a new binding', async t => {
  const { peer, world, runtime, config } = await setup(t); await runtime.start(); peer.push(message());
  await until(() => world.inspect().savedPrefix === 1 && runtime.deliveries.progress(world.stream.streamId).settledPrefix === 1);
  peer.disconnect(); await until(() => peer.connections >= 2 && world.inspect().connected); peer.push(message());
  await runtime.stop();
  const other = new QQWorld({ ...config, binding: { ...binding, sessionId: 'different' } });
  await assert.rejects(other.start(context().signal), /binding conflict/); await other.stop(context().signal);
  const restarted = new QQWorld(config); t.after(() => restarted.stop(context().signal)); await restarted.start(context().signal);
  peer.push(message()); peer.push(message(-2)); await until(() => restarted.inspect().bufferedEntries === 0 && restarted.inspect().sequence === 2);
  assert.equal(restarted.inspect().savedPrefix, 1);
});
it('halts capture on native key conflict with the original envelope intact', async t => {
  const { peer, world, runtime } = await setup(t); await runtime.start(); peer.push(message()); await until(() => world.inspect().sequence === 1);
  peer.push(message(-1, 'different')); await until(() => world.inspect().sourceStopped);
  assert.equal(world.inspect().diagnostic?.code, 'native_identity_conflict'); assert.equal(world.inspect().sequence, 1);
});
it('does not advance saved prefix until Session receipt is appended and retries window pressure', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let blocked = false;
  let finishModel!: () => void; const model = new Promise<void>(resolve => { finishModel = resolve; }); let rejected = false;
  const { peer, world, runtime, store } = await setup(t, {
    provider: new ScriptedProvider(async () => { await model; return done(); }),
    wrapPort: port => ({ submit: async delivery => { const receipt = await port.submit(delivery); if (receipt.status === 'rejected' && receipt.code === 'delivery_window_full') rejected = true; return receipt; },
      waitSaved: delivery => port.waitSaved(delivery), progress: stream => port.progress(stream) }),
    wrap: store => ({ read: () => store.read(), scan: signal => store.scan(signal), append: async row => {
    if (row.kind === 'trigger_received' && !blocked) { blocked = true; await gate; } await store.append(row);
  } }) });
  t.after(() => { release(); finishModel(); }); await runtime.start();
  peer.push(message(-1)); peer.push(message(-2)); peer.push(message(-3));
  await until(() => blocked && world.inspect().sequence === 3); assert.equal(world.inspect().savedPrefix, 0);
  release(); await until(() => rejected); assert.equal(world.inspect().savedPrefix, 2);
  finishModel(); await until(() => world.inspect().savedPrefix === 3 && runtime.deliveries.progress(world.stream.streamId).settledPrefix === 3);
  assert.equal((await store.read()).filter(row => row.kind === 'trigger_received').length, 3);
});
it('retries the original envelope after losing an actual Runtime saving acknowledgement', async t => {
  const seen: number[] = []; let confirmations = 0;
  const { peer, world, runtime, store } = await setup(t, { wrapPort: port => ({
    submit: async delivery => { seen.push(delivery.sequence); return port.submit(delivery); },
    waitSaved: async delivery => { const saved = await port.waitSaved(delivery); if (++confirmations === 1) throw new Error('Saving acknowledgement lost'); return saved; },
    progress: stream => port.progress(stream),
  }) });
  await runtime.start(); peer.push(message());
  await until(() => world.inspect().savedPrefix === 1);
  assert.deepEqual(seen, [1, 1]); assert.equal((await store.read()).filter(row => row.kind === 'trigger_received').length, 1);
});
it('synchronously revokes the old delivery port and releases waiting pump on stop', async t => {
  let calls = 0, blocked = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const ports: WorldDeliveryPort[] = [];
  const { peer, world, runtime, config } = await setup(t, {
    wrapPort: port => { ports.push(port); return { submit: async delivery => { calls++; return port.submit(delivery); }, waitSaved: delivery => port.waitSaved(delivery), progress: stream => port.progress(stream) }; },
    wrap: store => ({ read: () => store.read(), scan: signal => store.scan(signal), append: async row => { if (row.kind === 'trigger_received' && !blocked) { blocked = true; await gate; } await store.append(row); } }),
  });
  t.after(() => release()); await runtime.start(); peer.push(message()); await until(() => blocked);
  await world.stop(context().signal); assert.equal(calls, 1); assert.equal(world.inspect().connected, false);
  const stopping = runtime.stop(); release(); await stopping; await runtime.start();
  const original = (await readFile(config.journalPath, 'utf8')).split('\n').map(line => line ? JSON.parse(line) as { kind: string; delivery?: WorldDelivery } : undefined).find(row => row?.kind === 'received')!.delivery!;
  assert.equal((await ports[0]!.submit(original) as { code: string }).code, 'stale_generation');
});
it('rejects oversized facts before allocation and stops visibly at capture capacity', async t => {
  const { peer, world, runtime } = await setup(t, { limits: { eventBytes: 1024, bufferEntries: 2 } }); await runtime.start();
  peer.push(message(-1, 'x'.repeat(2000))); await until(() => world.inspect().diagnostic?.code === 'event_capacity'); assert.equal(world.inspect().sequence, 0);
  for (let id = 1; id <= 20; id++) peer.push(message(id)); await until(() => world.inspect().sourceStopped);
  assert.ok(world.inspect().peakEntries <= 2); assert.ok(world.inspect().peakBytes <= world.limits.bufferBytes);
});
it('stops at journal capacity while reserving space for a visible stop record', async t => {
  const { peer, world, runtime, config } = await setup(t, { limits: { journalBytes: 4096, reserveBytes: 2048 } }); await runtime.start();
  for (let id = 1; id <= 10; id++) peer.push(message(id)); await until(() => world.inspect().sourceStopped);
  assert.ok(world.inspect().journalBytes <= world.limits.journalBytes);
  assert.match(await readFile(config.journalPath, 'utf8'), /diagnostic/); assert.ok(world.inspect().sequence < 10);
});
it('rejects incomplete journal tails without truncating historical bytes', async t => {
  const { world, config } = await setup(t); await world.start(context().signal); await world.stop(context().signal);
  await appendFile(config.journalPath, '{"kind":'); const before = await readFile(config.journalPath);
  const restarted = new QQWorld(config); await assert.rejects(restarted.start(context().signal), /incomplete tail/);
  assert.deepEqual(await readFile(config.journalPath), before);
});
it('Session preflight blocks before opening or modifying the existing World journal', async t => {
  const { peer, world, runtime, store, config } = await setup(t); await world.start(context().signal); await world.stop(context().signal);
  const before = await readFile(config.journalPath); await store.append({ kind: 'run_started', at: new Date().toISOString(), runId: 'unfinished', inputId: 'orphan' });
  const connections = peer.connections; await assert.rejects(runtime.start(), /diagnosis/);
  assert.equal(peer.connections, connections); assert.deepEqual(await readFile(config.journalPath), before);
});
it('fails capture when the real journal cannot grow and retains the assigned prefix', async t => {
  const { peer, world, runtime, config } = await setup(t); await runtime.start();
  // 以真实容量边界模拟写入拒绝；已分配的信封仍保留。
  peer.push(message()); await until(() => world.inspect().savedPrefix === 1);
  Object.assign(world.limits, { journalBytes: world.inspect().journalBytes + world.limits.reserveBytes + 1 });
  peer.push(message(-2)); await until(() => world.inspect().sourceStopped); assert.equal(world.inspect().sequence, 1);
  assert.match(await readFile(config.journalPath, 'utf8'), /received/);
});
it('stop during account confirmation closes startup resources and permits a later clean start', async t => {
  const { peer, world } = await setup(t); peer.loginDelay = 1000;
  const starting = world.start(context().signal); const rejected = assert.rejects(starting, /startup/);
  await until(() => peer.connections === 1); await world.stop(context().signal); await rejected;
  assert.equal(world.inspect().running, false); assert.equal(world.inspect().connected, false);
  peer.loginDelay = 0; await world.start(context().signal); assert.equal(world.inspect().connected, true);
});
it('excludes foreign private peers and sends only to the bound private recipient', async t => {
  const { config, peer } = await setup(t);
  const world = new QQWorld({ ...config, binding: { ...binding, conversation: { kind: 'private', id: 30001 } } }); t.after(() => world.stop(context().signal));
  await world.start(context().signal);
  peer.push(message(-1, 'private', { message_type: 'private', user_id: 30001 }));
  peer.push(message(-2, 'foreign', { message_type: 'private', user_id: 999 }));
  await until(() => world.inspect().sequence === 1 && world.inspect().bufferedEntries === 0);
  const result = await world.executeTool({ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'private reply' } }, context());
  assert.equal(result.status, 'succeeded'); assert.equal(peer.sends[0]!.action, 'send_private_msg'); assert.equal(peer.sends[0]!.params.user_id, 30001);
});
it('holds the journal exclusively while an active World owns its file', async t => {
  const { config, world } = await setup(t); await world.start(context().signal);
  const second = new QQWorld(config); await assert.rejects(second.start(context().signal), /already in use/);
  assert.equal(world.inspect().connected, true); await second.stop(context().signal);
});
it('retries an unavailable account endpoint until a real local service becomes ready', async t => {
  const { peer, config } = await setup(t); const port = Number(new URL(peer.endpoint).port); await peer.close();
  let unavailable = false;
  const world = new QQWorld({ ...config, onDiagnostic: diagnostic => { if (diagnostic.code === 'connection_unavailable') unavailable = true; } });
  t.after(() => world.stop(context().signal));
  const starting = world.start(context().signal); await until(() => unavailable);
  const replacement = new Peer(port); await replacement.start(); t.after(() => replacement.close());
  await starting; assert.equal(world.inspect().connected, true);
});
it('bounds protocol frames before JSON parsing and leaves a visible transport diagnostic', async t => {
  const { peer, world } = await setup(t, { limits: { frameBytes: 1024 } }); await world.start(context().signal);
  // 未进入归一化的超限 WS 帧不会获得来源序号。
  const peerSocket = [...peer.server.clients][0]!;
  peerSocket.send('x'.repeat(2048));
  await until(() => world.inspect().diagnostic?.code === 'connection_closed' || world.inspect().diagnostic?.code === 'transport_error');
  assert.equal(world.inspect().sequence, 0);
});
