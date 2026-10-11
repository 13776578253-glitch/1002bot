/** QQ configuration binds one account, conversation and ordered source to one Session. */
import type { WorldStream } from '1002bot/protocol';

export interface Conversation { kind: 'group' | 'private'; id: number }
export interface QQBinding extends WorldStream {
  sessionId: string;
  worldId: string;
  accountId: number;
  conversation: Conversation;
}
export interface QQConfig {
  endpoint: string;
  accessToken: string;
  journalPath: string;
  binding: QQBinding;
  limits?: Partial<QQLimits>;
  onDiagnostic?: (diagnostic: QQDiagnostic) => void;
}
/** Memory storage shares the same domain contract within one World instance. */
export type QQMemoryConfig = Omit<QQConfig, 'journalPath'> & { storage: 'memory' };
export type QQWorldConfig = QQConfig | QQMemoryConfig;
export interface QQLimits {
  bufferEntries: number;
  bufferBytes: number;
  journalBytes: number;
  reserveBytes: number;
  frameBytes: number;
  eventBytes: number;
  textBytes: number;
  metadataEntries: number;
  connectMs: number;
  startMs: number;
  apiMs: number;
  retryMs: number;
  reconnectMs: number;
  idleMs: number;
  cleanupMs: number;
  pendingActions: number;
}
export interface QQDiagnostic { code: string; message: string; at: string }
export const DEFAULT_QQ_LIMITS: Readonly<QQLimits> = Object.freeze({
  bufferEntries: 256, bufferBytes: 16 * 1024 * 1024,
  journalBytes: 256 * 1024 * 1024, reserveBytes: 4 * 1024 * 1024,
  frameBytes: 1024 * 1024, eventBytes: 64 * 1024, textBytes: 8 * 1024,
  metadataEntries: 32, connectMs: 5000, startMs: 30_000, apiMs: 7000,
  retryMs: 250, reconnectMs: 1000, idleMs: 90_000, cleanupMs: 3000, pendingActions: 16,
});
export function validateConfig(config: QQWorldConfig): QQLimits {
  const url = new URL(config.endpoint);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid OneBot endpoint');
  if (!config.accessToken || /[\r\n]/.test(config.accessToken)) throw new Error('Invalid OneBot access token');
  if ('storage' in config && config.storage !== 'memory') throw new Error('Invalid QQ storage mode');
  const b = config.binding;
  if (![b.worldId, b.sessionId, b.streamId, b.epoch].every(value => typeof value === 'string' && value.length > 0)) throw new Error('Missing QQ binding');
  if (!('storage' in config && config.storage === 'memory') && (!('journalPath' in config) || typeof config.journalPath !== 'string' || !config.journalPath)) throw new Error('Missing QQ journalPath');
  if (!positiveId(b.accountId) || !positiveId(b.conversation.id) || !['group', 'private'].includes(b.conversation.kind)) throw new Error('Invalid QQ account/conversation');
  const limits = { ...DEFAULT_QQ_LIMITS, ...config.limits };
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0) || limits.reserveBytes >= limits.journalBytes) throw new Error('Invalid QQ limits');
  return limits;
}
export function positiveId(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
export function messageId(value: unknown): value is number { return Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647; }
export function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function nativeKey(binding: QQBinding, id: number): string { return JSON.stringify([binding.accountId, binding.conversation.kind, binding.conversation.id, id]); }
