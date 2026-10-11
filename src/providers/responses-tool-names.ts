/** A request-local bijection isolates Responses wire names from internal tool identities. */
import { createHash } from 'node:crypto';
import type { ProviderRequest } from '../protocol/index.ts';

export function responsesToolNames(request: ProviderRequest, providerId: string) {
  const names = new Set(request.tools.map(tool => tool.name));
  for (const message of request.messages) {
    for (const call of message.toolCalls ?? []) names.add(call.toolName);
    if (message.providerData?.providerId === providerId) for (const item of message.providerData.output) {
      if (item.type === 'function_call' && typeof item.name === 'string') names.add(message.toolCalls?.find(call => call.callId === item.call_id)?.toolName ?? item.name);
    }
  }
  const encode = new Map<string, string>(), decode = new Map<string, string>();
  // 已合法的声明保留原名；历史调用一起建表，保证完整原生项可再次编码。
  for (const name of names) if (/^[a-zA-Z0-9_-]+$/.test(name)) { encode.set(name, name); decode.set(name, name); }
  for (const name of [...names].sort()) {
    if (encode.has(name)) continue;
    // 普通命名保持可读；重名或超长时才引入摘要后缀，避免点号与下划线混淆。
    const readable = name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool';
    const base = readable.length <= 64 && !decode.has(readable) ? readable : `${readable.slice(0, 48)}_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
    let wire = base, suffix = 0;
    while (decode.has(wire)) wire = `${base}_${++suffix}`;
    encode.set(name, wire); decode.set(wire, name);
  }
  return { toWire: (name: string) => encode.get(name) ?? name, fromWire: (name: string) => decode.get(name) ?? name };
}
