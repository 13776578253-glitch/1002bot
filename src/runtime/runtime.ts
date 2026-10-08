/** Runtime owns lifecycle, source leases and write barriers; one channel executes all Session triggers. */
import type { Agent, Event, Provider, SessionEntry, SessionStore, StateStore, World, InputLimits, HeartbeatOptions, RunResult, WorldEventSink, TriggerChannel } from '../protocol/index.ts';
import { STANDARD_TRIGGER_LIMITS } from '../protocol/index.ts';
import { RuntimeInputChannel } from './input-channel.ts';
import { RuntimeTriggerChannel } from './trigger-channel.ts';

export type RuntimeStatus = 'new' | 'starting' | 'running' | 'stopping' | 'failed' | 'stopped';
/** Composition injects collaborators; Runtime owns their shared lifecycle and source wiring. */
export interface RuntimeOptions {
  agent: Agent;
  provider: Provider;
  world: World;
  session: SessionStore;
  /** State is injected for composition; the trigger execution loop does not read or update it. */
  state: StateStore;
  /** World 清理期限不截断 Session 写入，单位毫秒。 */
  cleanupDeadlineMs?: number;
  /** 三种来源共用的执行/诊断容量；UserInput 专用参数仍按协议限定使用。 */
  inputLimits?: Partial<InputLimits>;
  /** World Event 原始 JSON 的 UTF-8 上限，独立于实际 Provider 请求上限。 */
  eventBytes?: number;
  /** 不提供配置时关闭心跳；source 可注入手动 tick 源。 */
  heartbeat?: HeartbeatOptions;
}
export class Runtime {
  private statusValue: RuntimeStatus = 'new';
  /** 启动与停止均递增；旧来源即使继续回调，也无权投递到下一生命周期。 */
  private generationValue = 0;
  /** World.start 的根信号；活动触发的取消由通道各自的 controller 执行。 */
  private controller?: AbortController;
  private lease?: Lease;
  /** 本实例成功追加的过程事实，不自动加载全部历史，也不充当模型上下文。 */
  private readonly entries: SessionEntry[] = [];
  /** 并发或监听器重入时复用同一次生命周期操作。 */
  private startOperation: Promise<void> | undefined;
  private stopOperation: Promise<void> | undefined;
  /** 跟踪已进入的追加；停止不能因 World 清理超时提前放过 Session 写入。 */
  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly options: RuntimeOptions;
  private readonly subscriptions: (() => void)[] = [];
  private heartbeatSequence = 0;
  private readonly channel: RuntimeTriggerChannel;
  get triggers(): TriggerChannel { return this.channel; }
  readonly inputs: RuntimeInputChannel;

