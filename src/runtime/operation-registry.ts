/** Runtime owns external-call slots and independent late records after ordinary run authority is revoked. */
import type { LateQuery, LateRecord, LateResult, OperationOrigin, OperationRecord, OperationSnapshot, ResponseLimits, SessionEntry, SessionStore } from '../protocol/index.ts';
import { InputError, operationKey, STANDARD_RESPONSE_LIMITS } from '../protocol/index.ts';
import { matchesOutcome } from './tool-registry.ts';

interface Ticket<T = unknown> {
  origin: OperationOrigin;
  promise: Promise<T>;
  settled: boolean;
  value?: T;
  error?: unknown;
  succeeded: boolean;
  detached: boolean;
  saved?: Promise<void>;
  archived?: Promise<void>;
  late?: LateResult;
}
export class OperationRegistry {
  readonly limits: Readonly<ResponseLimits>;
  private readonly pending = new Map<string, Ticket>();
  /** 动作回执尚未验证时仍锁住安全让出，Promise 已结束也不能解除。 */
  private readonly unsafe = new Set<string>();
  private lateBytes = 0;
  private archiveFailure: InputError | undefined;
  /** 超时后的重复 stop 共用同一等待，不追加新的悬挂 Promise 监听。 */
  private drainOperation: Promise<void> | undefined;
  private readonly host: { sessionId: string; session: SessionStore; append: (entry: SessionEntry) => Promise<void>;
    alive: () => boolean; fail: (error: unknown) => void };
  constructor(host: { sessionId: string; session: SessionStore; append: (entry: SessionEntry) => Promise<void>;
    alive: () => boolean; fail: (error: unknown) => void }, limits: Partial<ResponseLimits> = {}) {
    this.host = host;
    this.limits = Object.freeze({ ...STANDARD_RESPONSE_LIMITS, ...limits });
    if (!Object.values(this.limits).every(value => Number.isSafeInteger(value) && value > 0)
      || this.limits.yieldedOperations >= this.limits.pendingOperations || this.limits.lateRecordBytes > this.limits.latePendingBytes) throw new Error('Invalid response limits');
  }
  snapshot(): readonly OperationSnapshot[] { return [...this.pending.values()].map(ticket => ({ origin: structuredClone(ticket.origin), detached: ticket.detached,
    state: ticket.settled ? 'confirming' : ticket.detached ? 'detached' : 'running' })); }
  setUnsafe(runId: string, unsafe: boolean): void { if (unsafe) this.unsafe.add(runId); else this.unsafe.delete(runId); }
  finishRun(runId: string): void { this.unsafe.delete(runId); }
  /** 此处只审定能否发出安全控制，真正结清由通道保存终态后完成。 */
  yieldRejection(runId: string): { code: string; message: string } | undefined {
    if (this.unsafe.has(runId)) return { code: 'unsafe_operation', message: 'Current World effect has not been confirmed' };
    const current = [...this.pending.values()].some(ticket => ticket.origin.runId === runId && !ticket.settled);
    const detached = [...this.pending.values()].filter(ticket => ticket.detached && !ticket.settled).length;
    if (current && detached >= this.limits.yieldedOperations) return { code: 'yield_capacity', message: 'Unfinished yielded operations have reached capacity' };
    return undefined;
  }
  /** 登记先于调用；原 Promise 结算和迟到追加完成之前保留所有权。 */
  start<T>(origin: OperationOrigin, task: () => Promise<T>): Ticket<T> {
    if (!this.host.alive()) throw new InputError('runtime_stopped', 'Runtime no longer permits external operations');
    if (this.pending.size >= this.limits.pendingOperations) throw new InputError('operation_capacity', 'External operations have reached capacity');
    const key = operationKey(origin);
    const ticket: Ticket<T> = { origin: structuredClone(origin), promise: Promise.resolve().then(task), settled: false, succeeded: false, detached: false };
    this.pending.set(key, ticket);
    void ticket.promise.then(value => { ticket.value = value; ticket.succeeded = true; this.settled(ticket); }, error => { ticket.error = error; this.settled(ticket); });
    return ticket;
  }
  /** 撤权登记先确认；已结束的真实调用同样可产生一次迟到诊断。 */
  async detach(ticket: Ticket, reason: unknown): Promise<void> {
    if (ticket.detached) return ticket.saved;
    ticket.detached = true;
    this.pending.set(operationKey(ticket.origin), ticket);
    // 未声明动作的迟到结果不能修正原 unknown，仅等待资源结束。
    if (ticket.origin.kind === 'world' && ticket.origin.effects !== 'none') {
      if (ticket.settled) this.pending.delete(operationKey(ticket.origin));
      return;
    }
    if (ticket.settled) ticket.late = this.lateResult(ticket);
    ticket.saved = this.write({ kind: 'operation_detached', at: now(), schema: 1, origin: ticket.origin, reason: detail(reason) });
    try { await ticket.saved; }
    catch (error) { if (ticket.settled) this.pending.delete(operationKey(ticket.origin)); this.host.fail(error); throw new InputError('storage_error', detail(error).message); }
    if (ticket.settled) await this.archive(ticket);
  }
  /** 返回原调用是否已经取得结果，供取消与回执同刻竞争时保留真实回执。 */
  result<T>(ticket: Ticket<T>): { value: T } | undefined { return ticket.settled && ticket.succeeded ? { value: ticket.value! } : undefined; }
  private settled(ticket: Ticket): void {
    ticket.settled = true;
    if (!ticket.detached) { this.pending.delete(operationKey(ticket.origin)); return; }
    if (ticket.origin.kind === 'world' && ticket.origin.effects !== 'none') { this.pending.delete(operationKey(ticket.origin)); return; }
    ticket.late = this.lateResult(ticket);
    void this.archive(ticket).catch(error => this.host.fail(error));
  }
  private lateResult(ticket: Ticket): LateResult {
    if (!ticket.succeeded) return { status: 'failed', error: detail(ticket.error) };
    if (ticket.origin.kind === 'provider') return { status: 'discarded', error: { code: 'provider_late', message: 'Cancelled response was not executed or replayed' } };
    const value = ticket.value as import('../protocol/index.ts').ToolOutcome;
    if (!matchesOutcome(value, ticket.origin)) {
      const error = new InputError('invalid_late_outcome', 'Late World receipt does not match its original call');
      this.host.fail(error); return { status: 'failed', error: detail(error) };
    }
    if (value.status === 'unknown') this.host.fail(new InputError('tool_unknown', 'Read-only World returned an unknown late receipt'));
    // 固定原观察副本；生产方后续修改对象不改变待确认迟到事实。
    try { return JSON.parse(JSON.stringify({ status: 'returned', outcome: value })) as LateResult; }
    catch { return { status: 'discarded', error: { code: 'late_serialization', message: 'Late outcome is not JSON' } }; }
  }
  private archive(ticket: Ticket): Promise<void> {
    if (ticket.archived) return ticket.archived;
    const operation = Promise.resolve().then(async () => {
      await ticket.saved;
      let record: LateRecord = { kind: 'operation_late', at: now(), schema: 1, origin: ticket.origin, result: ticket.late! };
      if (Buffer.byteLength(JSON.stringify(record)) > this.limits.lateRecordBytes) record = { ...record,
        result: { status: 'discarded', error: { code: 'late_capacity', message: 'Late outcome exceeded its record budget' } } };
      await this.write(record);
    }).finally(() => { this.pending.delete(operationKey(ticket.origin)); delete ticket.value; delete ticket.late; });
    ticket.archived = operation;
    return operation;
  }
  private async write(record: OperationRecord): Promise<void> {
    const line = JSON.stringify(record), bytes = Buffer.byteLength(line);
    if (bytes > this.limits.lateRecordBytes || this.lateBytes + bytes > this.limits.latePendingBytes) {
      const error = new InputError('storage_error', 'Necessary operation record exceeded its confirmation budget');
      this.archiveFailure ??= error; this.host.fail(error); throw error;
    }
    this.lateBytes += bytes;
    try { await this.host.append(JSON.parse(line) as OperationRecord); }
    catch (cause) { const error = new InputError('storage_error', detail(cause).message); this.archiveFailure ??= error; this.host.fail(error); throw error; }
    finally { this.lateBytes -= bytes; }
  }
  async readLate(query: LateQuery, signal?: AbortSignal): Promise<LateRecord | undefined> {
    if (!query.runId || !query.callId) throw new InputError('invalid_operation_query', 'Original runId and callId are required');
    const budget = query.bytes ?? this.limits.evidenceBytes;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > this.limits.evidenceBytes) throw new InputError('operation_evidence_limit', 'Query exceeds its evidence budget');
    if (!this.host.session.scan) throw new InputError('session_capability', 'Late evidence requires Session.scan');
    for await (const entry of this.host.session.scan(signal)) {
      signal?.throwIfAborted();
      if (entry.kind === 'operation_late' && entry.origin.sessionId === this.host.sessionId && entry.origin.kind === 'world'
        && entry.origin.runId === query.runId && entry.origin.callId === query.callId) {
        if (Buffer.byteLength(JSON.stringify(entry)) > budget) throw new InputError('operation_evidence_limit', 'Complete late record exceeds the query budget');
        return structuredClone(entry);
      }
    }
  }
  /** 清理期限不释放名额；超时保留原调用供诊断和再次 stop。 */
  async drain(ms: number): Promise<void> {
    if (!this.drainOperation) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = this.wait();
      const operation = Promise.race([idle, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new InputError('operation_cleanup_timeout', 'External operations have not exited')), ms);
      })]).finally(() => { if (timer) clearTimeout(timer); });
      this.drainOperation = operation;
      void idle.then(() => { if (this.drainOperation === operation) this.drainOperation = undefined; });
    }
    await this.drainOperation;
    if (this.archiveFailure) throw this.archiveFailure;
  }
  private async wait(): Promise<void> {
    while (this.pending.size) {
      const tickets = [...this.pending.values()];
      await Promise.allSettled(tickets.map(ticket => ticket.promise));
      await Promise.allSettled(tickets.map(ticket => ticket.archived ?? ticket.saved));
      // 结算回调可在上一组 Promise 之后才建立 archive。
      await Promise.resolve();
    }
  }
}
function now(): string { return new Date().toISOString(); }
function detail(error: unknown): { code: string; message: string } {
  return { code: error instanceof InputError ? error.code : 'operation_error', message: (error instanceof Error ? error.message : String(error)).slice(0, 1024) };
}
