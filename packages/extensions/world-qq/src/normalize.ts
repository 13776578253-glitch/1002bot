/** Normalize bounded OneBot message facts without interpreting executable CQ syntax. */
import type { JsonObject } from '1002bot/protocol';
import { messageId, object, positiveId, type QQBinding, type QQLimits } from './config.ts';

export interface MessageSnapshot extends JsonObject {
  accountId: number;
  conversation: { kind: 'group' | 'private'; id: number };
  messageId: number;
  nativeTime: number | null;
  senderId: number;
  text: string;
  mentions: string[];
  references: number[];
  unsupported: string[];
  metadataTruncated: boolean;
  observedAt: string;
}
export function normalize(raw: unknown, binding: QQBinding, limits: QQLimits, observedAt = new Date().toISOString()): MessageSnapshot | undefined {
  if (!object(raw) || raw.post_type !== 'message' || raw.self_id !== binding.accountId || raw.user_id === binding.accountId) return;
  if (raw.message_type !== binding.conversation.kind || (binding.conversation.kind === 'group' ? raw.group_id : raw.user_id) !== binding.conversation.id) return;
  if (!positiveId(raw.user_id) || !messageId(raw.message_id) || !Number.isSafeInteger(raw.time) || (raw.time as number) < 0 || !Number.isFinite(new Date((raw.time as number) * 1000).getTime())) throw new Error('Invalid native message identity/time');
  if (!Array.isArray(raw.message)) throw new Error('OneBot messageFormat must be array');
  const mentions: string[] = [], references: number[] = [], unsupported: string[] = [];
  let text = '', metadataTruncated = false, count = 0;
  for (const segment of raw.message) {
    if (!object(segment) || typeof segment.type !== 'string' || !object(segment.data)) throw new Error('Malformed message segment');
    if (segment.type === 'text') {
      if (typeof segment.data.text !== 'string') throw new Error('Malformed text segment');
      text += segment.data.text;
    } else {
      if (count++ >= limits.metadataEntries) { metadataTruncated = true; continue; }
      if (segment.type === 'at' && (positiveId(segment.data.qq) || typeof segment.data.qq === 'string' && /^(all|[0-9]{1,20})$/.test(segment.data.qq))) mentions.push(String(segment.data.qq));
      else if (segment.type === 'reply' && messageId(Number(segment.data.id))) references.push(Number(segment.data.id));
      else unsupported.push(segment.type.slice(0, 64));
    }
  }
  return { accountId: binding.accountId, conversation: { ...binding.conversation }, messageId: raw.message_id,
    nativeTime: raw.time as number, senderId: raw.user_id, text, mentions, references, unsupported, metadataTruncated, observedAt };
}
// 观察时刻不参与原生事实相等判断；重连重放不会因本地接收时间变化形成冲突。
export function fingerprint(message: MessageSnapshot): string { const { observedAt: _, ...fact } = message; return JSON.stringify(fact); }