  constructor(options: RuntimeOptions) {
    this.options = options;
    const heartbeat = options.heartbeat;
    for (const [name, value] of Object.entries({ intervalMs: heartbeat?.intervalMs ?? STANDARD_TRIGGER_LIMITS.heartbeatIntervalMs, validityMs: heartbeat?.validityMs ?? STANDARD_TRIGGER_LIMITS.heartbeatValidityMs })) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error(`Invalid heartbeat ${name}`);
    }
    this.channel = new RuntimeTriggerChannel({ ...options, append: (entry) => this.appendLifecycle(entry),
      status: () => this.status, generation: () => this.generation, stop: () => this.stop() }, options.inputLimits, options.eventBytes);
    this.inputs = new RuntimeInputChannel(this.channel);
  }
  get status(): RuntimeStatus { return this.statusValue; }
  get generation(): number { return this.generationValue; }
  get trace(): readonly SessionEntry[] { return this.entries; }

  /** 完成表示 World 已启动且来源已装配；单次触发结束不改变该生命周期。 */
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
        // 同步订阅可能立即投递，先开放受理；状态监听器也可能在此重入 stop。
        this.statusValue = 'running';
        this.channel.opened();
        if (!this.isActive(generation, lease)) throw new Error('Runtime start was cancelled');
        this.connectSources(generation, lease);
        if (!this.isActive(generation, lease)) throw new Error('Runtime start was cancelled');
      } catch (error) {
        if (generation === this.generationValue) { this.statusValue = 'failed'; await this.stop(); }
        throw error;
      } finally { if (this.startOperation === operation) this.startOperation = undefined; }
    });
    // 共享 Promise 先于 starting 通知可见，监听器重入 start 不重复装配。
    this.startOperation = operation;
    this.channel.statusChanged();
    return operation;
  }
  async stop(): Promise<void> {
    if (this.statusValue === 'new') { this.statusValue = 'stopped'; this.channel.statusChanged(); return; }
    if (this.statusValue === 'stopped') return;
    if (this.statusValue === 'stopping' && this.stopOperation) return this.stopOperation;
    // 在等待退订或清理之前同步失效旧来源，并关闭新的受理。
    this.statusValue = 'stopping';
    ++this.generationValue;
    this.lease?.close();
    this.controller?.abort();
    this.channel.closeAdmission();
    const operation = Promise.resolve().then(async () => {
      try {
        const failures: unknown[] = [];
        // 一项退订失败仍继续退订其他来源，并等待通道、清理和已进入的写入。
        for (const off of this.subscriptions.splice(0)) { try { off(); } catch (error) { failures.push(error); } }
        const results = await Promise.allSettled([this.cleanupWorld(), triggersStopped, ...this.pendingWrites]);
        failures.push(...results.filter((result) => result.status === 'rejected').map((result) => result.reason as unknown));
        if (failures.length) throw new AggregateError(failures, 'Runtime stop could not finish cleanup and Session writes');
      } finally { this.statusValue = 'stopped'; this.channel.statusChanged(); this.stopOperation = undefined; }
    });
    // 保存共享停止操作，再通知可能重入的监听器。
    this.stopOperation = operation;
    this.channel.statusChanged();
    const triggersStopped = this.channel.shutdown();
    return operation;
  }
  /** 受理拒绝抛稳定错误；已受理处理返回自己的终态，失败与取消不会冒充成功。 */
  handleEvent(event: Event): Promise<RunResult> { return this.channel.submitAndWait({ kind: 'world_event', event }); }

  /** Sources hold lifecycle-bound delivery callbacks; only the channel owns execution. */
  private connectSources(generation: number, lease: Lease): void {
    const sink: WorldEventSink = (event, options) => {
      if (!this.isActive(generation, lease)) return Promise.resolve({ status: 'rejected', triggerKind: 'world_event', triggerId: event.id, code: 'stale_generation', message: 'World sink no longer owns this lifecycle' });
      return this.channel.submit({ kind: 'world_event', event, ...options });
    };
    const retain = (off: () => void): void => {
      // 订阅装配期间的同步回调也可能 stop；迟到返回的退订函数必须立即执行。
      if (this.isActive(generation, lease)) this.subscriptions.push(off); else off();
    };
    if (this.options.world.subscribeEvents) retain(this.options.world.subscribeEvents(sink));
    if (!this.options.heartbeat || !this.isActive(generation, lease)) return;
    const options = this.options.heartbeat;
    const tick = (): void => {
      if (!this.isActive(generation, lease)) return;
      const at = Date.now();
      this.channel.tick({ kind: 'heartbeat', id: `${generation}:${++this.heartbeatSequence}`, source: 'runtime',
        occurredAt: new Date(at).toISOString(), expiresAt: new Date(at + (options.validityMs ?? STANDARD_TRIGGER_LIMITS.heartbeatValidityMs)).toISOString() });
    };
    // 自定义源决定 tick 时机，intervalMs 只用于默认计时器。
    if (options.source) retain(options.source.subscribe(tick));
    else { const timer = setInterval(tick, options.intervalMs ?? STANDARD_TRIGGER_LIMITS.heartbeatIntervalMs); retain(() => clearInterval(timer)); }
  }
  /** 停止等待已进入的写入；收束记录允许在 stopping 期间追加。 */
  private async appendLifecycle(entry: SessionEntry): Promise<void> {
    if (this.statusValue !== 'running' && this.statusValue !== 'stopping') throw new Error('Runtime no longer permits Session writes');
    const write = this.options.session.append(entry);
    this.pendingWrites.add(write);
    try { await write; }
    catch (error) { this.channel.closeAdmission(); throw error; }
    finally { this.pendingWrites.delete(write); }
    // 已确认的停止期事实仍进入 trace；执行是否继续由通道的取消边界判断。
    this.entries.push(entry);
  }
  private isActive(generation: number, lease: Lease): boolean { return this.statusValue === 'running' && generation === this.generationValue && lease.active; }
  private async cleanupWorld(): Promise<void> { await withDeadline((signal) => this.options.world.stop(signal), this.options.cleanupDeadlineMs ?? 100); }
}
class Lease {
  active = true;
  readonly generation: number;
  constructor(generation: number) { this.generation = generation; }
  close(): void { this.active = false; }
}
/** 清理超时只结束等待并请求取消，不能证明底层动作已经退出。 */
async function withDeadline(task: (signal: AbortSignal) => Promise<void>, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(() => task(controller.signal)), new Promise<void>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(); }, timeoutMs);
    })]).catch(() => undefined);
  } finally { if (timer) clearTimeout(timer); }
}
