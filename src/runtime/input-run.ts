/** Executes one admitted input; queue ownership and terminal result persistence stay with the channel. */
import type { Agent, AgentContext, InputLimits, Provider, ProviderResponse, RunProgress, RunResult, SessionEntry, SessionStore, ToolCall, ToolOutcome, UserInput, World } from '../protocol/index.ts';
import { InputError } from '../protocol/index.ts';

export interface InputRunHost {
  agent: Agent;
  provider: Provider;
  world: World;
  session: SessionStore;
  /** 由 Runtime 跟踪的写入入口；停止时仍等待已进入的写入与收束记录。 */
  append(entry: SessionEntry): Promise<void>;
}
export interface InputRun {
  input: UserInput;
  runId: string;
  queueSequence: number;
  generation: number;
  signal: AbortSignal;
  limits: InputLimits;
  /** 发布执行诊断；最终结果由输入通道单独提交。 */
  progress(event: RunProgress): void;
}

/** halt 独立于 result：即使存储错误覆盖最终原因，效果不明仍要求停止后续输入。 */
export async function executeInput(host: InputRunHost, run: InputRun): Promise<{ result: RunResult; halt: boolean }> {
  const history: SessionEntry[] = [];
  /** 已声明但尚未提交执行结果的调用，用于中断时补齐回执。 */
  let pending: ToolCall[] = [];
  /** 仅在即将进入 World 时设置；用于区分效果不明与尚未执行。 */
  let executing: string | undefined;
  let halt = false;
  let round = 0;
  const append = async (entry: SessionEntry): Promise<void> => {
    // 写入前后都检查取消，避免已失效的输入在等待存储后继续调用外部服务。
    check(run.signal);
    const record = { ...entry, runId: run.runId };
    try { await host.append(record); } catch (error) { throw new InputError('storage_error', message(error)); }
    history.push(record);
    check(run.signal);
  };
  const context = (): AgentContext => ({
    session: host.agent.declareSession(), history, runId: run.runId, tools: host.world.tools(),
    measureRequest: (request) => host.provider.measureRequest!(request),
    requestBytes: run.limits.requestBytes, reserveBytes: run.limits.reserveBytes,
  });
  const commitOutcome = async (call: ToolCall, outcome: ToolOutcome): Promise<void> => {
    if (outcome.status === 'unknown') halt = true;
    // 先决定停止并发布执行结果；Session 写入失败也不能丢失 unknown 的收束要求。
    run.progress({ type: 'tool_finished', round, callId: call.callId, toolName: call.toolName, status: outcome.status,
      ...(outcome.error ? { error: publicError(outcome.error) } : {}) });
    const record: SessionEntry = { kind: 'tool_outcome', runId: run.runId, at: now(), outcome };
    try { await host.append(record); } catch (error) { throw new InputError('storage_error', message(error)); }
    history.push(record);
  };
  try {
    history.push(...await guarded(() => host.session.read(), run.signal));
    if (!host.provider.measureRequest) throw new InputError('request_measurement', 'Provider request measurement is required');
    if (!host.agent.initialInputRequest) throw new InputError('input_unsupported', 'Agent does not support user input');
    await append({ kind: 'input', at: now(), input: run.input, queueSequence: run.queueSequence });
    await append({ kind: 'run_started', at: now(), inputId: run.input.inputId });
    let request = await guarded(() => host.agent.initialInputRequest!(run.input, context()), run.signal);
    for (let turn = 0; turn < run.limits.providerCalls; turn++) {
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
        }, run.signal, run.limits.providerMs, 'provider_timeout');
        const responseBytes = response.bodyBytes ?? bytes(response);
        if (!Number.isSafeInteger(responseBytes) || responseBytes < 0 || responseBytes > run.limits.responseBytes) throw new InputError('response_limit', `Provider response exceeds ${run.limits.responseBytes} bytes`);
      } catch (error) {
        const cause = run.signal.aborted ? run.signal.reason as unknown : error;
        run.progress({ type: 'provider_finished', round, status: cancellation(cause) ? 'cancelled' : 'error', error: diagnostic(cause) });
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
        if (!reply?.trim()) throw new InputError('empty_response', 'Provider returned no final text');
        return { result: { status: 'succeeded', reply, persisted: false }, halt: false };
      }
      pending = [...response.toolCalls];
      const outcomes: ToolOutcome[] = [];
      for (const call of response.toolCalls) {
        await append({ kind: 'tool_call', at: now(), call });
        const normalized = normalize(call, host.world);
        let outcome: ToolOutcome;
        if ('status' in normalized) outcome = normalized;
        else {
          try {
            outcome = await bounded((signal) => {
              check(signal);
              run.progress({ type: 'tool_started', round, callId: call.callId, toolName: call.toolName });
              check(signal);
              executing = call.callId;
              return host.world.executeTool(normalized, { signal, generation: run.generation });
            }, run.signal, run.limits.toolMs, 'tool_timeout');
          } catch (error) {
            if (run.signal.aborted || error instanceof InputError && error.code === 'tool_timeout') { halt = executing === call.callId; throw error; }
            // 已进入 World 后抛异常，无法据此证明副作用未发生。
            outcome = { callId: call.callId, toolName: call.toolName, status: 'unknown', error: { code: 'world_error', message: message(error) } };
          }
          if (outcome.callId !== call.callId || outcome.toolName !== call.toolName) { halt = true; throw new InputError('invalid_tool_outcome', 'World returned a mismatched tool outcome'); }
          executing = undefined;
        }
        if (outcome.status === 'unknown' && !outcome.error) outcome = { ...outcome, error: { code: 'tool_unknown', message: 'World returned an unconfirmed tool result' } };
        // 先移出待收束集合；写入期间收到取消也不能把已取得的回执重新归为 unknown。
        pending = pending.filter((item) => item.callId !== call.callId);
        await commitOutcome(call, outcome);
        outcomes.push(outcome);
        if (outcome.status === 'unknown') throw new InputError('tool_unknown', `Tool ${call.callId} has an unknown result: ${outcome.error!.code}: ${outcome.error!.message}`);
        check(run.signal);
      }
      if (turn + 1 >= run.limits.providerCalls) throw new InputError('round_limit', 'Provider request limit reached');
      const next = await guarded(() => host.agent.nextRequest({
        input: run.input,
        response, outcomes, history,
      }, context()), run.signal);
      if (!next) throw new InputError('empty_response', 'Agent ended without a final response');
      request = next;
    }
    throw new InputError('round_limit', 'Provider request limit reached');
  } catch (error) {
    const cause = run.signal.aborted ? run.signal.reason as unknown : error;
    let storageError: unknown;
    // 收束写入不受输入取消信号阻断；一条回执写入失败仍继续收束其余已声明调用。
    for (const call of pending) {
      const outcome: ToolOutcome = { callId: call.callId, toolName: call.toolName, status: call.callId === executing ? 'unknown' : 'cancelled',
        error: call.callId === executing ? diagnostic(cause) : { code: 'not_executed', message: `Input ended before execution: ${diagnostic(cause).code}` } };
      try { await commitOutcome(call, outcome); }
      catch (writeError) { storageError ??= writeError; }
    }
    const finalCause = storageError ?? cause;
    const detail = diagnostic(finalCause);
    return { result: { status: cancellation(finalCause) ? 'cancelled' : 'failed', ...detail, persisted: false }, halt };
  }
}

