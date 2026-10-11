/** An interactive offline chat runs the production composition against local message and model peers. */
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { composeQQChat } from './compose.ts';
import { ChatFixture, untilChat } from './chat-fixture.ts';

/** 验证真实回执与新装配清空；外部模拟服务器在重建时继续存在。 */
export async function runChatSample() {
  const fixture = new ChatFixture(); await fixture.start();
  let chat = composeQQChat(fixture.config, fixture.provider());
  try {
    await chat.runtime.start();
    for (const [index, text] of ['blue', 'repeat', '引用上一条'].entries()) {
      fixture.push(text, index === 2 ? fixture.replies[0]!.messageId : undefined);
      await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === index + 1);
    }
    const records = await chat.session.read(), replies = fixture.replies.map(reply => reply.text);
    assert.deepEqual(replies, ['收到：blue', '此前：收到：blue', '引用：收到：blue']);
    assert.equal(chat.agent.declareSession().persistent, false);
    await chat.runtime.stop(); chat = composeQQChat(fixture.config, fixture.provider()); await chat.runtime.start();
    assert.equal(chat.world.inspect().sequence, 0);
    fixture.push('repeat'); await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === 1);
    assert.equal(fixture.replies.at(-1)!.text, '此前：无历史');
    return { replies, restartedReply: fixture.replies.at(-1)!.text, rounds: records.filter(row => row.kind === 'run_finished').length,
      storage: chat.world.inspect().storage, diagnosis: await chat.runtime.inspectSession(), modelRequests: fixture.requests.length, errors: fixture.modelErrors };
  } finally { await chat.runtime.stop(); await fixture.close(); }
}

async function interactive(): Promise<void> {
  const fixture = new ChatFixture(); await fixture.start();
  let chat = composeQQChat(fixture.config, fixture.provider());
  // 启动前开始消费输入，保留管道在启动等待期间到达的命令与 EOF。
  const lines = createInterface({ input: process.stdin }), commands = lines[Symbol.asyncIterator]();
  try {
    await chat.runtime.start();
    console.log('离线 QQ 对话：输入文本；repeat 追问；/ref 消息号 文本；/history；/diagnose；/restart；/quit');
    for await (const line of commands) {
      if (line === '/quit') break;
      if (line === '/history') { console.log(JSON.stringify(await chat.session.read())); continue; }
      if (line === '/diagnose') { console.log(JSON.stringify(await chat.runtime.inspectSession())); continue; }
      if (line === '/restart') { await chat.runtime.stop(); chat = composeQQChat(fixture.config, fixture.provider()); await chat.runtime.start(); console.log(JSON.stringify({ restarted: true, world: chat.world.inspect() })); continue; }
      const ref = /^\/ref (-?\d+) (.+)$/.exec(line), before = chat.world.inspect().sequence;
      fixture.push(ref ? ref[2]! : line, ref ? Number(ref[1]) : undefined);
      await untilChat(() => chat.runtime.deliveries.progress(chat.world.stream.streamId).settledPrefix === before + 1);
      console.log(JSON.stringify({ reply: fixture.replies.at(-1), status: chat.runtime.status }));
    }
  } finally { lines.close(); await chat.runtime.stop(); await fixture.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--sample')) console.log(JSON.stringify(await runChatSample()));
  else await interactive();
}
