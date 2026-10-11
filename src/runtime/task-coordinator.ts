/** Run grants serialize task commits; confirmation and terminal barriers outlive cancellation. */
import type { SessionEntry, SessionStore, TaskCreate, TaskInspector, TaskRunPort, TaskSnapshot, TaskUpdate, TriggerKind, WorldDeliveryIdentity } from '../protocol/index.ts';
import { InputError } from '../protocol/index.ts';
import { TaskProjection, stateOnly } from '../state/task-projection.ts';

interface Origin { runId: string; generation: number; triggerKind: TriggerKind; triggerId: string; source: string; delivery?: WorldDeliveryIdentity }
export interface TaskLease { port: TaskRunPort; forCall(callId: string, signal: AbortSignal): TaskRunPort; revokeCall(callId: string): void; settle(): Promise<void>; finish(): Promise<void> }
export class TaskCoordinator implements TaskInspector {
  private projection: TaskProjection;
  private readonly sessionId: string;
  private readonly store: SessionStore;
  private readonly append: (entry: SessionEntry) => Promise<void>;
  private readonly alive: (generation: number) => boolean;
  private readonly clock: () => number;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(options: { projection: TaskProjection; sessionId: string; store: SessionStore; append: (entry: SessionEntry) => Promise<void>; alive: (generation: number) => boolean; clock: () => number }) {
    this.projection = options.projection; this.sessionId = options.sessionId; this.store = options.store;
    this.append = options.append; this.alive = options.alive; this.clock = options.clock;
  }
  replace(projection: TaskProjection): void { this.projection = projection; }
  observe(entry: SessionEntry): void { this.projection.observe(entry); }
  snapshot(): readonly TaskSnapshot[] { return this.projection.snapshot(); }
  async read(taskId: string, signal?: AbortSignal): Promise<TaskSnapshot | undefined> {
    if (!this.store.scan) throw new InputError('session_capability', 'Task archive queries require Session.scan');
    const projection = new TaskProjection(this.sessionId, this.projection.limits, taskId);
    for await (const entry of this.store.scan(signal)) projection.observe(entry);
    return projection.watchedTask;
  }
  async evidence(taskId: string, runId: string, budget = this.projection.limits.evidenceBytes, signal?: AbortSignal): Promise<readonly SessionEntry[]> {
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > this.projection.limits.evidenceBytes) throw new InputError('task_evidence_limit', 'Evidence budget exceeds its configured limit');
    if (!this.store.scan) throw new InputError('session_capability', 'Task evidence queries require Session.scan');
    const entries: SessionEntry[] = [];
    let bytes = 0, associated = false, finished = false;
    for await (const entry of this.store.scan(signal)) {
      if (entry.runId !== runId || entry.kind === 'trigger_received') continue;
      bytes += Buffer.byteLength(JSON.stringify(entry));
      if (bytes > budget) throw new InputError('task_evidence_limit', 'Complete attempt evidence exceeds its budget');
      if (entry.kind === 'task_changed' && entry.task.taskId === taskId || entry.kind === 'task_claimed' && entry.taskId === taskId) associated = true;
      entries.push(entry);
      if (entry.kind === 'run_finished') { finished = true; break; }
    }
    if (!associated || !finished) throw new InputError('task_evidence_missing', 'No complete attempt belongs to this task/run');
    return structuredClone(entries);
  }
  open(origin: Origin, signal: AbortSignal): TaskLease {
    let open = true;
    let selected: string | undefined;
    const closedCalls = new Set<string>();
    const pending = new Set<Promise<unknown>>();
    let storageError: unknown;
    const authorize = (): void => { if (!open || signal.aborted || !this.alive(origin.generation)) throw new InputError('task_revoked', 'Task commit grant no longer owns this run'); };
    const track = <T>(operation: Promise<T>): Promise<T> => {
      pending.add(operation);
      void operation.then(() => pending.delete(operation), error => {
        if (error instanceof InputError && error.code === 'storage_error') storageError ??= error;
        pending.delete(operation);
      });
      return operation;
    };
    const commit = <T>(check: () => void, operation: () => Promise<T>): Promise<T> => {
      check();
      const result = this.tail.then(() => { check(); return operation(); });
      this.tail = result.catch(() => undefined);
      return track(result);
    };
    const save = async (entry: SessionEntry): Promise<void> => {
      // 已进入追加的提交不因撤权回滚；确认投影由 Runtime 统一发布。
      try { await this.append(entry); } catch (error) { throw new InputError('storage_error', error instanceof Error ? error.message : String(error)); }
    };
    const port = (callId?: string, callSignal = signal): TaskRunPort => {
      const check = (): void => { authorize(); if (callSignal.aborted || callId !== undefined && closedCalls.has(callId)) throw new InputError('task_revoked', 'Task tool no longer grants commits'); };
      return {
      limits: this.projection.limits,
      get selectedTaskId() { return selected; },
      now: () => { check(); const time = this.clock(); if (!Number.isFinite(time)) throw new InputError('task_clock', 'Task clock is invalid'); return new Date(time).toISOString(); },
      snapshot: () => { check(); return this.snapshot(); },
      read: taskId => { check(); return track(this.read(taskId, callSignal)); },
      evidence: (taskId, runId, bytes) => { check(); return track(this.evidence(taskId, runId, bytes, callSignal)); },
      create: (value: TaskCreate) => { const input = structuredClone(value); return commit(check, async () => {
        const task = { taskId: this.projection.nextId(), revision: 1, intent: input.intent, data: input.data ?? {}, status: input.status,
          scheduleRevision: input.schedule ? 1 : 0, ...(input.schedule ? { schedule: { revision: 1, wakeAt: input.schedule.wakeAt } } : {}) };
        const entry: SessionEntry = { kind: 'task_changed', at: new Date().toISOString(), schema: 1, sessionId: this.sessionId, expectedRevision: 0, task, ...origin, ...(callId ? { callId } : {}) };
        this.projection.validateChange(entry);
        await save(entry);
        return this.projection.get(task.taskId)!;
      }); },
      update: (value: TaskUpdate) => { const input = structuredClone(value); return commit(check, async () => {
        const previous = this.projection.get(input.taskId);
        if (!previous) throw new InputError('task_not_active', 'Task is absent or terminal; terminal tasks cannot be reopened');
        const task = stateOnly(previous);
        ++task.revision;
        if (input.intent !== undefined) task.intent = input.intent;
        if (input.data !== undefined) task.data = input.data;
        if (input.status !== undefined) task.status = input.status;
        if (input.schedule !== undefined) {
          ++task.scheduleRevision;
          if (input.schedule === null) delete task.schedule;
          else task.schedule = { revision: task.scheduleRevision, wakeAt: input.schedule.wakeAt };
        }
        const entry: SessionEntry = { kind: 'task_changed', at: new Date().toISOString(), schema: 1, sessionId: this.sessionId, expectedRevision: input.expectedRevision, task, ...origin, ...(callId ? { callId } : {}) };
        this.projection.validateChange(entry);
        await save(entry);
        // 终态离开活跃视图；工具返回自己的确认状态，明细仍可显式读归档。
        return this.projection.confirmed(task.taskId)!;
      }); },
      claim: (taskId, scheduleRevision) => commit(check, async () => {
        const entry: SessionEntry = { kind: 'task_claimed', at: new Date().toISOString(), schema: 1, sessionId: this.sessionId, taskId, scheduleRevision, checkedAt: new Date(this.clock()).toISOString(), ...origin, ...(callId ? { callId } : {}) };
        this.projection.validateClaim(entry);
        const task = this.projection.get(taskId)!;
        if (Date.parse(task.schedule!.wakeAt) > this.clock()) throw new InputError('task_not_due', 'Arrangement is not due');
        await save(entry);
        selected = taskId;
        return this.projection.get(taskId)!;
      }),
    }; };
    const settle = async (): Promise<void> => { while (pending.size) await Promise.allSettled([...pending]); if (storageError) throw storageError; };
    return { port: port(), forCall: (callId, child) => port(callId, child), revokeCall: callId => { closedCalls.add(callId); }, settle, finish: async () => {
      // 先撤销新提交，再等待已进入/排队提交结算，终态不能越过确认。
      open = false;
      await settle();
    } };
  }
}
