/** Executes one admitted trigger; queue ownership and terminal persistence stay with the channel. */
import type { Agent, AgentContext, InputLimits, Provider, ProviderResponse, RunProgress, RunResult, SessionEntry, SessionStore, ToolCall, ToolOutcome, RuntimeTrigger, World } from '../protocol/index.ts';
import { InputError, triggerId, triggerSource } from '../protocol/index.ts';
import type { HistoryReader } from '../protocol/index.ts';
import type { TaskRunPort } from '../protocol/index.ts';
import type { TaskCoordinator } from './task-coordinator.ts';
import { matchesOutcome, toolRegistry } from './tool-registry.ts';
import type { OperationOrigin, RunOrigin, ToolEffects } from '../protocol/index.ts';
import type { OperationRegistry } from './operation-registry.ts';

/** Runtime owns the collaborators and tracked writes used by one trigger execution. */
export interface TriggerRunHost {
  agent: Agent;
  provider: Provider;
  world: World;
  session: SessionStore;
  /** 由 Runtime 跟踪的写入入口；停止时仍等待已进入的写入与收束记录。 */
  append(entry: SessionEntry): Promise<void>;
  readHistory?: () => Promise<readonly SessionEntry[]>;
  queryHistory?: HistoryReader;
  tasks?: TaskCoordinator;
  /** 可选原操作登记；外部等待撤权后继续持有原 Promise 和独立归档权。 */
  operations?: OperationRegistry;
}
export interface TriggerRun {
  trigger: RuntimeTrigger;
  runId: string;
  queueSequence: number;
  generation: number;
  signal: AbortSignal;
  limits: InputLimits;
  /** 发布执行诊断；最终结果由通用通道单独提交。 */
  progress(event: RunProgress): void;
}

