/** Owns one FIFO consumer for all Session triggers; bounded diagnostics do not provide recovery. */
import { randomUUID } from 'node:crypto';
import type { ExternalTrigger, RuntimeTrigger, TriggerKind, TriggerChannel, TriggerReceipt, TriggerSnapshot, HeartbeatTrigger, InputLimits, OutputEvent, RunResult } from '../protocol/index.ts';
import { InputError, STANDARD_INPUT_LIMITS, STANDARD_TRIGGER_LIMITS, triggerId, triggerSource } from '../protocol/index.ts';
import { bytes, executeTrigger, message, type TriggerRunHost } from './trigger-run.ts';
import type { WorldDelivery, WorldReceipt } from '../protocol/index.ts';
import { WorldDeliveryState } from './world-delivery-state.ts';

/** Runtime supplies lifecycle authority and the tracked write boundary to its Session channel. */
interface ChannelHost extends TriggerRunHost { status(): string; generation(): number; stop(): Promise<void>; issue(code: string, message: string): void }
interface Queued {
  /** 受理时保存副本；后续记录和执行沿用同一份来源事实。 */
  trigger: RuntimeTrigger;
  sequence: number;
  /** 排队期间固定，停止收束通知仍关联原代次。 */
  generation: number;
  /** 接收追加确认屏障；取消和过期也等待它，不以取消跳过已进入的写入。 */
  received: Promise<void>;
  /** 最终写入成功或明确失败后结算，独立于快照保留窗口。 */
  done: Promise<RunResult>;
  resolve(result: RunResult): void;
  timer?: ReturnType<typeof setTimeout>;
  /** 同步占用终态提交权，防止过期、取消和停止重复发布结果。 */
  finalized: boolean;
}
interface Active {
  item: Queued;
  id: string;
  controller: AbortController;
  /** 执行结果已确定，只等待终态写入；新的取消不再改写结果。 */
  finishing: boolean;
  round: number
}

export class RuntimeTriggerChannel implements TriggerChannel {
  private readonly host: ChannelHost;
  readonly limits: InputLimits;
  readonly eventBytes: number;
  /** 精确外部身份不随快照淘汰；内部心跳使用 Runtime 生成的身份。 */
  private readonly seen = new Set<string>();
  private readonly legacySeen = new Set<string>();
  private deliveryState: WorldDeliveryState | undefined;
  private readonly queue: Queued[] = [];
  private readonly snapshots = new Map<string, TriggerSnapshot>();
  private readonly listeners = new Set<(event: OutputEvent) => void>();
  private readonly output: OutputEvent[] = [];
  /** 排队取消和过期可独立追加终态，idle/stop 必须同时等待这些写入。 */
  private readonly finalizers = new Set<Promise<void>>();
  private active: Active | undefined;
  /** 活动项的终态追加结算后才取下一项；一次运行只保留一个消费者 Promise。 */
  private worker: Promise<void> | undefined;
  private sequence = 0;
  private outputSequence = 0;
  private skippedCount = 0;
  /** 过期心跳的终态写入尚未结算时也占用名额，避免存储挂起积压 finalizer。 */
  private heartbeatPending = false;
  /** unknown 或存储故障可先关闭受理，再等待 Runtime 完成停止。 */
  private closing = false;

