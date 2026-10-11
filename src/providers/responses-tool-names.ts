/** A request-local bijection isolates Responses wire names from internal tool identities. */
import { createHash } from 'node:crypto';
import type { ProviderRequest } from '../protocol/index.ts';

export function responsesToolNames(request: ProviderRequest, providerId: string) {
  // 声明与历史共同建表；原生项按 callId 关联通用调用的内部身份。
  const names = new Set(request.tools.map(tool => tool.name));
  for (const message of request.messages) {
    for (const call of message.toolCalls ?? []) names.add(call.toolName);
    if (message.providerData?.providerId === providerId) for (const item of message.providerData.output) {
      if (item.type === 'function_call' && typeof item.name === 'string') names.add(message.toolCalls?.find(call => call.callId === item.call_id)?.toolName ?? item.name);
    }
  }
  const encode = new Map<string, string>(), decode = new Map<string, string>();
  // 先保留所有合法原名，后续生成别名时避开这些已占用身份。
  for (const name of names) if (/^[a-zA-Z0-9_-]+$/.test(name)) { encode.set(name, name); decode.set(name, name); }
  for (const name of [...names].sort()) {
    if (encode.has(name)) continue;
    // 非法原名优先转换为可读候选；候选重名或超长时附加摘要。
    const readable = name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool';
    const base = readable.length <= 64 && !decode.has(readable) ? readable : `${readable.slice(0, 48)}_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
    let wire = base, suffix = 0;
    while (decode.has(wire)) wire = `${base}_${++suffix}`;
    encode.set(name, wire); decode.set(wire, name);
  }
  // 未知回包名称保持原值，交由 Runtime 的工具声明校验处理。
  return { toWire: (name: string) => encode.get(name) ?? name, fromWire: (name: string) => decode.get(name) ?? name };
}
