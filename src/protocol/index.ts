/** Shared contracts keep Runtime mechanics independent of Agent semantics and World/Provider adapters. */
export type JsonPrimitive = string | number | boolean | null;
import type { UserInput, RunResult } from './input.ts';
import type { HeartbeatTrigger, HeartbeatRequest, RuntimeTrigger, TriggerKind, WorldEventSink } from './trigger.ts';
import type { WorldDeliveryIdentity, WorldDeliveryPort, HistoryReader } from './delivery.ts';
import type { AgentTaskTools, TaskRecord, TaskRunPort } from './task.ts';
export * from './input.ts';
export * from './trigger.ts';
export * from './delivery.ts';
export * from './task.ts';
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** World 提供的事实；payload 保持可序列化，语义由产生方和 Agent 解释。 */
export interface Event<TPayload extends JsonValue = JsonValue> {
  /** 原始业务身份；ordered 投递使用来源元组，legacy 保留实例内 ID 去重。 */
  id: string;
  type: string;
  source: string;
  /** 业务发生时间，受理顺序由 Runtime 序号确定，有效期由来源另行声明。 */
  occurredAt: string;
  payload: TPayload;
  meta?: JsonObject;
}

export type ToolOutcomeStatus = 'succeeded' | 'failed' | 'cancelled' | 'unknown';

/** unknown 表示外部效果无法确认；不能将它当作确定失败后继续执行。 */
export interface ToolOutcome {
  callId: string;
  toolName: string;
  status: ToolOutcomeStatus;
  output?: JsonValue;
  error?: { code: string; message: string };
}

