/** Agent owns instructions and context selection; complete runs and opaque Provider items stay intact. */
import type { Agent, AgentContext, AgentContinuation, Event, HeartbeatRequest, ModelMessage, ProviderRequest, SessionEntry, UserInput } from '../protocol/index.ts';
import { InputError, STANDARD_INPUT_LIMITS } from '../protocol/index.ts';

export class ConversationAgent implements Agent {
  readonly id = 'conversation';
  private readonly sessionId: string;
  private readonly instructions: string;
  readonly initialHeartbeatRequest: HeartbeatRequest;
  constructor(options: { sessionId: string; instructions?: string; heartbeatRequest?: HeartbeatRequest }) {
    this.sessionId = options.sessionId;
    this.instructions = options.instructions ?? 'Respond to the user. Use the available tools when needed. Report tool failures accurately.';
    // 没有周期任务策略时，心跳正常无动作结束；装配方可提供语义策略。
    this.initialHeartbeatRequest = options.heartbeatRequest ?? (async () => undefined);
  }
  declareSession() { return { sessionId: this.sessionId, maxTurns: STANDARD_INPUT_LIMITS.providerCalls, persistent: true }; }
  /** Compatibility fallback serves direct callers without runId; Runtime uses grouped execution facts. */
  async initialRequest(event: Event, context: AgentContext): Promise<ProviderRequest> {
    return this.build(context, context.runId ? [] : [{ role: 'user', content: JSON.stringify(event) }]);
  }
  /** 当前输入已在历史中；再次拼接参数会重复发送用户文本。 */
  async initialInputRequest(_input: UserInput, context: AgentContext): Promise<ProviderRequest> { return this.build(context); }
  async nextRequest(input: AgentContinuation, context: AgentContext): Promise<ProviderRequest> {
    let eventIndex = input.history.length - 1;
    while (eventIndex >= 0 && input.history[eventIndex]!.kind !== 'event') --eventIndex;
    return this.build({ ...context, history: input.history }, !context.runId && 'payload' in input.input && eventIndex >= 0 ? transcript(input.history.slice(eventIndex)) : []);
  }

  private build(context: AgentContext, fallback: ModelMessage[] = []): ProviderRequest {
    if (!context.measureRequest || !context.requestBytes) throw new InputError('request_measurement', 'Provider request measurement is required');
    // 以整轮为裁剪单位，防止截掉工具调用或回执中的一半。
    const groups = new Map<string, SessionEntry[]>();
    for (const entry of context.history) {
      // 无运行分组的旧记录不能作为完整历史轮次自动重放。
      if (!entry.runId) continue;
      const group = groups.get(entry.runId) ?? [];
      group.push(entry);
      groups.set(entry.runId, group);
    }
    const completed: ModelMessage[][] = [];
    let active = fallback;
    for (const [id, entries] of groups) {
      // 当前轮完整保留；旧轮只有成功结束且调用配对完整时才进入上下文。
      if (id === context.runId) active = transcript(entries);
      else if (entries.some((entry) => entry.kind === 'run_finished' && entry.result.status === 'succeeded') && paired(entries)) completed.push(transcript(entries));
    }
    const request = (): ProviderRequest => ({
      sessionId: context.session.sessionId,
      messages: [{ role: 'system', content: this.instructions }, ...completed.flat(), ...active],
      tools: context.tools ?? [],
    });
    // reserve 是旧历史的软目标；无旧轮可删时，当前轮仍可占用完整硬上限。
    const target = Math.max(0, context.requestBytes - (context.reserveBytes ?? 0));
    while (completed.length && context.measureRequest(request()) > target) completed.shift();
    const result = request();
    const size = context.measureRequest(result);
    if (size > context.requestBytes) throw new InputError('context_limit', `Request needs ${size} bytes; allowed ${context.requestBytes}`);
    return result;
  }
}

/** 每个模型声明的调用标识须唯一，且恰有一条对应回执。 */
function paired(entries: readonly SessionEntry[]): boolean {
  const calls = entries.flatMap((entry) => entry.kind === 'provider_response' ? entry.response.toolCalls.map((call) => call.callId) : []);
  const outcomes = entries.flatMap((entry) => entry.kind === 'tool_outcome' ? [entry.outcome.callId] : []);
  return new Set(calls).size === calls.length && calls.every((id) => outcomes.filter((outcome) => outcome === id).length === 1);
}
/** 从事实重建对话；请求记录不再次展开，避免重复重放其携带的历史。 */
function transcript(entries: readonly SessionEntry[]): ModelMessage[] {
  return entries.flatMap((entry): ModelMessage[] => {
    if (entry.kind === 'event') return [{ role: 'user', content: JSON.stringify(entry.event) }];
    if (entry.kind === 'input') return [{ role: 'user', content: entry.input.content.text }];
    if (entry.kind === 'heartbeat') return [{ role: 'user', content: JSON.stringify(entry.heartbeat) }];
    // 原生 Provider 项随所属 assistant 轮次保留，适配器负责解释和重放。
    if (entry.kind === 'provider_response') return [{
      role: 'assistant', content: entry.response.message?.content ?? '', toolCalls: entry.response.toolCalls,
      ...(entry.response.providerData ? { providerData: entry.response.providerData } : {}),
    }];
    if (entry.kind === 'tool_outcome') return [{ role: 'tool', toolCallId: entry.outcome.callId, content: JSON.stringify(entry.outcome) }];
    return [];
  });
}
