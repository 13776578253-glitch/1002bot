/** Shared contracts keep Runtime mechanics independent of Agent semantics and World/Provider adapters. */
export type JsonPrimitive = string | number | boolean | null;
import type { UserInput, RunResult } from './input.ts';
export * from './input.ts';
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** World 提供的事实；payload 保持可序列化，语义由产生方和 Agent 解释。 */
export interface Event<TPayload extends JsonValue = JsonValue> {
  id: string;
  type: string;
  source: string;
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
  start(signal: AbortSignal): Promise<void>;
  stop(signal: AbortSignal): Promise<void>;
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
  /** 无网络副作用地测量 complete 实际发送的 UTF-8 请求体；通用输入路径要求实现。 */
  measureRequest?(request: ProviderRequest): number;
  /** signal 可由单次输入、调用期限或 Runtime 停止触发；适配器应协作释放传输资源。 */
  complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

export interface SessionDecl {
  sessionId: string;
  /** 旧 Event 路径的模型轮次上限；通用输入路径使用 InputLimits.providerCalls。 */
  maxTurns: number;
  /** Agent 的持久化意图；实际存储保证仍取决于装配的 SessionStore。 */
  persistent: boolean;
}

/** Runtime supplies request facts; Agent owns semantic context assembly. */
export interface AgentContext {
  readonly session: SessionDecl;
  readonly history: readonly SessionEntry[];
  /** 当前输入运行标识；旧 Event 路径不提供此字段。 */
  readonly runId?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly measureRequest?: (request: ProviderRequest) => number;
  readonly requestBytes?: number;
  readonly reserveBytes?: number;
}

export interface AgentContinuation {
  input: Event | UserInput;
  response: ProviderResponse;
  outcomes: readonly ToolOutcome[];
  history: readonly SessionEntry[];
}

export interface Agent {
  readonly id: string;
  declareSession(): SessionDecl;
  initialRequest(event: Event, context: AgentContext): Promise<ProviderRequest>;
  /** 通用输入入口；输入已写入 context.history，无需再次拼接同一条文本。 */
  initialInputRequest?(input: UserInput, context: AgentContext): Promise<ProviderRequest>;
  /** undefined 结束旧 Event 续轮；通用输入在工具续轮返回 undefined 时按缺少最终回复失败。 */
  nextRequest(input: AgentContinuation, context: AgentContext): Promise<ProviderRequest | undefined>;
}

/** 追加式事实记录；runId 用于隔离上下文分组，旧 Event 和尚未出队的输入可缺省。 */
export type SessionEntry = ({ runId?: string } & (
  | { kind: 'input'; at: string; input: UserInput; queueSequence: number }
  | { kind: 'run_started'; at: string; inputId: string }
  | { kind: 'run_finished'; at: string; inputId: string; result: RunResult }
  | { kind: 'event'; at: string; event: Event }
  | { kind: 'provider_request'; at: string; request: ProviderRequest }
  | { kind: 'provider_response'; at: string; response: ProviderResponse }
  | { kind: 'tool_call'; at: string; call: ToolCall }
  | { kind: 'tool_outcome'; at: string; outcome: ToolOutcome }));

export interface SessionStore {
  /** 保持追加顺序，完成后可由 read 读到；落盘与断电保证由具体存储实现定义。 */
  append(entry: SessionEntry): Promise<void>;
  /** 返回完成追加后的历史；读取失败不可伪装为空历史。 */
  read(): Promise<readonly SessionEntry[]>;
}

/** State storage is separate from the append-only Session transcript. */
export interface StateStore {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
}
