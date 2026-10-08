/** Offline same-process TUI composition; only the Provider is scripted. */
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { ConversationAgent } from '1002bot';
import { runTui } from '@1002bot/tui';
import { runTerminal } from '../../src/console/terminal.ts';
import { ScriptedProvider } from '1002bot';
import { composeRuntime } from '1002bot';
import { JsonlSessionStore } from '1002bot';
import { MemoryState } from '1002bot';
import { FixtureWorld } from '../../tests/fixtures/fixture-world.ts';
import type { JsonValue, ProviderResponse } from '1002bot';

const directory = await mkdtemp(join(tmpdir(), 'bot-tui-'));
const provider = new ScriptedProvider(async (request): Promise<ProviderResponse> => {
  // 仅为离线交互留出观察窗口；延迟不属于 Runtime 的心跳或执行调度。
  await setTimeout(600);
  const last = request.messages.at(-1)!;
  if (last.role === 'tool') return { toolCalls: [], finishReason: 'stop', message: { role: 'assistant', content: `工具回执：${last.content}` } };
  const match = /^(get|set|fail)\s+([^\s]+)(?:\s+([\s\S]+))?$/.exec(last.content);
  if (!match) return { toolCalls: [], finishReason: 'stop', message: { role: 'assistant', content: `离线回复：${last.content}` } };
  let value: JsonValue = match[3] ?? '';
  try { value = JSON.parse(match[3] ?? 'null') as JsonValue; } catch { /* Fixture values may also be text. */ }
  const name = match[1]!;
  return { finishReason: 'tool_calls', toolCalls: [{ callId: randomUUID(), toolName: `fixture.${name}`,
    arguments: name === 'fail' ? { message: match[2]! } : name === 'get' ? { key: match[2]! } : { key: match[2]!, value } }] };
});
// 样例组合根创建依赖；TUI 模块只收到 Runtime 的公共能力。
const runtime = composeRuntime({ agent: new ConversationAgent({ sessionId: 'tui-sample' }), provider,
  world: new FixtureWorld(), session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState() });
try {
  await runtime.start();
  await runTui(runtime, { fallback: runTerminal, initialMessage: `离线样例 · set key 7 / get key / fail reason\n会话日志：${join(directory, 'session.jsonl')}` });
} finally { await runtime.stop(); }
