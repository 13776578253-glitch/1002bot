import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { runTerminal } from '../src/console/terminal.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { composeRuntime } from '../src/runtime/compose.ts';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import { FixtureWorld } from '../tests/fixtures/fixture-world.ts';
import type { JsonValue, ProviderResponse } from '../src/protocol/index.ts';

const directory = await mkdtemp(join(tmpdir(), 'bot-console-'));
const provider = new ScriptedProvider((request): ProviderResponse => {
  const last = request.messages.at(-1)!;
  if (last.role === 'tool') return { toolCalls: [], finishReason: 'stop', message: { role: 'assistant', content: `工具回执：${last.content}` } };
  const match = /^(get|set|fail)\s+([^\s]+)(?:\s+([\s\S]+))?$/.exec(last.content);
  if (!match) return { toolCalls: [], finishReason: 'stop', message: { role: 'assistant', content: `离线回复：${last.content}` } };
  let value: JsonValue = match[3] ?? '';
  try { value = JSON.parse(match[3] ?? 'null') as JsonValue; } catch { /* Plain text is also a fixture value. */ }
  const name = match[1]!;
  return { finishReason: 'tool_calls', toolCalls: [{ callId: randomUUID(), toolName: `fixture.${name}`,
    arguments: name === 'fail' ? { message: match[2]! } : name === 'get' ? { key: match[2]! } : { key: match[2]!, value } }] };
});
const runtime = composeRuntime({ agent: new ConversationAgent({ sessionId: 'console-sample' }), provider,
  world: new FixtureWorld(), session: new JsonlSessionStore(join(directory, 'session.jsonl')), state: new MemoryState() });
await runtime.start();
process.stdout.write(`离线样例：set key 7 / get key / fail reason；其他正文原样回复\nSession: ${join(directory, 'session.jsonl')}\n`);
await runTerminal(runtime);
