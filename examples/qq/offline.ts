/** Real local WS, disk journals and Runtime; only model decisions are scripted. */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { ScriptedProvider } from '1002bot';
import { composeQQ } from './compose.ts';

const directory = await mkdtemp(join(tmpdir(), 'qq-offline-'));
const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP address');
let sends = 0;
server.on('connection', socket => socket.on('message', bytes => {
  const request = JSON.parse(bytes.toString()) as { action: string; echo: string; params: { message: unknown } };
  if (request.action === 'get_login_info') {
    socket.send(JSON.stringify({ echo: request.echo, status: 'ok', retcode: 0, data: { user_id: 10001 } }));
    socket.send(JSON.stringify({ post_type: 'message', self_id: 10001, message_type: 'group', group_id: 20001, user_id: 30001,
      message_id: -7, time: 1791676800, message: [{ type: 'text', data: { text: 'hello' } }] }));
  } else {
    assert.equal(request.action, 'send_group_msg'); assert.deepEqual(request.params.message, [{ type: 'text', data: { text: 'offline reply' } }]);
    sends++; socket.send(JSON.stringify({ echo: request.echo, status: 'ok', retcode: 0, data: { message_id: -8 } }));
  }
}));
const { runtime, world, session } = composeQQ({ endpoint: `ws://127.0.0.1:${address.port}/`, accessToken: 'offline-token', journalPath: join(directory, 'world.jsonl'),
  binding: { worldId: 'qq', sessionId: 'qq-offline', streamId: 'messages', epoch: 'first', accountId: 10001, conversation: { kind: 'group', id: 20001 } } },
  join(directory, 'session.jsonl'), new ScriptedProvider([
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'get', toolName: 'qq.get_message', arguments: { message_id: -7 } }] },
    { finishReason: 'tool_calls', toolCalls: [{ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'offline reply' } }] },
    { finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: 'local final output' } },
  ]));
try {
  await runtime.start();
  const deadline = Date.now() + 5000;
  while (runtime.deliveries.progress(world.stream.streamId).settledPrefix < 1) { if (Date.now() > deadline) throw new Error('Offline sample timed out'); await delay(10); }
  assert.equal(sends, 1);
  const records = await session.read();
  assert.ok(records.some(row => row.kind === 'run_finished' && row.result.status === 'succeeded' && row.result.persisted));
  console.log(JSON.stringify({ directory, sends, world: world.inspect(), terminal: 'succeeded' }, null, 2));
} finally { await runtime.stop(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
