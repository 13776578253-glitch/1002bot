/** Owns one FIFO admission queue per Runtime; bounded caches provide diagnostics, not recovery. */
import { randomUUID } from 'node:crypto';
import type { CancelReceipt, InputChannel, InputLimits, InputReceipt, InputSnapshot, OutputEvent, RunResult, UserInput } from '../protocol/index.ts';
import { InputError, STANDARD_INPUT_LIMITS } from '../protocol/index.ts';
import { bytes, executeInput, message, type InputRunHost } from './input-run.ts';

/** Runtime owns lifecycle; the channel uses host callbacks to observe state and request shutdown. */
interface ChannelHost extends InputRunHost {
  status(): string;
  generation(): number;
  legacyBusy(): boolean;
  stop(): Promise<void>;
}
interface Queued { input: UserInput; sequence: number; generation: number; timer?: ReturnType<typeof setTimeout> }
interface Active { item: Queued; id: string; controller: AbortController; finishing: boolean; round: number }

export class RuntimeInputChannel implements InputChannel {
  private readonly host: ChannelHost;
  readonly limits: InputLimits;
  /** 去重表不随诊断缓存淘汰，也不随同一实例的重新启动清空。 */
  private readonly seen = new Set<string>();
  private readonly queue: Queued[] = [];
  private readonly snapshots = new Map<string, InputSnapshot>();
  private readonly listeners = new Set<(event: OutputEvent) => void>();
  private readonly output: OutputEvent[] = [];
  /** 排队取消与过期也需要写最终记录，但不占用执行 worker。 */
  private readonly finalizers = new Set<Promise<void>>();
  private active: Active | undefined;
  /** 单一消费者；上一输入的最终记录确认后才处理下一输入。 */
  private worker: Promise<void> | undefined;
  private sequence = 0;
  private outputSequence = 0;
  /** 可先于 Runtime 停止关闭受理，防止 unknown 收束等待存储时继续排队。 */
  private closing = false;

