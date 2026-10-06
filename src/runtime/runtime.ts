/** Runtime owns lifecycle and write barriers; Agent, World and Provider retain their semantic boundaries. */
import type {
  Agent,
  AgentContext,
  Event,
  JsonObject,
  Provider,
  ProviderResponse,
  SessionEntry,
  SessionStore,
  StateStore,
  ToolCall,
  ToolOutcome,
  World,
  InputLimits,
} from '../protocol/index.ts';
import { RuntimeInputChannel } from './input-channel.ts';

/** 生命周期状态；stopping 期间仍允许输入收束写入。 */
export type RuntimeStatus = 'new' | 'starting' | 'running' | 'stopping' | 'failed' | 'stopped';

export interface RuntimeOptions {
  agent: Agent;
  provider: Provider;
  world: World;
  session: SessionStore;
  state: StateStore;
  /** World 清理期限，单位毫秒，默认 100；不用于截断 Session 写入。 */
  cleanupDeadlineMs?: number;
  inputLimits?: Partial<InputLimits>;
}

export class Runtime {
  private statusValue: RuntimeStatus = 'new';
  /** 启动与停止都递增，使旧异步任务即便忽略 abort 也无法重新提交执行结果。 */
  private generationValue = 0;
  private controller?: AbortController;
  private lease?: Lease;
  private readonly entries: SessionEntry[] = [];
  private startOperation: Promise<void> | undefined;
  private stopOperation: Promise<void> | undefined;
  /** 停止必须等到已进入的追加完成，避免旧写入穿过下一次启动。 */
  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly options: RuntimeOptions;
  /** 兼容 Event 执行期间拒绝通用输入，避免两条路径共享同一执行窗口。 */
  private legacyRuns = 0;
  readonly inputs: RuntimeInputChannel;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.inputs = new RuntimeInputChannel({
      ...options, append: (entry) => this.appendLifecycle(entry),
      status: () => this.status, generation: () => this.generation,
      legacyBusy: () => this.legacyRuns > 0, stop: () => this.stop(),
    }, options.inputLimits);
  }

  get status(): RuntimeStatus { return this.statusValue; }
  get generation(): number { return this.generationValue; }
  get trace(): readonly SessionEntry[] { return this.entries; }

  async start(): Promise<void> {
    if (this.statusValue === 'running') return;
    if (this.statusValue === 'starting' && this.startOperation) return this.startOperation;
    if (this.statusValue === 'stopping') throw new Error('Runtime is stopping');

    this.statusValue = 'starting';
    const generation = ++this.generationValue;
    const controller = new AbortController();
    const lease = new Lease(generation);
    this.controller = controller;
    this.lease = lease;
    const operation = Promise.resolve().then(async () => {
      try {
        if (controller.signal.aborted || !lease.active) throw new Error('Runtime start was cancelled');
        await this.options.world.start(controller.signal);
        if (controller.signal.aborted || !lease.active || generation !== this.generationValue) throw new Error('Runtime start was cancelled');
        this.statusValue = 'running';
        this.inputs.opened();
      } catch (error) {
        if (generation === this.generationValue) {
          this.statusValue = 'failed';
          await this.stop();
        }
        throw error;
      } finally {
        if (this.startOperation === operation) this.startOperation = undefined;
      }
    });
    // 先保存共享操作，再通知监听器；回调重入 start 时复用同一启动过程。
    this.startOperation = operation;
    this.inputs.statusChanged();
    return operation;
  }

  async stop(): Promise<void> {
    if (this.statusValue === 'new') {
      this.statusValue = 'stopped';
      this.inputs.statusChanged();
      return;
    }
    if (this.statusValue === 'stopped') return;
    if (this.statusValue === 'stopping' && this.stopOperation) return this.stopOperation;

    this.statusValue = 'stopping';
    // 同步失效代次和租约，再等待清理；迟到的启动完成不能恢复 running。
    ++this.generationValue;
    this.lease?.close();
    this.controller?.abort();
    const operation = Promise.resolve().then(async () => {
      try {
        // 各清理任务都要收束；其中一项失败不能提前放过其余 Session 写入。
        const results = await Promise.allSettled([this.cleanupWorld(), inputsStopped, ...this.pendingWrites]);
        const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason as unknown);
        if (failures.length) throw new AggregateError(failures, 'Runtime stop could not finish Session writes');
      } finally {
        this.statusValue = 'stopped';
        this.inputs.statusChanged();
        this.stopOperation = undefined;
      }
    });
    // 状态通知可能重入 stop；共享停止操作必须先可见。
    this.stopOperation = operation;
    this.inputs.statusChanged();
    const inputsStopped = this.inputs.shutdown();
    return operation;
  }

  /** Legacy Event execution remains separate from FIFO user-input admission and per-input finalization. */
  async handleEvent(event: Event): Promise<void> {
    if (this.inputs.busy) throw new Error('User input is running');
    ++this.legacyRuns;
    try { await this.processEvent(event); } finally { --this.legacyRuns; }
  }

  private async processEvent(event: Event): Promise<void> {
    // 异步边界之后重新检查同一代次、租约和信号，不接纳旧任务的迟到结果。
    const lease = this.lease;
    const controller = this.controller;
    const generation = this.generationValue;
    if (this.statusValue !== 'running' || !lease || !controller) throw new Error('Runtime is not running');
    if (!this.isActive(generation, lease, controller.signal)) return;

    const session = this.options.agent.declareSession();
    const history = await this.options.session.read();
    if (!this.isActive(generation, lease, controller.signal)) return;
    if (this.entries.length === 0) this.entries.push(...history);
    await this.append({ kind: 'event', at: now(), event }, generation, lease, controller.signal);
    if (!this.isActive(generation, lease, controller.signal)) return;

    const context: AgentContext = {
      session, history: this.entriesSnapshot(history), tools: this.options.world.tools(),
      ...(this.options.provider.measureRequest ? { measureRequest: (request) => this.options.provider.measureRequest!(request) } : {}),
      requestBytes: this.inputs.limits.requestBytes, reserveBytes: this.inputs.limits.reserveBytes,
    };
    let request = await this.options.agent.initialRequest(event, context);
    for (let turn = 0; turn < session.maxTurns; turn += 1) {
      if (!this.isActive(generation, lease, controller.signal)) return;
      await this.append({ kind: 'provider_request', at: now(), request }, generation, lease, controller.signal);
      if (!this.isActive(generation, lease, controller.signal)) return;
      let response: ProviderResponse;
      try {
        response = await this.options.provider.complete(request, controller.signal);
      } catch (error) {
        if (!this.isActive(generation, lease, controller.signal)) return;
        response = {
          toolCalls: [],
          finishReason: 'error',
          error: { code: 'provider_error', message: error instanceof Error ? error.message : String(error) },
        };
      }
      if (!this.isActive(generation, lease, controller.signal)) return;
      await this.append({ kind: 'provider_response', at: now(), response }, generation, lease, controller.signal);
      if (!this.isActive(generation, lease, controller.signal)) return;
      if (response.toolCalls.length === 0) return;

      const outcomes: ToolOutcome[] = [];
      for (const call of response.toolCalls) {
        if (!this.isActive(generation, lease, controller.signal)) return;
        await this.append({ kind: 'tool_call', at: now(), call }, generation, lease, controller.signal);
        if (!this.isActive(generation, lease, controller.signal)) return;
        const outcome = await this.dispatch(call, generation, lease, controller.signal);
        if (!this.isActive(generation, lease, controller.signal)) return;
        outcomes.push(outcome);
        await this.append({ kind: 'tool_outcome', at: now(), outcome }, generation, lease, controller.signal);
        if (!this.isActive(generation, lease, controller.signal)) return;
      }
      const next = await this.options.agent.nextRequest({ input: event, response, outcomes, history: this.entriesSnapshot(this.entries) }, context);
      if (!next) return;
      request = next;
    }
  }

  private async dispatch(call: ToolCall, generation: number, lease: Lease, signal: AbortSignal): Promise<ToolOutcome> {
    const parsed = parseArguments(call.arguments);
    if (!parsed.ok) return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'invalid_arguments', message: parsed.message } };
    if (!this.options.world.tools().some((tool) => tool.name === call.toolName)) {
      return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'unknown_tool', message: `Unknown tool: ${call.toolName}` } };
    }
    const normalized: ToolCall = { ...call, arguments: parsed.value };
    if (!this.isActive(generation, lease, signal)) return { callId: call.callId, toolName: call.toolName, status: 'cancelled' };
    try {
      return await this.options.world.executeTool(normalized, { signal, generation });
    } catch (error) {
      if (signal.aborted || !lease.active) return { callId: call.callId, toolName: call.toolName, status: 'cancelled' };
      return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'world_error', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  private async append(entry: SessionEntry, generation: number, lease: Lease, signal: AbortSignal): Promise<void> {
    if (!this.isActive(generation, lease, signal)) return;
    const write = this.options.session.append(entry);
    this.pendingWrites.add(write);
    try { await write; } finally { this.pendingWrites.delete(write); }
    // 已进入的存储追加仍须等待，但失效执行不能再将其加入活动 trace。
    if (generation === this.generationValue && lease.active && !signal.aborted) this.entries.push(entry);
  }

  /** 通用输入的回执和终态记录允许在 stopping 期间收束，不受旧代次租约阻断。 */
  private async appendLifecycle(entry: SessionEntry): Promise<void> {
    if (this.statusValue !== 'running' && this.statusValue !== 'stopping') throw new Error('Runtime no longer permits Session writes');
    const write = this.options.session.append(entry);
    this.pendingWrites.add(write);
    try { await write; } finally { this.pendingWrites.delete(write); }
    this.entries.push(entry);
  }

  private isActive(generation: number, lease: Lease, signal: AbortSignal): boolean {
    return this.statusValue === 'running' && generation === this.generationValue && lease.active && !signal.aborted;
  }

  private async cleanupWorld(): Promise<void> {
    const deadline = this.options.cleanupDeadlineMs ?? 100;
    await withDeadline((signal) => this.options.world.stop(signal), deadline);
  }

  private entriesSnapshot(entries: readonly SessionEntry[]): readonly SessionEntry[] { return [...entries]; }
}

class Lease {
  active = true;
  readonly generation: number;
  constructor(generation: number) { this.generation = generation; }
  close(): void { this.active = false; }
}

/** World 清理采用尽力而为的期限；超时发出 abort 后返回，不保证底层任务已退出。 */
async function withDeadline(task: (signal: AbortSignal) => Promise<void>, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, timeoutMs); }),
    ]).catch(() => undefined);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseArguments(argumentsValue: string | JsonObject): { ok: true; value: JsonObject } | { ok: false; message: string } {
  if (typeof argumentsValue !== 'string') return { ok: true, value: argumentsValue };
  try {
    const value: unknown = JSON.parse(argumentsValue);
    if (!isObject(value)) return { ok: false, message: 'Tool arguments must be a JSON object' };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Invalid JSON arguments' };
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function now(): string { return new Date().toISOString(); }