/** halt 独立于 result：即使存储错误覆盖最终原因，效果不明仍要求停止后续触发。 */
export async function executeTrigger(host: TriggerRunHost, run: TriggerRun): Promise<{ result: RunResult; halt: boolean }> {
  const history: SessionEntry[] = [];
  /** 已声明但尚未取得执行回执的调用；已有回执在追加前移出，避免重复归类。 */
  let pending: ToolCall[] = [];
  /** 仅在即将进入 World 时设置；用于区分效果不明与尚未执行。 */
  let executing: string | undefined;
  /** 仅启用 M6 且可信声明为 none 时标记只读，供中断收束分类。 */
  let executingEffects: ToolEffects | undefined;
  let halt = false;
  let round = 0;
  const association = { runId: run.runId, triggerKind: run.trigger.kind, triggerId: triggerId(run.trigger), source: triggerSource(run.trigger), generation: run.generation,
    ...(run.trigger.kind === 'world_event' && 'delivery' in run.trigger ? { delivery: run.trigger.delivery } : {}) };
  const origin: RunOrigin = { sessionId: host.agent.declareSession().sessionId, runId: run.runId, generation: run.generation,
    triggerKind: run.trigger.kind, triggerId: triggerId(run.trigger), source: triggerSource(run.trigger) };
  // 本轮授权供 Agent 选择心跳任务，工具调用再派生携带单次期限的子权限。
  const taskLease = host.tasks?.open(association, run.signal);
  let registry!: ReturnType<typeof toolRegistry>;
  const append = async (entry: SessionEntry): Promise<void> => {
    // 写入前后都检查取消，避免已失效的触发在等待存储后继续调用外部服务。
    check(run.signal);
    const record = { ...entry, ...association };
    try { await host.append(record); } catch (error) { throw new InputError('storage_error', message(error)); }
    history.push(record);
    check(run.signal);
  };
  const context = (tasks: TaskRunPort | undefined = taskLease?.port, signal = run.signal): AgentContext => ({
    session: host.agent.declareSession(), history, runId: run.runId, tools: registry.declarations,
    ...(tasks ? { tasks } : {}),
    // 证据查询使用当前调用信号，旧 origin 只用于检索关联。
    ...(host.operations ? { readLate: query => host.operations!.readLate(query, signal) } : {}),
    ...(host.provider.measureRequest ? { measureRequest: (request) => host.provider.measureRequest!(request) } : {}),
    requestBytes: run.limits.requestBytes, reserveBytes: run.limits.reserveBytes,
    ...(host.queryHistory ? { readHistory: host.queryHistory } : {}),
  });
  const commitOutcome = async (call: ToolCall, outcome: ToolOutcome): Promise<void> => {
    if (outcome.status === 'unknown') halt = true;
    // 先决定停止并发布执行结果；Session 写入失败也不能丢失 unknown 的收束要求。
    run.progress({ type: 'tool_finished', round, callId: call.callId, toolName: call.toolName, status: outcome.status,
      ...(outcome.error ? { error: publicError(outcome.error) } : {}) });
    const record: SessionEntry = { kind: 'tool_outcome', ...association, at: now(), outcome, owner: registry?.isAgent(call.toolName) ? 'agent' : 'world' };
    // 工具回执不因取消跳过追加；存储失败与效果分类分别保留。
    try { await host.append(record); } catch (error) { throw new InputError('storage_error', message(error)); }
    history.push(record);
  };
  try {
    // 读取时过滤接收归档，避免 Agent 提前使用尚未出队的原始输入。
    try { history.push(...(await guarded(() => host.readHistory ? host.readHistory() : host.session.read(), run.signal)).filter((entry) => entry.kind !== 'trigger_received' && entry.kind !== 'world_stream_registered')); }
    catch (error) { if (run.signal.aborted) throw error; throw new InputError('storage_error', message(error)); }
    if (run.trigger.kind === 'user_input') await append({ kind: 'input', at: now(), input: run.trigger.input, queueSequence: run.queueSequence });
    else if (run.trigger.kind === 'world_event') await append({ kind: 'event', at: now(), event: run.trigger.event });
    else await append({ kind: 'heartbeat', at: now(), heartbeat: run.trigger });
    await append({ kind: 'run_started', at: now(), inputId: triggerId(run.trigger) });
    // 工具归属固定到本轮结束，Session 调用与回执使用同一 owner。
    registry = toolRegistry(host.agent, host.world);
    // 入口保留来源语义；心跳是否请求模型由 Agent 决定，Runtime 只执行其决定。
    const initial = await guarded(() => {
      const trigger = run.trigger;
      if (trigger.kind === 'heartbeat') return host.agent.initialHeartbeatRequest?.(trigger, context()) ?? Promise.resolve(undefined);
      if (trigger.kind === 'world_event') return host.agent.initialRequest(trigger.event, context());
      if (!host.agent.initialInputRequest) throw new InputError('input_unsupported', 'Agent does not support user input');
      return host.agent.initialInputRequest(trigger.input, context());
    }, run.signal);
    if (!initial) return { result: { status: 'succeeded', persisted: false }, halt: false };
    let request = initial;
    if (!host.provider.measureRequest) throw new InputError('request_measurement', 'Provider request measurement is required');
    const maxCalls = Math.min(run.limits.providerCalls, host.agent.declareSession().maxTurns);
    for (let turn = 0; turn < maxCalls; turn++) {
      check(run.signal);
      const size = host.provider.measureRequest(request);
      if (size > run.limits.requestBytes) throw new InputError('context_limit', `Request needs ${size} bytes; allowed ${run.limits.requestBytes}`);
      await append({ kind: 'provider_request', at: now(), request });
      round = turn + 1;
      run.progress({ type: 'provider_started', round });
      let response: ProviderResponse;
      try {
        response = await bounded(async (signal) => {
          try { return await host.provider.complete(request, signal); }
          catch (error) { if (error instanceof InputError || signal.aborted) throw error; throw new InputError('provider_error', message(error)); }
        }, run.signal, run.limits.providerMs, 'provider_timeout', host.operations, { ...origin, kind: 'provider', round });
        const responseBytes = response.bodyBytes ?? bytes(response);
        if (!Number.isSafeInteger(responseBytes) || responseBytes < 0 || responseBytes > run.limits.responseBytes) throw new InputError('response_limit', `Provider response exceeds ${run.limits.responseBytes} bytes`);
      } catch (error) {
        const cause = run.signal.aborted ? run.signal.reason as unknown : error;
        run.progress({ type: 'provider_finished', round, status: cancellation(cause) ? 'cancelled' : 'error', error: diagnostic(cause) });
        if (!run.signal.aborted) await append({ kind: 'provider_response', at: now(), response: { toolCalls: [], finishReason: 'error', error: diagnostic(cause) } });
        throw error;
      }
      run.progress({ type: 'provider_finished', round, status: response.finishReason, ...(response.error ? { error: publicError(response.error) } : {}) });
      await append({ kind: 'provider_response', at: now(), response });
      if (response.finishReason === 'error' || response.finishReason === 'length') throw new InputError(response.error?.code ?? response.finishReason, response.error?.message ?? 'Provider did not produce a complete response');
      // 整批先校验容量和标识，避免执行部分工具后才发现这一批无效。
      if (response.toolCalls.length > run.limits.toolCalls) throw new InputError('tool_call_limit', `Response declares more than ${run.limits.toolCalls} tools`);
      const ids = response.toolCalls.map((call) => call.callId);
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length || history.some((entry) => entry.runId === run.runId && entry.kind === 'tool_call' && ids.includes(entry.call.callId))) throw new InputError('invalid_tool_calls', 'Tool call IDs must be unique within the run');
      if (!response.toolCalls.length) {
        const reply = response.message?.content;
        // Console 需要回复文本；环境事件与心跳可以正常结束且没有对外表达。
        if (run.trigger.kind === 'user_input' && !reply?.trim()) throw new InputError('empty_response', 'Provider returned no final text');
        return { result: { status: 'succeeded', ...(reply ? { reply } : {}), persisted: false }, halt: false };
      }
      pending = [...response.toolCalls];
      const outcomes: ToolOutcome[] = [];
      for (const call of response.toolCalls) {
        const effects = registry.effects(call.toolName);
        const safeRead = !!host.operations && effects === 'none';
        await append({ kind: 'tool_call', at: now(), call, owner: registry.isAgent(call.toolName) ? 'agent' : 'world',
          ...(host.operations && !registry.isAgent(call.toolName) ? { worldId: host.world.id } : {}), ...(host.operations && effects ? { effects } : {}) });
        const normalized = normalize(call, registry.declarations);
        let outcome: ToolOutcome;
        if ('status' in normalized) outcome = normalized;
        else if (registry.isAgent(call.toolName)) {
          // Agent 工具使用本轮权限；任务提交等待确认，证据查询只读，均不占外部调用登记位。
          run.progress({ type: 'tool_started', round, callId: call.callId, toolName: call.toolName });
          let answer: ToolOutcome | undefined;
          let failure: unknown;
          try { outcome = await bounded(async signal => {
            const operation = registry.executeAgent(normalized, context(taskLease?.forCall(call.callId, signal), signal));
            void operation.then(value => { answer = value; }, error => { failure = error; });
            return operation;
          }, run.signal, run.limits.toolMs, 'tool_timeout'); }
          catch (error) {
            // 子信号撤销迟到提交；必要写入仍须结算，已取得确认回执则保留它。
            await taskLease?.settle();
            if (failure instanceof InputError && failure.code === 'storage_error') throw failure;
            if (answer) outcome = answer;
            else if (error instanceof InputError && error.code === 'storage_error' || run.signal.aborted || error instanceof InputError && error.code === 'tool_timeout') throw error;
            else outcome = { callId: call.callId, toolName: call.toolName, status: 'failed', error: diagnostic(error) };
          } finally { taskLease?.revokeCall(call.callId); }
          if (!matchesOutcome(outcome, call)) throw new InputError('invalid_tool_outcome', 'Agent returned an invalid tool receipt');
        } else {
          try {
            outcome = await bounded((signal) => {
              check(signal);
              run.progress({ type: 'tool_started', round, callId: call.callId, toolName: call.toolName });
              check(signal);
              executing = call.callId;
              executingEffects = safeRead ? 'none' : undefined;
              // 动作门禁一直保留到回执头通过核验，原 Promise 已退出也不能直接解锁。
              host.operations?.setUnsafe(run.runId, !safeRead);
              return host.world.executeTool(normalized, { signal, generation: run.generation,
                ...(host.operations ? { origin: { ...origin, callId: call.callId } } : {}) });
            }, run.signal, run.limits.toolMs, 'tool_timeout', host.operations, { ...origin, kind: 'world', worldId: host.world.id, callId: call.callId, toolName: call.toolName, effects: effects ?? 'unspecified' });
          } catch (error) {
            if (run.signal.aborted || error instanceof InputError && error.code === 'tool_timeout') { halt = executing === call.callId && !safeRead; throw error; }
            if (error instanceof InputError && (error.code === 'storage_error' || executing !== call.callId)) throw error;
            // 已进入 World 后抛异常，无法据此证明副作用未发生。
            outcome = { callId: call.callId, toolName: call.toolName, status: safeRead ? 'failed' : 'unknown', error: { code: 'world_error', message: message(error) } };
          }
          if (!matchesOutcome(outcome, call)) { halt = true; throw new InputError('invalid_tool_outcome', 'World returned an invalid tool receipt'); }
          // 已取得且匹配的回执结束效果不明窗口，后续写入失败不重新执行该工具。
          executing = undefined;
          executingEffects = undefined;
          host.operations?.setUnsafe(run.runId, false);
        }
        if (outcome.status === 'unknown' && !outcome.error) outcome = { ...outcome, error: { code: 'tool_unknown', message: 'World returned an unconfirmed tool result' } };
        // 先移出待收束集合；写入期间收到取消也不能把已取得的回执重新归为 unknown。
        pending = pending.filter((item) => item.callId !== call.callId);
        await commitOutcome(call, outcome);
        outcomes.push(outcome);
        if (outcome.status === 'unknown') throw new InputError('tool_unknown', `Tool ${call.callId} has an unknown result: ${outcome.error!.code}: ${outcome.error!.message}`);
        check(run.signal);
      }
      if (turn + 1 >= maxCalls) throw new InputError('round_limit', 'Provider request limit reached');
      const next = await guarded(() => host.agent.nextRequest({
        input: run.trigger.kind === 'user_input' ? run.trigger.input : run.trigger.kind === 'world_event' ? run.trigger.event : run.trigger,
        response, outcomes, history,
      }, context()), run.signal);
      if (!next) {
        if (run.trigger.kind === 'user_input') throw new InputError('empty_response', 'Agent ended without a final response');
        return { result: { status: 'succeeded', persisted: false }, halt: false };
      }
      request = next;
    }
    throw new InputError('round_limit', 'Provider request limit reached');
  } catch (error) {
    // 已知存储故障保留优先级，停止信号不能把它覆盖为普通取消。
    const cause = error instanceof InputError && error.code === 'storage_error' ? error : run.signal.aborted ? run.signal.reason as unknown : error;
    let storageError: unknown;
    // 收束写入不受输入取消信号阻断；一条回执写入失败仍继续收束其余已声明调用。
    for (const call of pending) {
      const unknown = call.callId === executing && executingEffects !== 'none';
      // 被中断只读调用只交付原引用；实际观察由独立归档和显式查询取得。
      const outcome: ToolOutcome = { callId: call.callId, toolName: call.toolName, status: unknown ? 'unknown' : 'cancelled',
        ...(call.callId === executing && executingEffects === 'none' ? { output: { operation: { ...origin,
          kind: 'world', worldId: host.world.id, callId: call.callId, toolName: call.toolName, effects: 'none' } } } : {}),
        error: unknown ? diagnostic(cause) : call.callId === executing
          ? { code: 'read_interrupted', message: `Read-only wait ended; original call remains independently owned: ${diagnostic(cause).code}` }
          : registry?.isAgent(call.toolName)
          ? { code: 'task_interrupted', message: `Task call interrupted; confirmed commits remain in Session: ${diagnostic(cause).code}` }
          : { code: 'not_executed', message: `Input ended before execution: ${diagnostic(cause).code}` } };
      try { await commitOutcome(call, outcome); }
      catch (writeError) { storageError ??= writeError; }
    }
    const finalCause = storageError ?? cause;
    const detail = diagnostic(finalCause);
    // Provider 等普通失败只结束本项；未知效果或必要存储故障停止共享通道。
    return { result: { status: cancellation(finalCause) ? 'cancelled' : 'failed', ...detail, persisted: false }, halt: halt || detail.code === 'storage_error' };
  } finally {
    // 通道写 run_finished 前撤权并结算任务操作，避免终态越过任务确认。
    await taskLease?.finish();
    host.operations?.finishRun(run.runId);
  }
}

