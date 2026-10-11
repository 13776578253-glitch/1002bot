/** Explicit manual service acceptance; this entry is never imported by automated tests. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OpenAIResponsesProvider, ScriptedProvider, type Provider, type ProviderRequest, type ProviderResponse } from '1002bot';
import type { QQConfig } from '@1002bot/world-qq';
import { composeQQ } from './compose.ts';

const mode = process.argv[2];
if (!['bridge', 'provider'].includes(mode ?? '')) throw new Error('Use bridge or provider');
if (!process.env.QQ_CONFIG || !process.env.QQ_WS_TOKEN) throw new Error('Set QQ_CONFIG and QQ_WS_TOKEN from the target wsServers entry');
const config = JSON.parse(await readFile(resolve(process.env.QQ_CONFIG), 'utf8')) as QQConfig & { sessionPath: string };
config.accessToken = process.env.QQ_WS_TOKEN;
config.onDiagnostic = diagnostic => console.error(JSON.stringify(diagnostic));
let provider: Provider;
if (mode === 'provider') {
  if (!process.env.MODEL_API_KEY || !process.env.MODEL_ID || !process.env.MODEL_BASE_URL) throw new Error('Set MODEL_API_KEY, MODEL_ID and MODEL_BASE_URL');
  const rawProvider = new OpenAIResponsesProvider({ apiKey: process.env.MODEL_API_KEY, model: process.env.MODEL_ID, baseUrl: process.env.MODEL_BASE_URL });
  // OpenAI Responses API 限制工具名满足 ^[a-zA-Z0-9_-]+$；在传输层将 qq.* 与 qq_* 双向映射。
  const toWire = (name: string) => name.replaceAll('.', '_');
  const fromWire = (name: string) => name.replace(/^qq_/, 'qq.');
  const mapRequest = (req: ProviderRequest): ProviderRequest => ({
    ...req,
    tools: req.tools.map(t => ({ ...t, name: toWire(t.name) })),
    messages: req.messages.map(m => ({
      ...m,
      ...(m.toolCalls ? { toolCalls: m.toolCalls.map(c => ({ ...c, toolName: toWire(c.toolName) })) } : {}),
      ...(m.providerData ? {
        providerData: {
          ...m.providerData,
          output: m.providerData.output.map(item =>
            item.type === 'function_call' && typeof item.name === 'string'
              ? { ...item, name: toWire(item.name) }
              : item
          ),
        },
      } : {}),
    })),
  });
  provider = {
    id: rawProvider.id,
    measureRequest: req => rawProvider.measureRequest(mapRequest(req)),
    complete: async (req, signal) => {
      const res = await rawProvider.complete(mapRequest(req), signal);
      return {
        ...res,
        toolCalls: res.toolCalls.map(c => ({ ...c, toolName: fromWire(c.toolName) })),
      };
    },
  };
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
const { runtime, world, session } = composeQQ(config, resolve(config.sessionPath), provider);
let finish!: () => void;
const stopped = new Promise<void>(resolve => { finish = resolve; });
const stop = () => finish(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  await runtime.start();
  console.log(JSON.stringify({ mode, ready: world.inspect(), sessionPath: config.sessionPath }));
  await stopped;
} finally {
  await runtime.stop();
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  const records = await session.read();
  console.log(JSON.stringify({ world: world.inspect(), terminals: records.filter(row => row.kind === 'run_finished').length }));
}
