/** Ordered World delivery separates producer identity, receipt persistence and terminal settlement. */
import type { Event, SessionEntry } from './index.ts';
export interface WorldStream { streamId: string; epoch: string }
export interface WorldDelivery extends WorldStream {
  /** 来源在首次投递前固定；重投不重新计号，首版从 1 连续递增。 */
  sequence: number;
  event: Event;
  expiresAt?: string;
}
export interface WorldDeliveryIdentity extends WorldStream { worldId: string; sequence: number }
export interface WorldProgress extends WorldStream {
  worldId: string;
  admittedTail: number;
  receivedPrefix: number;
  settledPrefix: number;
  nextExpectedSequence: number | null;
  uncompacted: number;
  accepting: boolean;
  blocking?: { code: string; message: string };
}
export type WorldReceipt =
  | { status: 'accepted'; triggerId: string; queueSequence: number }
  | { status: 'duplicate'; triggerId: string; stage: 'admitted' | 'saved' | 'settled' }
  | { status: 'rejected'; triggerId: string; code: string; message: string; expectedSequence?: number };
/** 保存等待属于原受理项，缓存淘汰或停止不取消已进入的追加。 */
export interface WorldDeliveryPort {
  submit(delivery: WorldDelivery): Promise<WorldReceipt>;
  waitSaved(identity: WorldStream & { sequence: number }): Promise<WorldDeliveryIdentity>;
  progress(streamId: string): WorldProgress;
}
export interface DeliveryLimits { streams: number; positions: number; legacyIds: number }
export const STANDARD_DELIVERY_LIMITS: Readonly<DeliveryLimits> = Object.freeze({ streams: 16, positions: 16, legacyIds: 4096 });
export interface HistoryLimits { runs: number; bytes: number; traceEntries: number; traceBytes: number }
export const STANDARD_HISTORY_LIMITS: Readonly<HistoryLimits> = Object.freeze({ runs: 32, bytes: 16 * 1024 * 1024, traceEntries: 256, traceBytes: 4 * 1024 * 1024 });
export interface HistoryQuery { beforeRunId?: string; runs?: number; bytes?: number; includeUnsuccessful?: boolean }
export type HistoryReader = (query?: HistoryQuery) => Promise<readonly SessionEntry[]>;
export interface SessionIssue { code: string; message: string; record?: number; runId?: string; triggerId?: string }
export interface HistoryStats { runs: number; bytes: number; omittedRuns: number }
export interface SessionDiagnosis { status: 'ready' | 'blocked' | 'legacy_store'; records: number; issueCount: number; issues: readonly SessionIssue[]; history: HistoryStats }
/** 编码入口种类，避免可任意命名的旧 Event.id 与 ordered 句柄撞键。 */
export function worldTriggerId(identity: WorldDeliveryIdentity): string { return JSON.stringify(['ordered', identity.worldId, identity.streamId, identity.epoch, identity.sequence]); }
export function legacyWorldTriggerId(id: string): string { return JSON.stringify(['legacy', id]); }
