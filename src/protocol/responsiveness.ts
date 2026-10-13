/** Controlled yielding separates logical run settlement from bounded external-operation ownership. */
import type { ToolOutcome, TriggerKind } from './index.ts';

/** 由可信工具实现声明；none 表示不改变外部业务状态，不保证底层调用可取消。缺省按可能产生效果处理。 */
export type ToolEffects = 'none' | 'external';
/** 控制需同时匹配运行标识与代次；取得快照不保留该目标。 */
export interface RunIdentity { runId: string; generation: number }
/** 原调用开始时固定的归属，迟到记录继续使用该身份。 */
export interface RunOrigin extends RunIdentity { sessionId: string; triggerKind: TriggerKind; triggerId: string; source: string }
/** 原调用身份与实例权限分开；不同 run 的同名 callId 不互相配对。 */
export type OperationOrigin = RunOrigin & (
  | { kind: 'world'; worldId: string; callId: string; toolName: string; effects: ToolEffects | 'unspecified' }
  | { kind: 'provider'; round: number }
);
export interface ResponseLimits {
  /** Provider/World 登记位合计上限；原 Promise 未退出或必要记录仍在确认时均占位。 */
  pendingOperations: number;
  /** 安全让出允许保留的未退出调用上限，须小于总登记上限；强制取消只受总上限约束。 */
  yieldedOperations: number;
  /** 单条撤权/迟到记录的 UTF-8 JSON 字节上限，不计 JSONL 换行。 */
  lateRecordBytes: number;
  /** 正在确认的撤权/迟到记录合计字节上限，计量口径同 lateRecordBytes。 */
  latePendingBytes: number;
  /** 单次显式查询交付的完整迟到记录字节上限，缺省查询采用此值。 */
  evidenceBytes: number;
}
export const STANDARD_RESPONSE_LIMITS: Readonly<ResponseLimits> = Object.freeze({ pendingOperations: 3, yieldedOperations: 2,
  lateRecordBytes: 32 * 1024, latePendingBytes: 128 * 1024, evidenceBytes: 32 * 1024 });
/** running 等待原调用；detached 已撤销普通 run 权限；confirming 表示原 Promise 已退出、必要记录仍待确认。 */
export interface OperationSnapshot { origin: OperationOrigin; detached: boolean; state: 'running' | 'detached' | 'confirming' }
/** requested 仅表示控制信号已发出；run_finished 确认原项结清后，FIFO 才能继续。 */
export type YieldReceipt =
  | { status: 'requested'; target: RunIdentity }
  | { status: 'rejected'; target: RunIdentity; code: string; message: string };
/** 在当前 Session 内按原 World runId/callId 查询；bytes 可缩小单次预算，超限整条拒绝。 */
export interface LateQuery { runId: string; callId: string; bytes?: number }
/** returned 表示取得匹配的 ToolOutcome，业务成功与否仍看 outcome.status；failed/discarded 仅保存诊断。 */
export type LateResult = { status: 'returned' | 'failed' | 'discarded'; outcome?: ToolOutcome; error?: { code: string; message: string } };
/** 原关联仅放在 origin；无顶层 runId/delivery，普通历史、任务和来源投影忽略此记录。撤权与迟到结算各保存一次。 */
export type OperationRecord =
  | { kind: 'operation_detached'; at: string; schema: 1; origin: OperationOrigin; reason: { code: string; message: string } }
  | { kind: 'operation_late'; at: string; schema: 1; origin: OperationOrigin; result: LateResult };
export type LateRecord = Extract<OperationRecord, { kind: 'operation_late' }>;
/** Runtime exposes operator control and budgeted evidence queries separately from ordinary trigger admission. */
export interface ResponseControl {
  readonly limits: Readonly<ResponseLimits>;
  /** 返回身份副本；原 run 已结清时仍可能存在独立在途登记。 */
  snapshot(): { active: RunIdentity | null; operations: readonly OperationSnapshot[] };
  /** 校验当前目标、可信效果与让出名额；拒绝时不发送取消信号，也不调整队列。 */
  yield(target: RunIdentity): YieldReceipt;
  /** 只读当前 Session 归档；未找到已确认记录时返回 undefined，不启动旧工作。 */
  readLate(query: LateQuery): Promise<LateRecord | undefined>;
}
/** 组合原 Session/run/代次及调用标识；工具名、World 和效果声明另由回执配对核验。 */
export function operationKey(origin: OperationOrigin): string {
  return JSON.stringify([origin.sessionId, origin.runId, origin.generation, origin.kind, origin.kind === 'world' ? origin.callId : origin.round]);
}
