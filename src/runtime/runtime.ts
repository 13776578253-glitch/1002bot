/** Runtime owns lifecycle, source and task grants, and confirmed projections; one channel executes all Session triggers. */
import type { Agent, Event, Provider, SessionEntry, SessionStore, StateStore, World, InputLimits, HeartbeatOptions, RunResult, WorldEventSink, TriggerChannel, WorldStream, DeliveryLimits, HistoryLimits, SessionDiagnosis, WorldDeliveryPort, HistoryQuery, TaskLimits, TaskInspector } from '../protocol/index.ts';
import { InputError, STANDARD_TRIGGER_LIMITS, legacyWorldTriggerId } from '../protocol/index.ts';
import { RuntimeInputChannel } from './input-channel.ts';
import { RuntimeTriggerChannel } from './trigger-channel.ts';
import { WorldDeliveryState } from './world-delivery-state.ts';
import { HistoryWindow, queryHistory } from '../state/history-window.ts';
import { preflightSession, diagnoseSession } from './session-preflight.ts';
import { TaskProjection } from '../state/task-projection.ts';
import { TaskCoordinator } from './task-coordinator.ts';

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
  /** 装配认可的稳定来源，空值保留旧裸 Event 兼容路径。 */
  worldStreams?: readonly WorldStream[];
  deliveryLimits?: Partial<DeliveryLimits>;
  historyLimits?: Partial<HistoryLimits>;
  /** 向 Agent 提供配对完整的失败/取消历史候选，效果判断仍由 Agent 承担。 */
  includeUnsuccessfulHistory?: boolean;
  taskLimits?: Partial<TaskLimits>;
  /** 仅任务到期判断使用此时钟；来源接收/过期仍沿用 Runtime 的真实期限。 */
  taskClock?: () => number;
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
  private worldNeedsCleanup = false;
  private readonly channel: RuntimeTriggerChannel;
  private deliveryState: WorldDeliveryState;
  private readonly taskCoordinator: TaskCoordinator;
  private window: HistoryWindow | undefined;
  private readonly historyLimits: HistoryLimits;
  private traceBytes = 0;
  private diagnosisValue: SessionDiagnosis = { status: 'ready', records: 0, issueCount: 0, issues: [], history: { runs: 0, bytes: 0, omittedRuns: 0 } };
  get triggers(): TriggerChannel { return this.channel; }
  readonly inputs: RuntimeInputChannel;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.historyLimits = new HistoryWindow(options.historyLimits).limits;
    this.deliveryState = this.newDeliveryState();
    this.taskCoordinator = new TaskCoordinator({ projection: new TaskProjection(options.agent.declareSession().sessionId, options.taskLimits),
      sessionId: options.agent.declareSession().sessionId, store: options.session, append: entry => this.appendLifecycle(entry),
      alive: generation => this.status === 'running' && this.generation === generation && this.channel.accepting, clock: options.taskClock ?? Date.now });
    if (this.deliveryState.ordered && options.world.subscribeEvents) throw new Error('Ordered World must not also subscribe legacy events');
    if (!this.deliveryState.ordered && options.world.subscribeDeliveries) throw new Error('Ordered subscription requires declared World streams');
    const heartbeat = options.heartbeat;
    for (const [name, value] of Object.entries({ intervalMs: heartbeat?.intervalMs ?? STANDARD_TRIGGER_LIMITS.heartbeatIntervalMs, validityMs: heartbeat?.validityMs ?? STANDARD_TRIGGER_LIMITS.heartbeatValidityMs })) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error(`Invalid heartbeat ${name}`);
    }
    this.channel = new RuntimeTriggerChannel({ ...options, append: (entry) => this.appendLifecycle(entry),
      ...(options.agent.taskTools ? { tasks: this.taskCoordinator } : {}),
      readHistory: async () => this.window ? this.window.snapshot() : options.session.read(),
      ...(options.session.scan ? { queryHistory: (query?: HistoryQuery) => queryHistory(options.session, this.historyLimits, query) } : {}),
      status: () => this.status, generation: () => this.generation, stop: () => this.stop(), issue: (code, message) => this.recordIssue(code, message) }, options.inputLimits, options.eventBytes);
    this.channel.bindDeliveries(this.deliveryState);
    this.inputs = new RuntimeInputChannel(this.channel);
  }
  get status(): RuntimeStatus { return this.statusValue; }
  get generation(): number { return this.generationValue; }
  get trace(): readonly SessionEntry[] { return structuredClone(this.entries); }
  /** 只读检查口；写入权限仅存在于当前 AgentContext。 */
  get tasks(): TaskInspector { return { snapshot: () => this.taskCoordinator.snapshot(), read: id => this.taskCoordinator.read(id), evidence: (id, run, bytes) => this.taskCoordinator.evidence(id, run, bytes) }; }
  get diagnosis(): SessionDiagnosis { return structuredClone({ ...this.diagnosisValue, history: this.window?.stats ?? this.diagnosisValue.history }); }
  inspectSession(): Promise<SessionDiagnosis> {
    return diagnoseSession(this.options.session, { worldId: this.options.world.id, sessionId: this.options.agent.declareSession().sessionId,
      worldStreams: this.options.worldStreams ?? [], deliveryLimits: this.deliveryState.limits, historyLimits: this.historyLimits, admissionIds: this.channel.limits.admissionIds,
      ...(this.options.taskLimits ? { taskLimits: this.options.taskLimits } : {}), requireTasks: !!this.options.agent.taskTools, includeUnsuccessfulHistory: !!this.options.includeUnsuccessfulHistory });
  }
  /** 读取口不拥有生命周期；旧口只能等待原保存，不能向新代投递。 */
  get deliveries(): WorldDeliveryPort {
    const generation = this.generationValue, state = this.deliveryState;
    return {
      submit: (delivery) => generation === this.generationValue ? this.channel.submitDelivery(delivery)
        : Promise.resolve({ status: 'rejected', triggerId: '', code: 'stale_generation', message: 'World delivery port no longer owns this lifecycle' }),
      waitSaved: (identity) => state.waitSaved(identity),
      progress: (streamId) => {
        const accepting = generation === this.generationValue && this.channel.accepting;
        const issue = this.diagnosisValue.status === 'blocked' ? this.diagnosisValue.issues[0] : undefined;
        const blocking = issue ? { code: issue.code, message: issue.message } : !accepting ? { code: generation === this.generationValue ? 'not_running' : 'stale_generation', message: 'World delivery admission is closed' } : undefined;
        return { ...state.progress(streamId, accepting), ...(blocking ? { blocking } : {}) };
      },
    };
  }

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
        await this.prepareSession(controller, lease, generation);
        if (controller.signal.aborted || !lease.active || generation !== this.generationValue) throw new Error('Runtime start was cancelled');
        this.worldNeedsCleanup = true;
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
      if (!this.isActive(generation, lease)) return Promise.resolve({ status: 'rejected', triggerKind: 'world_event', triggerId: legacyWorldTriggerId(event.id), code: 'stale_generation', message: 'World sink no longer owns this lifecycle' });
      return this.channel.submit({ kind: 'world_event', event, ...options });
    };
    const retain = (off: () => void): void => {
      // 订阅装配期间的同步回调也可能 stop；迟到返回的退订函数必须立即执行。
      if (this.isActive(generation, lease)) this.subscriptions.push(off); else off();
    };
    if (this.options.world.subscribeEvents) retain(this.options.world.subscribeEvents(sink));
    if (this.options.world.subscribeDeliveries && this.isActive(generation, lease)) retain(this.options.world.subscribeDeliveries(this.deliveries));
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
    if (this.statusValue !== 'running' && this.statusValue !== 'stopping' && !(this.statusValue === 'starting' && entry.kind === 'world_stream_registered')) throw new Error('Runtime no longer permits Session writes');
    let append: Promise<void>;
    // 同步抛错也进入被跟踪的结算链，保持受理即调用存储的顺序。
    try { append = this.options.session.append(entry); } catch (error) { append = Promise.reject(error); }
    // 保存确认后一起推进来源、任务和历史投影；追加失败不会发布候选变更。
    const write = append.then(() => {
      this.deliveryState.observe(entry);
      this.taskCoordinator.observe(entry);
      this.window?.append(entry);
      this.entries.push(structuredClone(entry));
      this.traceBytes += Buffer.byteLength(JSON.stringify(entry));
      while (this.entries.length > this.historyLimits.traceEntries || this.traceBytes > this.historyLimits.traceBytes) this.traceBytes -= Buffer.byteLength(JSON.stringify(this.entries.shift()!));
    });
    this.pendingWrites.add(write);
    try { await write; }
    catch (error) { this.channel.closeAdmission(); this.recordIssue('storage_error', error instanceof Error ? error.message : String(error)); throw error; }
    finally { this.pendingWrites.delete(write); }
  }
  private newDeliveryState(): WorldDeliveryState { return new WorldDeliveryState(this.options.world.id, this.options.agent.declareSession().sessionId, this.options.worldStreams ?? [], this.options.deliveryLimits); }
  private recordIssue(code: string, detail: string): void {
    this.diagnosisValue.status = 'blocked'; ++this.diagnosisValue.issueCount;
    if (this.diagnosisValue.issues.length < 64) this.diagnosisValue = { ...this.diagnosisValue, issues: [...this.diagnosisValue.issues, { code, message: detail.slice(0, 1024) }] };
  }
  private async prepareSession(controller: AbortController, lease: Lease, generation: number): Promise<void> {
    let inspected;
    try {
      inspected = await preflightSession(this.options.session, { worldId: this.options.world.id, sessionId: this.options.agent.declareSession().sessionId,
        worldStreams: this.options.worldStreams ?? [], deliveryLimits: this.deliveryState.limits, historyLimits: this.historyLimits, admissionIds: this.channel.limits.admissionIds,
        ...(this.options.taskLimits ? { taskLimits: this.options.taskLimits } : {}), requireTasks: !!this.options.agent.taskTools, includeUnsuccessfulHistory: !!this.options.includeUnsuccessfulHistory }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted || !lease.active || generation !== this.generationValue) throw new Error('Runtime start was cancelled');
      throw error;
    }
    if (controller.signal.aborted || !lease.active || generation !== this.generationValue) throw new Error('Runtime start was cancelled');
    // 安装本次扫描的事实视图供诊断使用，审计阻断时仍不开放受理或启动 World。
    const { state, window, tasks, diagnosis } = inspected;
    this.deliveryState = state; this.channel.bindDeliveries(state); this.window = window;
    this.taskCoordinator.replace(tasks);
    this.diagnosisValue = diagnosis;
    if (diagnosis.status === 'blocked') {
      if (diagnosis.issues[0]?.code === 'session_capability') throw new InputError('session_capability', 'This Runtime requires Session.scan for ordered delivery or persistent tasks');
      this.channel.recoveryFailed('recovery_blocked', diagnosis.issues[0]?.message ?? 'Session requires diagnosis'); throw new InputError('recovery_blocked', 'Session requires diagnosis before execution');
    }
    for (const registration of state.registrations()) {
      if (controller.signal.aborted || !lease.active || generation !== this.generationValue) throw new Error('Runtime start was cancelled');
      await this.appendLifecycle(registration);
    }
  }
  private isActive(generation: number, lease: Lease): boolean { return this.statusValue === 'running' && generation === this.generationValue && lease.active; }
  private async cleanupWorld(): Promise<void> {
    if (!this.worldNeedsCleanup) return;
    this.worldNeedsCleanup = false;
    await withDeadline((signal) => this.options.world.stop(signal), this.options.cleanupDeadlineMs ?? 100);
  }
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