/** 工具分流前可确定的参数或工具名错误，返回 failed，不产生提交或外部效果。 */
function normalize(call: ToolCall, declarations: readonly import('../protocol/index.ts').ToolDefinition[]): ToolCall | ToolOutcome {
  try {
    const argumentsValue: unknown = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
    if (typeof argumentsValue !== 'object' || argumentsValue === null || Array.isArray(argumentsValue)) throw new Error('Arguments must be an object');
    if (!declarations.some((tool) => tool.name === call.toolName)) return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'unknown_tool', message: `Unknown tool: ${call.toolName}` } };
    return { ...call, arguments: argumentsValue as ToolCall['arguments'] };
  } catch (error) { return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'invalid_arguments', message: message(error) } }; }
}
/** 取消后放弃迟到结果；不协作的任务可能仍在运行，外部效果无法由此撤销。 */
export async function guarded<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  check(signal);
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { check(signal); return task(); }),
      new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); }),
    ]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}
/** 子信号合并整轮取消和单次期限；逻辑等待结束释放计时器和监听器，启用 M6 时原外部调用仍由登记器持有。 */
async function bounded<T>(task: (signal: AbortSignal) => Promise<T>, root: AbortSignal, ms: number, code: string,
  operations?: OperationRegistry, origin?: OperationOrigin): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(root.reason);
  root.addEventListener('abort', abort, { once: true });
  if (root.aborted) abort();
  const timer = setTimeout(() => controller.abort(new InputError(code, `${code} after ${ms} ms`)), ms);
  let ticket: ReturnType<OperationRegistry['start']> | undefined;
  try { return await guarded(() => {
    if (!operations) return task(controller.signal);
    ticket = operations.start(origin!, () => { check(controller.signal); return task(controller.signal); });
    return ticket.promise as Promise<T>;
  }, controller.signal); }
  catch (error) {
    if (operations && ticket && controller.signal.aborted) {
      // 已取得 World 回执优先保存；模型回包始终不能在取消后执行新工具。
      const result = operations.result(ticket);
      if (origin?.kind === 'world' && result) return result.value as T;
      // 撤权记录须先确认，普通取消回执与 run_finished 才可随后结清并放行 FIFO。
      await operations.detach(ticket, error);
    }
    throw error;
  }
  finally { clearTimeout(timer); root.removeEventListener('abort', abort); }
}
function check(signal: AbortSignal): void { if (signal.aborted) throw signal.reason; }
function publicError(error: { code: string; message: string }): { code: string; message: string } { return { code: error.code, message: error.message }; }
function diagnostic(error: unknown): { code: string; message: string } { return { code: error instanceof InputError ? error.code : 'execution_error', message: message(error) }; }
function cancellation(error: unknown): boolean { return error instanceof InputError && (error.code === 'cancelled' || error.code === 'runtime_stopped' || error.code === 'yielded'); }
export function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function now(): string { return new Date().toISOString(); }
