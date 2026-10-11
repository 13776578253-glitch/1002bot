/** Explicit manual service acceptance; this entry is never imported by automated tests. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OpenAIResponsesProvider, ScriptedProvider, type Provider, type ProviderResponse } from '1002bot';
import type { QQConfig } from '@1002bot/world-qq';
import { composeQQ, composeQQChat } from './compose.ts';

const mode = process.argv[2];
if (!['bridge', 'provider', 'chat'].includes(mode ?? '')) throw new Error('Use bridge, provider or chat');
if (!process.env.QQ_CONFIG || !process.env.QQ_WS_TOKEN) throw new Error('Set QQ_CONFIG and QQ_WS_TOKEN from the target wsServers entry');
const config = JSON.parse(await readFile(resolve(process.env.QQ_CONFIG), 'utf8')) as QQConfig & { sessionPath: string };
config.accessToken = process.env.QQ_WS_TOKEN;
config.onDiagnostic = diagnostic => console.error(JSON.stringify(diagnostic));
let provider: Provider;
if (mode === 'provider' || mode === 'chat') {
  if (!process.env.MODEL_API_KEY || !process.env.MODEL_ID || !process.env.MODEL_BASE_URL) throw new Error('Set MODEL_API_KEY, MODEL_ID and MODEL_BASE_URL');
  provider = new OpenAIResponsesProvider({ apiKey: process.env.MODEL_API_KEY, model: process.env.MODEL_ID, baseUrl: process.env.MODEL_BASE_URL });
} else {
  provider = new ScriptedProvider((request): ProviderResponse => {
    const last = request.messages.at(-1)!;
    if (last.role === 'tool') {
      const result = JSON.parse(last.content) as { toolName: string; status: string };
      if (result.toolName === 'qq.get_message' && result.status === 'succeeded') return { finishReason: 'tool_calls', toolCalls: [{ callId: 'send', toolName: 'qq.send_text', arguments: { text: 'QQ World 手动验收确认' } }] };
      return { finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: 'Check tool outcome and QQ receipt manually.' } };
    }
    const event = JSON.parse(last.content) as { payload: { messageId: number } };
    return { finishReason: 'tool_calls', toolCalls: [{ callId: 'query', toolName: 'qq.get_message', arguments: { message_id: event.payload.messageId } }] };
  });
}
// chat 同时创建两个内存记录端，不读取或复用旧 Session/World 文件。
const { runtime, world, session } = mode === 'chat' ? composeQQChat(config, provider) : composeQQ(config, resolve(config.sessionPath), provider);
let finish!: () => void;
const stopped = new Promise<void>(resolve => { finish = resolve; });
const stop = () => finish(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  await runtime.start();
  console.log(JSON.stringify({ mode, ready: world.inspect(), sessionPath: mode === 'chat' ? null : config.sessionPath }));
  await stopped;
} finally {
  await runtime.stop();
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  const records = await session.read();
  console.log(JSON.stringify({ world: world.inspect(), terminals: records.filter(row => row.kind === 'run_finished').length }));
}