  constructor(host: ChannelHost, limits: Partial<InputLimits> = {}) {
    this.host = host;
    this.limits = Object.freeze({ ...STANDARD_INPUT_LIMITS, ...limits });
    for (const [key, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid input limit ${key}`);
    if (this.limits.reserveBytes >= this.limits.requestBytes) throw new Error('reserveBytes must be smaller than requestBytes');
  }
  get busy(): boolean { return !!this.worker || this.queue.length > 0; }
  async submit(input: UserInput): Promise<InputReceipt> {
    const invalid = validate(input, this.limits.textBytes);
    const inputId = typeof input?.inputId === 'string' ? input.inputId : '';
    const reject = (code: string, text: string): InputReceipt => ({ status: 'rejected', inputId, code, message: text });
    if (invalid) return reject('invalid_input', invalid);
    if (this.host.status() !== 'running' || this.closing) return reject('not_running', 'Runtime is not accepting input');
    if (this.host.legacyBusy()) return reject('runtime_busy', 'An environment event is running');
    if (this.seen.has(inputId)) return reject('duplicate_input', 'Input ID was already accepted');
    if (this.seen.size >= this.limits.admissionIds) return reject('admission_limit', 'Runtime input ID capacity reached');
    if (this.queue.length >= this.limits.pendingInputs) return reject('queue_full', 'Input queue is full');
    // 全部拒绝条件检查完成后才占用标识和序号；保存副本隔离提交方后续修改。
    const item: Queued = { input: structuredClone(input), sequence: ++this.sequence, generation: this.host.generation() };
    this.seen.add(inputId);
    this.queue.push(item);
    this.cache({ inputId, runId: null, queueSequence: item.sequence, status: 'queued' });
    item.timer = setTimeout(() => { this.remove(item); this.track(this.finish(item, null, { status: 'failed', code: 'queue_expired', message: 'Queue wait deadline exceeded', persisted: false })); }, this.limits.queueMs);
    this.emit('queued', item, null);
    this.pump();
    return { status: 'accepted', inputId, queueSequence: item.sequence };
  }
  async cancel(inputId: string): Promise<CancelReceipt> {
    const item = this.queue.find((entry) => entry.input.inputId === inputId);
    if (item) {
      this.remove(item);
      await this.track(this.finish(item, null, { status: 'cancelled', code: 'cancelled', persisted: false }));
      return { inputId, status: 'cancelled' };
    }
    if (this.active?.item.input.inputId === inputId && !this.active.finishing) {
      this.active.controller.abort(new InputError('cancelled', 'Input cancelled'));
      return { inputId, status: 'cancelled' };
    }
    return { inputId, status: this.seen.has(inputId) ? 'already_finished' : 'not_found' };
  }
  inspect(inputId: string): InputSnapshot | undefined {
    const value = this.snapshots.get(inputId);
    return value ? structuredClone(value) : undefined;
  }
  subscribe(listener: (event: OutputEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  eventsSince(seq: number): { gap: boolean; events: readonly OutputEvent[] } {
    return { gap: seq < (this.output[0]?.seq ?? this.outputSequence + 1) - 1, events: structuredClone(this.output.filter((event) => event.seq > seq)) };
  }
  async idle(): Promise<void> { while (this.worker || this.finalizers.size) await Promise.all([this.worker, ...this.finalizers]); }
  opened(): void { this.closing = false; this.statusChanged(); }
  statusChanged(): void { this.emit('runtime_status', null, null, { status: this.host.status() }); }
  shutdown(): Promise<void> {
    this.closing = true;
    this.active?.controller.abort(new InputError('runtime_stopped', 'Runtime stopped'));
    for (const item of [...this.queue]) {
      this.remove(item);
      this.track(this.finish(item, null, { status: 'cancelled', code: 'runtime_stopped', persisted: false }));
    }
    return this.idle();
  }
  private pump(): void {
    if (this.worker || this.closing) return;
    // 延后一拍启动消费者，让 submit 先交付受理回执。
    const operation = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
      while (this.queue.length && !this.closing && this.host.status() === 'running') {
        const item = this.queue[0]!;
        this.remove(item);
        const run: Active = { item, id: randomUUID(), controller: new AbortController(), finishing: false, round: 0 };
        this.active = run;
        const timer = setTimeout(() => run.controller.abort(new InputError('run_timeout', 'Run deadline exceeded')), this.limits.runMs);
        this.cache({ inputId: item.input.inputId, runId: run.id, queueSequence: item.sequence, status: 'running', round: 0 });
        this.emit('run_started', item, run.id, { round: 0 });
        let result: RunResult;
        let halt = false;
        try {
          ({ result, halt } = await executeInput(this.host, {
            input: item.input, runId: run.id, queueSequence: item.sequence, generation: item.generation,
            signal: run.controller.signal, limits: this.limits,
            progress: (event) => {
              run.round = event.round;
              // 先关闭受理，再通知监听器；回调中的重入提交也必须看到停止决定。
              if (event.type === 'tool_finished' && event.status === 'unknown') this.closing = true;
              this.cache({ inputId: item.input.inputId, runId: run.id, queueSequence: item.sequence, status: 'running', round: run.round });
              this.emit(event.type, item, run.id, event);
            },
          }));
        } catch (error) { result = { status: 'failed', code: 'storage_error', message: message(error), persisted: false }; }
        clearTimeout(timer);
        // 执行结果已确定，随后只等待最终写入；取消不能再改写这次结果。
        run.finishing = true;
        if (halt) this.closing = true;
        await this.finish(item, run.id, result, run.round);
        this.active = undefined;
        if (halt) {
          // stop 会等待 worker；这里只发起停止，worker 随后退出，避免互相等待。
          void Promise.resolve().then(() => this.host.stop()).catch(() => undefined);
          break;
        }
      }
    }).finally(() => { if (this.worker === operation) this.worker = undefined; });
    this.worker = operation;
  }
  private async finish(item: Queued, runId: string | null, result: RunResult, round = 0): Promise<void> {
    this.cache({ inputId: item.input.inputId, runId, queueSequence: item.sequence, status: 'write_pending', round });
    this.emit('run_status', item, runId, { status: 'write_pending', round });
    // 先写终态记录，再发布唯一的最终结果；写入失败必须以 persisted=false 呈现。
    let final = { ...result, persisted: true };
    try { await this.host.append({ kind: 'run_finished', at: new Date().toISOString(), inputId: item.input.inputId, ...(runId ? { runId } : {}), result: final }); }
    catch (error) { final = { status: 'failed', code: 'storage_error', message: message(error), persisted: false }; }
    this.cache({ inputId: item.input.inputId, runId, queueSequence: item.sequence, status: final.status, result: final, round });
    this.emit('run_finished', item, runId, { result: final, round });
  }
  private track(operation: Promise<void>): Promise<void> {
    this.finalizers.add(operation);
    void operation.finally(() => this.finalizers.delete(operation));
    return operation;
  }
  private remove(item: Queued): void {
    if (item.timer) clearTimeout(item.timer);
    const index = this.queue.indexOf(item);
    if (index >= 0) this.queue.splice(index, 1);
  }
  private cache(snapshot: InputSnapshot): void {
    // Map 更新已有项不改变插入次序，按最早保留的输入淘汰，而非最近访问时间。
    this.snapshots.set(snapshot.inputId, snapshot);
    while (this.snapshots.size > this.limits.snapshotEntries || bytes([...this.snapshots.values()]) > this.limits.snapshotBytes) this.snapshots.delete(this.snapshots.keys().next().value!);
  }
  private emit(type: OutputEvent['type'], item: Queued | null, runId: string | null, extra: Partial<OutputEvent> = {}): void {
    const event: OutputEvent = { type, inputId: item?.input.inputId ?? null, runId,
      sessionId: this.host.agent.declareSession().sessionId, generation: item?.generation ?? this.host.generation(), seq: ++this.outputSequence, at: new Date().toISOString(), ...extra };
    this.output.push(event);
    while (this.output.length > this.limits.outputEntries || bytes(this.output) > this.limits.outputBytes) this.output.shift();
    // 即使事件因容量过大未留在缓存中，当前订阅者仍收到一次实时通知。
    for (const listener of this.listeners) { try { listener(structuredClone(event)); } catch { /* 监听器异常与运行隔离。 */ } }
  }
}
function validate(input: UserInput, limit: number): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'content,inputId,source') return 'Expected inputId, source and content only';
  for (const value of [input.inputId, input.source]) if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 128) return 'ID and source must contain 1–128 UTF-8 bytes';
  if (!input.content || Object.keys(input.content).sort().join(',') !== 'kind,text' || input.content.kind !== 'text' || typeof input.content.text !== 'string' || !input.content.text.trim()) return 'Expected nonempty text content';
  if (Buffer.byteLength(input.content.text) > limit) return `Text exceeds ${limit} UTF-8 bytes`;
  return undefined;
}
