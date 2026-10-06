/** The input channel defines admission, execution diagnostics and finite in-process retention. */

/** 外部只提交文本，不直接提交模型消息、工具调用或原生 Provider 内容。 */
export interface UserInput {
  /** 受理去重标识；受理后即占用，完成或取消不会释放。 */
  inputId: string;
  /** 输入来源标签，不赋予额外权限。 */
  source: string;
  content: { kind: 'text'; text: string };
}

/** accepted 只确认进入内存队列，执行和最终写入结果通过快照或事件观察。 */
export type InputReceipt =
  | { status: 'accepted'; inputId: string; queueSequence: number }
  | { status: 'rejected'; inputId: string; code: string; message: string };
/** 活动输入的 cancelled 确认取消请求已发出，最终收束仍需等待 run_finished。 */
export interface CancelReceipt { inputId: string; status: 'cancelled' | 'already_finished' | 'not_found' }
export interface RunResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  reply?: string;
  code?: string;
  message?: string;
  /** 仅表示最终 run_finished 记录写入成功，不承诺整轮事务或断电恢复。 */
  persisted: boolean;
}
export interface InputSnapshot {
  inputId: string;
  /** 出队执行时分配；排队期间及排队取消的结果为 null。 */
  runId: string | null;
  queueSequence: number;
  /** write_pending 表示执行已结束，但最终记录的写入结果尚未确认。 */
  status: 'queued' | 'running' | 'write_pending' | RunResult['status'];
  result?: RunResult;
  round?: number;
}
/** 公开诊断只携带关联标识和简要结果，不暴露请求体、原生响应或错误私有属性。 */
export interface OutputEvent {
  type: 'queued' | 'run_started' | 'run_status' | 'provider_started' | 'provider_finished' | 'tool_started' | 'tool_finished' | 'run_finished' | 'runtime_status';
  inputId: string | null;
  runId: string | null;
  sessionId: string;
  /** 输入事件沿用受理时的代次；Runtime 状态事件使用当前代次。 */
  generation: number;
  /** 通道实例内单调递增，用于读取保留窗口和检测缺口。 */
  seq: number;
  at: string;
  /** 按事件类型表达阶段或结果；tool_finished 描述执行结果，不确认回执落盘。 */
  status?: string;
  callId?: string;
  toolName?: string;
  result?: RunResult;
  /** 模型请求轮次从 1 开始，尚未发起请求时为 0。 */
  round?: number;
  /** 工具错误和 unknown 原因只投影 code/message，不能携带任意错误对象。 */
  error?: { code: string; message: string };
}
export type RunProgress = Pick<OutputEvent, 'callId' | 'toolName' | 'status' | 'error'> & {
  type: 'provider_started' | 'provider_finished' | 'tool_started' | 'tool_finished';
  round: number;
};
export interface InputChannel {
  /** 严格验证输入形状与容量；拒绝的输入不占用去重标识和排队序号。 */
  submit(input: UserInput): Promise<InputReceipt>;
  cancel(inputId: string): Promise<CancelReceipt>;
  /** 快照可能因容量淘汰而不可见；不可见不意味着去重标识已释放。 */
  inspect(inputId: string): InputSnapshot | undefined;
  /** 返回取消订阅函数；监听器收到副本，异常不影响执行。 */
  subscribe(listener: (event: OutputEvent) => void): () => void;
  /** 读取 seq 之后仍保留的事件；gap 表示请求位置早于保留窗口。 */
  eventsSince(seq: number): { gap: boolean; events: readonly OutputEvent[] };
  /** 等待执行与最终记录写入；不代表 World 清理或 Runtime 停止已完成。 */
  idle(): Promise<void>;
}
/** 所有字节限制按 UTF-8 计量，时间限制单位为毫秒。 */
export interface InputLimits {
  /** 实际序列化请求体的硬上限，包含工具声明和原生重放项。 */
  requestBytes: number;
  /** 单条受理文本上限。 */
  textBytes: number;
  /** 留给续轮增长的软余量；当前运行可使用 requestBytes 的完整硬上限。 */
  reserveBytes: number;
  /** 等待队列上限，不包含当前活动输入。 */
  pendingInputs: number;
  /** 单次输入最多发起的模型请求数。 */
  providerCalls: number;
  /** 单次模型调用期限。 */
  providerMs: number;
  /** 单次工具调用期限；超时不能证明外部效果未发生。 */
  toolMs: number;
  /** 输入出队后的整轮期限。 */
  runMs: number;
  /** 输入受理后等待出队的期限。 */
  queueMs: number;
  /** 单次响应的工具批量上限，执行任何一项前检查。 */
  toolCalls: number;
  /** 原始 HTTP 响应体或进程内响应 JSON 的上限。 */
  responseBytes: number;
  /** 通道实例累计受理标识上限；停止再启动不重置。 */
  admissionIds: number;
  /** 诊断事件同时受条数和总字节数约束。 */
  outputEntries: number;
  outputBytes: number;
  /** 快照同时受条数和总字节数约束，独立于受理去重表。 */
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
