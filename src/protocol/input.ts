/** Core owns execution limits and errors; public input contracts retain this compatibility export. */
export type { UserInput, InputReceipt, CancelReceipt, RunResult, InputSnapshot, OutputEvent, RunProgress, InputChannel } from '@1002bot/control-api';

/** 所有字节限制按 UTF-8 计量，时间限制单位为毫秒。 */
export interface InputLimits {
  /** 实际序列化请求体的硬上限，包含工具声明和原生重放项。 */
  requestBytes: number;
  /** 单条受理文本上限。 */
  textBytes: number;
  /** 留给续轮增长的软余量；当前运行可使用 requestBytes 的完整硬上限。 */
  reserveBytes: number;
  /** 三种触发共享的等待队列上限，不包含当前活动项。 */
  pendingInputs: number;
  /** 单次触发的模型请求上限，还受 Agent 声明的 maxTurns 限制。 */
  providerCalls: number;
  /** 单次模型调用期限。 */
  providerMs: number;
  /** 单次工具调用期限；超时不能证明外部效果未发生。 */
  toolMs: number;
  /** 触发出队后的整次处理期限，包含等待接收追加确认的时间。 */
  runMs: number;
  /** 仅 UserInput 的排队期限；World Event 与 Heartbeat 使用各自 expiresAt。 */
  queueMs: number;
  /** 单次响应的工具批量上限，执行任何一项前检查。 */
  toolCalls: number;
  /** 原始 HTTP 响应体或进程内响应 JSON 的上限。 */
  responseBytes: number;
  /** UserInput 与 World Event 累计身份上限；内部心跳不占用，停止再启动不重置。 */
  admissionIds: number;
  /** 诊断事件同时受条数和总字节数约束。 */
  outputEntries: number;
  outputBytes: number;
  /** 各来源快照共享条数和总字节预算，独立于受理去重表。 */
  snapshotEntries: number;
  snapshotBytes: number;
}
/** 默认容量固定且可在装配时覆盖；它们是执行边界，不是模型上下文 token 估计。 */
export const STANDARD_INPUT_LIMITS: Readonly<InputLimits> = Object.freeze({
  requestBytes: 64 * 1024, textBytes: 8 * 1024, reserveBytes: 16 * 1024,
  pendingInputs: 8, providerCalls: 8, providerMs: 30_000, toolMs: 10_000,
  runMs: 120_000, queueMs: 120_000, toolCalls: 8, responseBytes: 1024 * 1024,
  admissionIds: 4096, outputEntries: 256, outputBytes: 4 * 1024 * 1024,
  snapshotEntries: 128, snapshotBytes: 4 * 1024 * 1024,
});

/** 将边界失败保留为稳定错误码，供最终结果和公开诊断使用。 */
export class InputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
