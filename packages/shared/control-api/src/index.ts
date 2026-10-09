/** Frontends and Runtime share public admission, diagnostics and lifecycle contracts. */
export type TriggerKind = 'user_input' | 'world_event' | 'heartbeat';

/** UserInput admits text; model messages, tool calls and native Provider data belong to execution. */
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
  /** write_pending 表示处理结果已确定，接收或最终记录的写入尚未结算。 */
  status: 'queued' | 'running' | 'write_pending' | RunResult['status'];
  result?: RunResult;
  round?: number;
}
/** Public diagnostics span every trigger source and expose no Provider-native or private error data. */
export interface OutputEvent {
  type: 'queued' | 'run_started' | 'run_status' | 'provider_started' | 'provider_finished' | 'tool_started' | 'tool_finished' | 'run_finished' | 'runtime_status' | 'heartbeat_skipped';
  triggerKind?: TriggerKind | null;
  triggerId?: string | null;
  source?: string | null;
  /** ordered World 的长期身份；原 Event.id 不代替投递元组。 */
  delivery?: { worldId: string; streamId: string; epoch: string; sequence: number };
  /** 仅 UserInput 填写；其他来源使用 triggerKind/triggerId/source 关联。 */
  inputId: string | null;
  runId: string | null;
  sessionId: string;
  /** 已受理触发沿用受理代次；Runtime 状态与跳过的心跳使用当前代次。 */
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
  /** 跳过的心跳只累计诊断，不占外部去重身份或逐 tick 保存历史。 */
  skippedCount?: number;
}
export type RunProgress = Pick<OutputEvent, 'callId' | 'toolName' | 'status' | 'error'> & {
  type: 'provider_started' | 'provider_finished' | 'tool_started' | 'tool_finished';
  round: number;
};
/** UserInput admission is a facade over the shared Session trigger channel. */
export interface InputChannel {
  /** 严格验证输入形状与容量；拒绝的输入不占用去重标识和排队序号。 */
  submit(input: UserInput): Promise<InputReceipt>;
  cancel(inputId: string): Promise<CancelReceipt>;
  /** 快照可能因容量淘汰而不可见；不可见不意味着去重标识已释放。 */
  inspect(inputId: string): InputSnapshot | undefined;
  /** 返回取消订阅函数；所有来源共享通知，监听器收到副本，异常不影响执行。 */
  subscribe(listener: (event: OutputEvent) => void): () => void;
  /** 读取 seq 之后仍保留的事件；gap 表示请求位置早于保留窗口。 */
  eventsSince(seq: number): { gap: boolean; events: readonly OutputEvent[] };
  /** 等待共享通道各来源的执行与终态写入；不代表 World 清理或 Runtime 停止已完成。 */
  idle(): Promise<void>;
}

/** Runtime implements this capability shape; frontends receive it from their composition root. */
export interface RuntimeControl {
  readonly inputs: InputChannel;
  readonly status: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
