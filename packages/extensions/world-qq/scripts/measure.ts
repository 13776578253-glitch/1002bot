/** Offline capacity and scan measurements use a real WS stream and append-only journal. */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { QQWorld } from '../src/index.ts';
import { Peer, binding, message, until, context } from '../tests/helpers/peer.ts';

const directory = await mkdtemp(join(tmpdir(), 'qq-measure-'));
const peer = new Peer(); await peer.start();
const config = { endpoint: peer.endpoint, accessToken: 'test-token', journalPath: join(directory, 'world.jsonl'), binding };
let world = new QQWorld(config);
try {
  await world.start(context().signal);
  const count = 256, start = performance.now();
  for (let id = 1; id <= count; id++) peer.push(message(id, 'x'.repeat(4096)));
  await until(() => world.inspect().sequence === count, 30000);
  const capturingMs = performance.now() - start, captured = world.inspect();
  const queryAt = performance.now();
  await world.executeTool({ callId: 'last', toolName: 'qq.get_message', arguments: { message_id: count } }, context());
  const scanLastMs = performance.now() - queryAt;
  const cleanupAt = performance.now(); await world.stop(context().signal); const cleanupMs = performance.now() - cleanupAt;
  world = new QQWorld(config); const restartAt = performance.now(); await world.start(context().signal); const restartMs = performance.now() - restartAt;
  const report = { count, textBytes: 4096, captured, capturingMs, scanLastMs, cleanupMs, restartMs, rssBytes: process.memoryUsage().rss, node: process.version, directory };
  if (process.argv[2]) { await mkdir(dirname(resolve(process.argv[2])), { recursive: true }); await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
} finally { await world.stop(context().signal); await peer.close(); }
