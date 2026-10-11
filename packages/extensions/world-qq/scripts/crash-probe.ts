/** Offline child process exits at real journal/Session/effect boundaries without cleanup. */
import { join } from 'node:path';
import { Runtime, ConversationAgent, ScriptedProvider, JsonlSessionStore, MemoryState } from '1002bot';
import { QQWorld } from '../src/index.ts';
import { Peer, binding, message, until, context, done } from '../tests/helpers/peer.ts';

const directory = process.argv[2]!, phase = process.argv[3]!;
const peer = new Peer(); await peer.start();
const world = new QQWorld({ endpoint: peer.endpoint, accessToken: 'test-token', journalPath: join(directory, 'world.jsonl'), binding, limits: { retryMs: 5 } });
if (phase === 'captured') {
  await world.start(context().signal); peer.push(message()); await until(() => world.inspect().sequence === 1); process.exit(0);
}
peer.sendMode = phase === 'sent' ? 'lost' : 'ok';
const runtime = new Runtime({ world, agent: new ConversationAgent({ sessionId: binding.sessionId }),
  session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState(), worldStreams: [world.stream],
  provider: new ScriptedProvider([{ finishReason: 'tool_calls', toolCalls: [{ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'reply' } }] }, done()]) });
await runtime.start(); peer.push(message());
if (phase === 'sent') { await until(() => peer.sends.length === 1); process.exit(0); }
await until(() => runtime.deliveries.progress(world.stream.streamId).settledPrefix === 1 && world.inspect().savedPrefix === 1); process.exit(0);
