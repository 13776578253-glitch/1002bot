/** Controlled yielding separates logical run settlement from bounded external-operation ownership. */
import type { ToolOutcome, TriggerKind } from './index.ts';

/** 由可信工具实现声明；none 表示不改变外部业务状态，缺省仍保守处理。 */
export type ToolEffects = 'none' | 'external';
export interface RunIdentity { runId: string; generation: number }
export interface RunOrigin extends RunIdentity { sessionId: string; triggerKind: TriggerKind; triggerId: string; source: string }
/** 原调用身份与实例权限分开；不同 run 的同名 callId 不互相配对。 */
export type OperationOrigin = RunOrigin & (
  | { kind: 'world'; worldId: string; callId: string; toolName: string; effects: ToolEffects | 'unspecified' }
  | { kind: 'provider'; round: number }
);
export interface ResponseLimits {
  /** 所有未退出 Provider/World 调用的合计上限。 */
  pendingOperations: number;
  /** 主动让出后可保留的未退出调用数；强制停止仍受总上限约束。 */
  yieldedOperations: number;
  lateRecordBytes: number;
  latePendingBytes: number;
  evidenceBytes: number;
}
export const STANDARD_RESPONSE_LIMITS: Readonly<ResponseLimits> = Object.freeze({ pendingOperations: 3, yieldedOperations: 2,
  lateRecordBytes: 32 * 1024, latePendingBytes: 128 * 1024, evidenceBytes: 32 * 1024 });
export interface OperationSnapshot { origin: OperationOrigin; detached: boolean; state: 'running' | 'detached' | 'confirming' }
export type YieldReceipt =
  | { status: 'requested'; target: RunIdentity }
  | { status: 'rejected'; target: RunIdentity; code: string; message: string };
export interface LateQuery { runId: string; callId: string; bytes?: number }
export type LateResult = { status: 'returned' | 'failed' | 'discarded'; outcome?: ToolOutcome; error?: { code: string; message: string } };
/** 独立 origin 不打开普通历史活动组；撤权与迟到结算各自只保存一次。 */
export type OperationRecord =
  | { kind: 'operation_detached'; at: string; schema: 1; origin: OperationOrigin; reason: { code: string; message: string } }
  | { kind: 'operation_late'; at: string; schema: 1; origin: OperationOrigin; result: LateResult };
export type LateRecord = Extract<OperationRecord, { kind: 'operation_late' }>;
/** Read-only evidence access is budgeted; requesting a yield does not prove run settlement. */
export interface ResponseControl {
  readonly limits: Readonly<ResponseLimits>;
  snapshot(): { active: RunIdentity | null; operations: readonly OperationSnapshot[] };
  yield(target: RunIdentity): YieldReceipt;
  readLate(query: LateQuery): Promise<LateRecord | undefined>;
}
export function operationKey(origin: OperationOrigin): string {
  return JSON.stringify([origin.sessionId, origin.runId, origin.generation, origin.kind, origin.kind === 'world' ? origin.callId : origin.round]);
}