/** 进入 World 之前可确定的参数或工具名错误，返回 failed，不产生外部效果。 */
function normalize(call: ToolCall, world: World): ToolCall | ToolOutcome {
  try {
    const argumentsValue: unknown = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
    if (typeof argumentsValue !== 'object' || argumentsValue === null || Array.isArray(argumentsValue)) throw new Error('Arguments must be an object');
    if (!world.tools().some((tool) => tool.name === call.toolName)) return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'unknown_tool', message: `Unknown tool: ${call.toolName}` } };
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
/** 子信号合并整轮取消和单次期限，调用结束后释放计时器与根信号监听器。 */
async function bounded<T>(task: (signal: AbortSignal) => Promise<T>, root: AbortSignal, ms: number, code: string): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(root.reason);
  root.addEventListener('abort', abort, { once: true });
  if (root.aborted) abort();
  const timer = setTimeout(() => controller.abort(new InputError(code, `${code} after ${ms} ms`)), ms);
  try { return await guarded(() => task(controller.signal), controller.signal); }
  finally { clearTimeout(timer); root.removeEventListener('abort', abort); }
}
function check(signal: AbortSignal): void { if (signal.aborted) throw signal.reason; }
function publicError(error: { code: string; message: string }): { code: string; message: string } { return { code: error.code, message: error.message }; }
function diagnostic(error: unknown): { code: string; message: string } { return { code: error instanceof InputError ? error.code : 'execution_error', message: message(error) }; }
function cancellation(error: unknown): boolean { return error instanceof InputError && (error.code === 'cancelled' || error.code === 'runtime_stopped'); }
export function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function now(): string { return new Date().toISOString(); }