export interface ToolCall {
  /** 在一次运行内唯一，用于配对调用与回执。 */
  callId: string;
  toolName: string;
  /** 允许适配器保留原始 JSON 字符串；Runtime 在调用 World 前验证对象形状。 */
  arguments: string | JsonObject;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface ToolExecutionContext {
  /** 请求取消协作；已产生的外部效果不会因 abort 自动撤销。 */
  signal: AbortSignal;
  /** 发起调用时的 Runtime 代次，用于关联诊断。 */
  generation: number;
}

/** World owns external effects and platform semantics; Runtime invokes only this boundary. */
export interface World {
  readonly id: string;
  /** Runtime 等待启动完成后装配感知订阅；此前产生的事实由 World 保留。 */
  start(signal: AbortSignal): Promise<void>;
  /** 清理信号独立于已中止的启动信号；超时取消不保证底层动作已退出。 */
  stop(signal: AbortSignal): Promise<void>;
  /** 同步装配订阅，返回退订函数；旧代 sink 在停止或重启后拒绝投递。 */
  subscribeEvents?(sink: WorldEventSink): () => void;
  /** 已登记的 ordered 来源接收稳定信封投递口；同一装配不同时启用旧感知订阅。 */
  subscribeDeliveries?(port: WorldDeliveryPort): () => void;
  /** 当前可用的工具声明；名称和参数语义由 World 定义。 */
  tools(): readonly ToolDefinition[];
  /** 回执须匹配调用标识与工具名；无法确认效果时必须保留 unknown。 */
  executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome>;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** tool 消息对应的调用标识；不是新调用的标识。 */
  toolCallId?: string;
  toolCalls?: readonly ToolCall[];
  providerData?: ProviderData;
}

/** Provider-native data is opaque to Runtime and Agent; only its owning adapter interprets it. */
export interface ProviderData {
  /** 防止其他 Provider 将不兼容的原生内容当作自身响应重放。 */
  providerId: string;
  /** 保留响应项的完整顺序，包括通用消息无法表达的内容。 */
  output: readonly JsonObject[];
}

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface ProviderRequest {
  sessionId: string;
  messages: readonly ModelMessage[];
  tools: readonly ProviderTool[];
}

export interface ProviderResponse {
  message?: ModelMessage;
  toolCalls: readonly ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  error?: { code: string; message: string };
  providerData?: ProviderData;
  /** 适配器测得的原始响应字节数；进程内 Provider 可省略，由 Runtime 测量 JSON。 */
  bodyBytes?: number;
}

/** Providers own transport and wire format; Runtime supplies cancellation and owns the lifecycle. */
export interface Provider {
  readonly id: string;
  /** 无网络副作用地测量 complete 实际发送的 UTF-8 请求体；所有模型执行路径要求实现。 */
  measureRequest?(request: ProviderRequest): number;
  /** signal 可由单次触发、调用期限或 Runtime 停止触发；适配器应协作释放传输资源。 */
  complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

export interface SessionDecl {
  sessionId: string;
  /** Agent 声明的模型轮次上限；执行还受 InputLimits.providerCalls 限制。 */
  maxTurns: number;
  /** Agent 的持久化意图；实际存储保证仍取决于装配的 SessionStore。 */
  persistent: boolean;
}

/** Runtime supplies request facts; Agent owns semantic context assembly. */
export interface AgentContext {
  /** 当前运行的任务权限；确认变更可在续轮读取，旧 run 撤权后不能提交。 */
  readonly tasks?: TaskRunPort;
  readonly session: SessionDecl;
  /** 有限完整运行候选及本轮事实；不含排队接收归档，语义裁剪仍由 Agent 决定。 */
  readonly history: readonly SessionEntry[];
  /** 显式读取更早完整运行；有容量预算，不提前交付排队事实。 */
  readonly readHistory?: HistoryReader;
  /** 区分当前运行与已结束历史分组，不代替 Runtime 生命周期代次。 */
  readonly runId?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly measureRequest?: (request: ProviderRequest) => number;
  readonly requestBytes?: number;
  readonly reserveBytes?: number;
}

export interface AgentContinuation {
  input: Event | UserInput | HeartbeatTrigger;
  response: ProviderResponse;
  outcomes: readonly ToolOutcome[];
  history: readonly SessionEntry[];
}

export interface Agent {
  readonly id: string;
  /** 可选 Agent 任务工具；未启用时不改变现有 World 工具路径。 */
  readonly taskTools?: AgentTaskTools;
  declareSession(): SessionDecl;
  /** 当前 Event 已作为执行事实写入 history，不应再次拼接成重复用户消息。 */
  initialRequest(event: Event, context: AgentContext): Promise<ProviderRequest>;
  /** 通用输入入口；输入已写入 context.history，无需再次拼接同一条文本。 */
  initialInputRequest?(input: UserInput, context: AgentContext): Promise<ProviderRequest>;
  /** 缺省或返回 undefined 时，心跳无模型调用并以成功终态结束。 */
  initialHeartbeatRequest?: HeartbeatRequest;
  /** undefined 正常结束 Event/Heartbeat；UserInput 仍要求最终文本回复。 */
  nextRequest(input: AgentContinuation, context: AgentContext): Promise<ProviderRequest | undefined>;
}

/**
 * Session records archive received facts and execution commits; Agent context excludes receipt-only records.
 * trigger_received 与排队终态可无 runId；终态 inputId 沿用旧字段名，值为对应触发 ID。
 */
export type SessionEntry = ({ runId?: string; triggerKind?: TriggerKind; triggerId?: string; source?: string; generation?: number; delivery?: WorldDeliveryIdentity } & (
  | TaskRecord
  | { kind: 'world_stream_registered'; at: string; schema: 1; sessionId: string; worldId: string; streamId: string; epoch: string }
  | { kind: 'trigger_received'; at: string; trigger: RuntimeTrigger; queueSequence: number }
  | { kind: 'heartbeat'; at: string; heartbeat: HeartbeatTrigger }
  | { kind: 'input'; at: string; input: UserInput; queueSequence: number }
  | { kind: 'run_started'; at: string; inputId: string }
  | { kind: 'run_finished'; at: string; inputId: string; result: RunResult }
  | { kind: 'event'; at: string; event: Event }
  | { kind: 'provider_request'; at: string; request: ProviderRequest }
  | { kind: 'provider_response'; at: string; response: ProviderResponse }
  | { kind: 'tool_call'; at: string; call: ToolCall; owner?: 'world' | 'agent' }
  | { kind: 'tool_outcome'; at: string; outcome: ToolOutcome; owner?: 'world' | 'agent' }));

export interface SessionStore {
  /** 保持追加顺序，完成后可由 read 读到；落盘与断电保证由具体存储实现定义。 */
  append(entry: SessionEntry): Promise<void>;
  /** 返回完成追加后的历史；读取失败不可伪装为空历史。 */
  read(): Promise<readonly SessionEntry[]>;
  /** 逐条读取一个已确认文件视图；ordered 基座要求此能力，失败不能跳过记录。 */
  scan?(signal?: AbortSignal): AsyncIterable<SessionEntry>;
}

/** State storage is separate from the append-only Session transcript. */
export interface StateStore {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
}