  constructor(host: ChannelHost, limits: Partial<InputLimits> = {}, eventBytes = STANDARD_TRIGGER_LIMITS.eventBytes) {
    this.host = host;
    this.limits = Object.freeze({ ...STANDARD_INPUT_LIMITS, ...limits });
    this.eventBytes = eventBytes;
    for (const [name, value] of Object.entries({ ...this.limits, eventBytes })) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid limit ${name}`);
    if (this.limits.reserveBytes >= this.limits.requestBytes) throw new Error('reserveBytes must be smaller than requestBytes');
  }
  async submit(trigger: ExternalTrigger): Promise<TriggerReceipt> { return this.admit(trigger).receipt; }
  get accepting(): boolean { return this.host.status() === 'running' && !this.closing; }
  bindDeliveries(state: WorldDeliveryState): void { this.deliveryState = state; }
  async submitDelivery(delivery: WorldDelivery): Promise<WorldReceipt> {
    if (!delivery || typeof delivery !== 'object' || Object.keys(delivery).some(name => !['streamId', 'epoch', 'sequence', 'event', 'expiresAt'].includes(name))) return { status: 'rejected', triggerId: '', code: 'invalid_delivery', message: 'Expected a World delivery envelope' };
    const state = this.deliveryState!;
    const trigger: RuntimeTrigger = { kind: 'world_event', event: delivery.event, delivery: state.identity(delivery), ...(delivery.expiresAt !== undefined ? { expiresAt: delivery.expiresAt } : {}) };
    const invalid = validate(trigger, this.limits.textBytes, this.eventBytes, true);
    if (invalid) return { status: 'rejected', triggerId: triggerId(trigger), code: 'invalid_input', message: invalid };
    if (!this.accepting) return { status: 'rejected', triggerId: triggerId(trigger), code: 'not_running', message: 'Runtime is not accepting deliveries' };
    const existing = state.assess(delivery);
    if (existing) return existing;
    const { receipt } = this.admit(trigger, true);
    return receipt.status === 'accepted' ? { status: 'accepted', triggerId: receipt.triggerId, queueSequence: receipt.queueSequence } : receipt;
  }
  /** 完成 Promise 属于受理项，兼容入口等待它，不依赖可淘汰快照。 */
  async submitAndWait(trigger: ExternalTrigger): Promise<RunResult> {
    const admission = this.admit(trigger);
    if (admission.receipt.status === 'rejected') throw new InputError(admission.receipt.code, admission.receipt.message);
    return admission.item!.done;
  }
  /** 仅 Runtime 投递其生成的心跳；跳过 tick 只发布诊断，不分配受理序号。 */
  tick(trigger: HeartbeatTrigger): void {
    const pending = this.heartbeatPending;
    const admission = pending ? undefined : this.admit(trigger, true);
    if (pending || admission?.receipt.status === 'rejected') {
      const code = pending ? 'heartbeat_pending' : admission!.receipt.status === 'rejected' ? admission!.receipt.code : '';
      this.emit('heartbeat_skipped', null, null, { status: 'skipped', triggerKind: 'heartbeat', source: trigger.source,
        error: { code, message: 'Heartbeat was not admitted' }, skippedCount: ++this.skippedCount });
    }
  }
  private admit(trigger: RuntimeTrigger, internal = false): { receipt: TriggerReceipt; item?: Queued } {
    const invalid = !internal && trigger?.kind === 'heartbeat' ? 'Heartbeat identities belong to Runtime' : validate(trigger, this.limits.textBytes, this.eventBytes, internal);
    const kind = trigger?.kind;
    const id = invalid ? safeId(trigger) : triggerId(trigger);
    const reject = (code: string, text: string) => ({ receipt: { status: 'rejected', triggerKind: kind, triggerId: id, code, message: text } as TriggerReceipt });
    if (invalid) return reject('invalid_input', invalid);
    if (this.host.status() !== 'running' || this.closing) return reject('not_running', 'Runtime is not accepting triggers');
    if (kind === 'world_event' && !internal && this.deliveryState?.ordered) return reject('ordered_required', 'World uses registered delivery envelopes');
    const identity = key(kind, id);
    const ordered = kind === 'world_event' && 'delivery' in trigger;
    const identities = kind === 'user_input' ? this.seen : !ordered && kind === 'world_event' ? this.legacySeen : undefined;
    if (identities?.has(identity)) return reject(kind === 'user_input' ? 'duplicate_input' : 'duplicate_trigger', 'Trigger ID was already accepted');
    const idLimit = kind === 'user_input' ? this.limits.admissionIds : this.deliveryState?.limits.legacyIds;
    if (identities && idLimit !== undefined && identities.size >= idLimit) return reject('admission_limit', 'Trigger ID capacity reached');
    if (this.queue.length >= this.limits.pendingInputs) return reject('queue_full', 'Trigger queue is full');
    // 拒绝检查结束后才占用身份和序号；通知监听器前已经建立接收写入与完成 Promise。
    let resolve!: (result: RunResult) => void;
    const done = new Promise<RunResult>((yes) => { resolve = yes; });
    const item: Queued = { trigger: structuredClone(trigger), sequence: ++this.sequence, generation: this.host.generation(), received: Promise.resolve(), done, resolve, finalized: false };
    identities?.add(identity);
    if (ordered) this.deliveryState!.reserve({ ...trigger.delivery, event: trigger.event, ...(trigger.expiresAt !== undefined ? { expiresAt: trigger.expiresAt } : {}) });
    if (kind === 'heartbeat') this.heartbeatPending = true;
    this.queue.push(item);
    // 先启动追加，再通知可重入监听器。失败立即关闭受理并请求停止。
    try { item.received = this.host.append({ kind: 'trigger_received', at: now(), trigger: item.trigger, queueSequence: item.sequence, ...this.association(item) }); }
    catch (error) { item.received = Promise.reject(error); }
    void item.received.catch((error) => { if (ordered) this.deliveryState!.fail(trigger.delivery, error); this.closeAdmission(); this.requestStop(); });
    this.cache(item, null, 'queued');
    const deadline = kind === 'user_input' ? Date.now() + this.limits.queueMs : 'expiresAt' in trigger && trigger.expiresAt ? Date.parse(trigger.expiresAt) : undefined;
    if (deadline !== undefined) {
      const expire = (): void => {
        // 远期截止时间分段计时，避免 setTimeout 的最大延迟把未来事件提前结清。
        if (deadline > Date.now()) { item.timer = setTimeout(expire, Math.min(2_147_483_647, deadline - Date.now())); return; }
        this.remove(item);
        this.track(this.finish(item, null, { status: 'failed', code: kind === 'user_input' ? 'queue_expired' : 'trigger_expired', message: 'Trigger expired before execution', persisted: false }));
      };
      item.timer = setTimeout(expire, Math.min(2_147_483_647, Math.max(0, deadline - Date.now())));
    }
    this.emit('queued', item, null);
    this.pump();
    return { receipt: { status: 'accepted', triggerKind: kind, triggerId: id, queueSequence: item.sequence }, item };
  }
  async cancel(kind: TriggerKind, id: string) {
    const identity = key(kind, id);
    const item = this.queue.find((entry) => key(entry.trigger.kind, triggerId(entry.trigger)) === identity);
    let status: 'cancelled' | 'already_finished' | 'not_found';
    if (item) { this.remove(item); await this.track(this.finish(item, null, { status: 'cancelled', code: 'cancelled', persisted: false })); status = 'cancelled'; }
    else if (this.active && key(this.active.item.trigger.kind, triggerId(this.active.item.trigger)) === identity && !this.active.finishing) {
      this.active.controller.abort(new InputError('cancelled', 'Trigger cancelled')); status = 'cancelled';
    } else status = this.seen.has(identity) || this.legacySeen.has(identity) || this.snapshots.has(identity) ? 'already_finished' : 'not_found';
    return { triggerKind: kind, triggerId: id, status };
  }
  inspect(kind: TriggerKind, id: string): TriggerSnapshot | undefined { const value = this.snapshots.get(key(kind, id)); return value ? structuredClone(value) : undefined; }
  subscribe(listener: (event: OutputEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  eventsSince(seq: number) { return { gap: seq < (this.output[0]?.seq ?? this.outputSequence + 1) - 1, events: structuredClone(this.output.filter((event) => event.seq > seq)) }; }
  async idle(): Promise<void> { while (this.worker || this.finalizers.size) await Promise.all([this.worker, ...this.finalizers]); }
  opened(): void { this.closing = false; this.statusChanged(); }
  closeAdmission(): void { this.closing = true; }
  statusChanged(): void { this.emit('runtime_status', null, null, { status: this.host.status() }); }
  recoveryFailed(code: string, detail: string): void { this.emit('runtime_status', null, null, { status: 'blocked', error: { code, message: detail } }); }
  shutdown(): Promise<void> {
    // 先封闭受理和请求取消，再等待收束；到达的新事实不能抢占停止流程。
    this.closeAdmission();
    this.active?.controller.abort(new InputError('runtime_stopped', 'Runtime stopped'));
    for (const item of [...this.queue]) { this.remove(item); this.track(this.finish(item, null, { status: 'cancelled', code: 'runtime_stopped', persisted: false })); }
    return this.idle();
  }
  private pump(): void {
    if (this.worker || this.closing) return;
    // 延后一拍启动消费者，使 submit 先交付内存受理回执。
    const operation = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
      while (this.queue.length && !this.closing && this.host.status() === 'running') {
        const item = this.queue[0]!;
        this.remove(item);
        const run: Active = { item, id: randomUUID(), controller: new AbortController(), finishing: false, round: 0 };
        this.active = run;
        const timer = setTimeout(() => run.controller.abort(new InputError('run_timeout', 'Run deadline exceeded')), this.limits.runMs);
        let result: RunResult;
        let halt = false;
        try {
          // 存储尚未确认时不执行 Agent；挂起写入仍须在停止期间等待。
          await item.received;
          if (run.controller.signal.aborted) throw run.controller.signal.reason;
          if ('expiresAt' in item.trigger && item.trigger.expiresAt && Date.parse(item.trigger.expiresAt) <= Date.now()) throw new InputError('trigger_expired', 'Trigger expired before execution');
          this.cache(item, run.id, 'running', undefined, 0);
          this.emit('run_started', item, run.id, { round: 0 });
          ({ result, halt } = await executeTrigger(this.host, {
            trigger: item.trigger, runId: run.id, queueSequence: item.sequence, generation: item.generation,
            signal: run.controller.signal, limits: this.limits,
            progress: (event) => {
              run.round = event.round;
              // unknown 监听器可能同步提交新项，关闭受理必须先于通知。
              if (event.type === 'tool_finished' && event.status === 'unknown') { this.closeAdmission(); this.host.issue('tool_unknown', event.error?.message ?? 'Tool effect is unknown'); }
              this.cache(item, run.id, 'running', undefined, run.round);
              this.emit(event.type, item, run.id, event);
            },
          }));
        } catch (error) {
          const code = error instanceof InputError ? error.code : 'storage_error';
          result = { status: code === 'cancelled' || code === 'runtime_stopped' ? 'cancelled' : 'failed', code, message: message(error), persisted: false };
          halt = code === 'storage_error';
        }
        clearTimeout(timer);
        run.finishing = true;
        if (halt) this.closeAdmission();
        await this.finish(item, run.id, result, run.round);
        this.active = undefined;
        if (halt || this.closing) { this.requestStop(); break; }
      }
    }).finally(() => { if (this.worker === operation) this.worker = undefined; });
    this.worker = operation;
  }
  private async finish(item: Queued, runId: string | null, result: RunResult, round = 0): Promise<void> {
    if (item.finalized) return;
    item.finalized = true;
    this.cache(item, runId, 'write_pending', undefined, round);
    this.emit('run_status', item, runId, { status: 'write_pending', round });
    let final = { ...result, persisted: true };
    try {
      await item.received;
      await this.host.append({ kind: 'run_finished', at: now(), inputId: triggerId(item.trigger), ...(runId ? { runId } : {}), ...this.association(item), result: final });
    } catch (error) {
      this.closeAdmission();
      final = { status: 'failed', code: 'storage_error', message: message(error), persisted: false };
      this.requestStop();
    }
    // 最终事件和完成 Promise 都晚于终态写入结算；实时工具诊断有独立含义。
    this.cache(item, runId, final.status, final, round);
    this.emit('run_finished', item, runId, { result: final, round });
    if (item.trigger.kind === 'heartbeat') this.heartbeatPending = false;
    item.resolve(final);
  }
  /** stop 自身等待 worker；当前消费者只发起停止，不能反向 await 它。 */
  private requestStop(): void { void Promise.resolve().then(() => this.host.stop()).catch(() => undefined); }
  private track(operation: Promise<void>): Promise<void> {
    this.finalizers.add(operation);
    void operation.then(() => this.finalizers.delete(operation), () => this.finalizers.delete(operation));
    return operation;
  }
  private remove(item: Queued): void { if (item.timer) clearTimeout(item.timer); const index = this.queue.indexOf(item); if (index >= 0) this.queue.splice(index, 1); }
  private association(item: Queued) { return { triggerKind: item.trigger.kind, triggerId: triggerId(item.trigger), source: triggerSource(item.trigger), generation: item.generation,
    ...(item.trigger.kind === 'world_event' && 'delivery' in item.trigger ? { delivery: item.trigger.delivery } : {}) }; }
  private cache(item: Queued, runId: string | null, status: TriggerSnapshot['status'], result?: RunResult, round?: number): void {
    // 更新已有 Map 项不改变插入次序；按最早保留项淘汰，不释放外部去重身份。
    this.snapshots.set(key(item.trigger.kind, triggerId(item.trigger)), { ...this.association(item), runId, queueSequence: item.sequence, status, ...(result ? { result } : {}), ...(round !== undefined ? { round } : {}) });
    while (this.snapshots.size > this.limits.snapshotEntries || bytes([...this.snapshots.values()]) > this.limits.snapshotBytes) this.snapshots.delete(this.snapshots.keys().next().value!);
  }
  private emit(type: OutputEvent['type'], item: Queued | null, runId: string | null, extra: Partial<OutputEvent> = {}): void {
    const event: OutputEvent = { type, inputId: item?.trigger.kind === 'user_input' ? item.trigger.input.inputId : null, runId,
      sessionId: this.host.agent.declareSession().sessionId, generation: item?.generation ?? this.host.generation(),
      triggerKind: item?.trigger.kind ?? null, triggerId: item ? triggerId(item.trigger) : null, source: item ? triggerSource(item.trigger) : null,
      ...(item?.trigger.kind === 'world_event' && 'delivery' in item.trigger ? { delivery: item.trigger.delivery } : {}),
      seq: ++this.outputSequence, at: now(), ...extra };
    this.output.push(event);
    while (this.output.length > this.limits.outputEntries || bytes(this.output) > this.limits.outputBytes) this.output.shift();
    // 即使本条因容量未保留，当前订阅者仍收到副本；通知失败不改变处理结果。
    for (const listener of this.listeners) { try { listener(structuredClone(event)); } catch { /* 诊断监听器不拥有执行权。 */ } }
  }
}
function key(kind: TriggerKind, id: string): string { return JSON.stringify([kind, id]); }
function safeId(trigger: RuntimeTrigger): string {
  const value = trigger?.kind === 'user_input' ? trigger.input?.inputId : trigger?.kind === 'world_event' ? trigger.event?.id : trigger?.kind === 'heartbeat' ? trigger.id : undefined;
  return typeof value === 'string' ? value : '';
}
/** 外部受理边界校验形状、JSON 和容量；World 工具负责领域参数与动作语义。 */
function validate(trigger: RuntimeTrigger, textLimit: number, eventLimit: number, internal = false): string | undefined {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return 'Expected a trigger object';
  if (trigger.kind === 'user_input') {
    const input = trigger.input;
    if (Object.keys(trigger).sort().join(',') !== 'input,kind' || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'content,inputId,source') return 'Expected inputId, source and content only';
    if (!validLabel(input.inputId) || !validLabel(input.source)) return 'ID and source must contain 1–128 UTF-8 bytes';
    if (!input.content || Object.keys(input.content).sort().join(',') !== 'kind,text' || input.content.kind !== 'text' || typeof input.content.text !== 'string' || !input.content.text.trim()) return 'Expected nonempty text content';
    if (Buffer.byteLength(input.content.text) > textLimit) return `Text exceeds ${textLimit} UTF-8 bytes`;
  } else if (trigger.kind === 'world_event') {
    if (Object.keys(trigger).some((name) => !['kind', 'event', 'expiresAt', ...(internal ? ['delivery'] : [])].includes(name))) return 'Unexpected trigger field';
    const event = trigger.event;
    if (!event || typeof event !== 'object' || Array.isArray(event) || !validLabel(event.id) || !validLabel(event.source) || !validLabel(event.type) || !validTime(event.occurredAt) || !('payload' in event)) return 'Expected a valid World Event';
    if (Object.keys(event).some((name) => !['id', 'type', 'source', 'occurredAt', 'payload', 'meta'].includes(name))) return 'Unexpected event field';
    try { if (!jsonValue(event) || bytes(event) > eventLimit) return `Event must be JSON within ${eventLimit} UTF-8 bytes`; }
    catch { return 'Event must be serializable JSON'; }
    if (trigger.expiresAt !== undefined && !validTime(trigger.expiresAt)) return 'Expected expiresAt as a timestamp';
  } else if (trigger.kind !== 'heartbeat') return 'Unknown trigger kind';
  return undefined;
}
function validLabel(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && Buffer.byteLength(value) <= 128; }
function validTime(value: unknown): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(jsonValue);
}
function now(): string { return new Date().toISOString(); }
