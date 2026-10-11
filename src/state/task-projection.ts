/** Confirmed Session facts project bounded active tasks; terminal tasks remain in the archive. */
import type { SessionEntry, TaskAttempt, TaskEffect, TaskLimits, TaskSnapshot, TaskState } from '../protocol/index.ts';
import { InputError, STANDARD_TASK_LIMITS } from '../protocol/index.ts';

type Change = Extract<SessionEntry, { kind: 'task_changed' }>;
type Claim = Extract<SessionEntry, { kind: 'task_claimed' }>;
export class TaskProjection {
  readonly limits: Readonly<TaskLimits>;
  private readonly sessionId: string;
  private readonly active = new Map<string, TaskSnapshot>();
  private allocated = 0;
  private run: { id: string; origin: SessionEntry; calls: Map<string, string | undefined>; attempt: TaskAttempt; tasks: Map<string, TaskSnapshot> } | undefined;
  private readonly watchId: string | undefined;
  private watched: TaskSnapshot | undefined;
  constructor(sessionId: string, limits: Partial<TaskLimits> = {}, watchId?: string) {
    this.sessionId = sessionId;
    this.watchId = watchId;
    this.limits = Object.freeze({ ...STANDARD_TASK_LIMITS, ...limits });
    for (const [name, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid task ${name}`);
    if (this.limits.viewBytes < this.limits.stateBytes) throw new Error('Task viewBytes must accommodate a task state');
  }
  nextId(): string { if (!Number.isSafeInteger(this.allocated + 1)) fail('task_capacity', 'Task identity range exhausted'); return `task-${this.allocated + 1}`; }
  snapshot(): readonly TaskSnapshot[] { return structuredClone([...this.active.values()]); }
  get(taskId: string): TaskSnapshot | undefined { const task = this.active.get(taskId); return task ? structuredClone(task) : undefined; }
  confirmed(taskId: string): TaskSnapshot | undefined { const task = this.active.get(taskId) ?? this.run?.tasks.get(taskId); return task ? structuredClone(task) : undefined; }
  get watchedTask(): TaskSnapshot | undefined { return this.watched ? structuredClone(this.watched) : undefined; }
  validateChange(entry: Change): void {
    this.control(entry);
    const task = entry.task;
    if (!stateShape(task) || size(task) > this.limits.stateBytes) fail('task_limit', 'Task state has invalid fields or exceeds stateBytes');
    const previous = this.active.get(task.taskId);
    if (entry.expectedRevision === 0) {
      if (task.taskId !== this.nextId() || task.revision !== 1 || terminal(task)) fail('task_identity', 'New task must use the next identity and revision');
      if (task.scheduleRevision !== (task.schedule ? 1 : 0) || task.schedule?.consumedByRunId) fail('task_schedule', 'New task schedule has an invalid revision or fabricated consumption');
    } else {
      if (!previous || !Number.isSafeInteger(entry.expectedRevision) || entry.expectedRevision !== previous.revision || task.revision !== previous.revision + 1) fail('task_conflict', 'Task expectedRevision does not match confirmed state');
      if (task.scheduleRevision === previous.scheduleRevision) {
        if (JSON.stringify(task.schedule) !== JSON.stringify(previous.schedule)) fail('task_schedule', 'Content update changed an existing arrangement');
      } else if (task.scheduleRevision !== previous.scheduleRevision + 1 || task.schedule?.consumedByRunId) fail('task_schedule', 'Explicit arrangement must advance one revision and start unconsumed');
    }
    if (!this.run!.tasks.has(task.taskId) && this.run!.tasks.size >= this.limits.activeTasks) fail('task_capacity', 'Run task association capacity reached');
    const items = [...this.active.values()].filter(item => item.taskId !== task.taskId).map(stateOnly);
    if (!terminal(task)) items.push(task);
    if (items.length > this.limits.activeTasks || size(items) > this.limits.activeBytes) fail('task_capacity', 'Active task capacity reached');
  }
  validateClaim(entry: Claim): void {
    this.control(entry);
    const task = this.active.get(entry.taskId);
    if (!task || task.status !== 'waiting' || !task.schedule || task.schedule.revision !== entry.scheduleRevision || task.schedule.consumedByRunId) fail('task_claim_conflict', 'Arrangement is missing or already consumed');
    if (typeof entry.checkedAt !== 'string' || !Number.isFinite(Date.parse(entry.checkedAt)) || Date.parse(entry.checkedAt) < Date.parse(task.schedule.wakeAt)) fail('task_not_due', 'Claim precedes its declared task clock deadline');
    if (!this.run!.tasks.has(task.taskId) && this.run!.tasks.size >= this.limits.activeTasks) fail('task_capacity', 'Run task association capacity reached');
  }
  observe(entry: SessionEntry): void {
    if (entry.kind === 'run_started' && entry.runId) {
      if (this.run) fail('task_run_overlap', 'Task projection requires one active run');
      this.run = { id: entry.runId, origin: entry, calls: new Map(), attempt: { runId: entry.runId, status: 'running', effects: [], omittedEffects: 0, effectTotals: { succeeded: 0, failed: 0, cancelled: 0, unknown: 0 } }, tasks: new Map() };
    } else if (entry.kind === 'tool_call' && this.run && this.run.id === entry.runId) {
      this.run.calls.set(entry.call.callId, entry.owner);
    } else if (entry.kind === 'task_changed') {
      this.validateChange(entry);
      if (entry.expectedRevision === 0) ++this.allocated;
      const previous = this.active.get(entry.task.taskId) ?? this.run!.tasks.get(entry.task.taskId);
      const task: TaskSnapshot = { ...structuredClone(entry.task), lastAttempt: structuredClone(this.run!.attempt),
        ...(previous?.effectAttempt ? { effectAttempt: structuredClone(previous.effectAttempt) } : {}) };
      if (Object.values(this.run!.attempt.effectTotals).some(count => count > 0)) task.effectAttempt = structuredClone(this.run!.attempt);
      this.run!.tasks.set(task.taskId, task);
      if (terminal(task)) this.active.delete(task.taskId); else this.active.set(task.taskId, task);
      if (task.taskId === this.watchId) this.watched = task;
    } else if (entry.kind === 'task_claimed') {
      this.validateClaim(entry);
      const task = this.active.get(entry.taskId)!;
      task.schedule!.consumedByRunId = entry.runId!;
      task.lastAttempt = structuredClone(this.run!.attempt);
      this.run!.tasks.set(task.taskId, task);
      if (task.taskId === this.watchId) this.watched = task;
    } else if (entry.kind === 'tool_outcome' && this.run && this.run.id === entry.runId) {
      this.run.calls.delete(entry.outcome.callId);
      if (entry.owner === 'agent') return;
      const effect: TaskEffect = { callId: entry.outcome.callId, toolName: entry.outcome.toolName, status: entry.outcome.status,
        ...(entry.outcome.error ? { error: { code: entry.outcome.error.code.slice(0, 128), message: entry.outcome.error.message.slice(0, 256) } } : {}) };
      this.run.attempt.effects.push(effect);
      ++this.run.attempt.effectTotals[effect.status];
      // 长标识也受字节预算；省略引用仍保留真实状态计数与归档 runId。
      this.boundAttempt(this.run.attempt);
      for (const task of this.run.tasks.values()) { task.lastAttempt = structuredClone(this.run.attempt); task.effectAttempt = structuredClone(this.run.attempt); }
    } else if (entry.kind === 'run_finished' && this.run && this.run.id === entry.runId) {
      this.run.attempt.status = entry.result.status;
      if (entry.result.code) this.run.attempt.code = entry.result.code.slice(0, 128);
      this.boundAttempt(this.run.attempt);
      for (const task of this.run.tasks.values()) {
        task.lastAttempt = structuredClone(this.run.attempt);
        if (Object.values(this.run.attempt.effectTotals).some(count => count > 0)) task.effectAttempt = structuredClone(this.run.attempt);
      }
      this.run = undefined;
    }
  }
  private control(entry: Change | Claim): void {
    if (entry.schema !== 1 || entry.sessionId !== this.sessionId || !entry.runId || this.run?.id !== entry.runId || !Number.isSafeInteger(entry.generation) || !entry.triggerId || !entry.triggerKind) fail('task_record', 'Task control lacks its active Session/run association');
    const origin = this.run.origin;
    if (entry.generation !== origin.generation || entry.triggerKind !== origin.triggerKind || entry.triggerId !== origin.triggerId || entry.source !== origin.source) fail('task_record', 'Task control changed its run association');
    if (entry.callId !== undefined && (!this.run.calls.has(entry.callId) || this.run.calls.get(entry.callId) === 'world')) fail('task_record', 'Task control has no declared Agent call');
    const base = { ...this.run.attempt, effects: [] };
    if (size(base) > this.limits.stateBytes) fail('task_limit', 'Run association cannot fit the task attempt budget');
  }
  private boundAttempt(attempt: TaskAttempt): void {
    // 错误码只作概要提示；完整原因在归档，优先保留真实工具引用。
    if (attempt.code && size(attempt) > this.limits.stateBytes) delete attempt.code;
    while (attempt.effects.length && (attempt.effects.length > this.limits.effects || size(attempt) > this.limits.stateBytes)) { attempt.effects.shift(); ++attempt.omittedEffects; }
  }
}
export function stateOnly(task: TaskSnapshot): TaskState { const { lastAttempt: _attempt, effectAttempt: _effect, ...state } = task; return structuredClone(state); }
function terminal(task: TaskState): boolean { return task.status === 'completed' || task.status === 'cancelled'; }
function size(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function fail(code: string, message: string): never { throw new InputError(code, message); }
function stateShape(task: TaskState): boolean {
  if (!task || typeof task !== 'object' || Object.keys(task).some(key => !['taskId', 'revision', 'intent', 'data', 'status', 'scheduleRevision', 'schedule'].includes(key))) return false;
  if (typeof task.taskId !== 'string' || !/^task-[1-9]\d*$/.test(task.taskId) || !Number.isSafeInteger(task.revision) || task.revision < 1 || typeof task.intent !== 'string' || !task.intent.trim()) return false;
  if (!['active', 'waiting', 'completed', 'cancelled'].includes(task.status) || !Number.isSafeInteger(task.scheduleRevision) || task.scheduleRevision < 0 || !jsonObject(task.data)) return false;
  const schedule = task.schedule;
  return !schedule || typeof schedule === 'object' && Object.keys(schedule).every(key => ['revision', 'wakeAt', 'consumedByRunId'].includes(key)) && schedule.revision === task.scheduleRevision && typeof schedule.wakeAt === 'string' && Number.isFinite(Date.parse(schedule.wakeAt)) && (schedule.consumedByRunId === undefined || typeof schedule.consumedByRunId === 'string' && !!schedule.consumedByRunId);
}
export function jsonObject(value: unknown): value is import('../protocol/index.ts').JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(jsonValue); }
function jsonValue(value: unknown): boolean { return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(jsonValue) || jsonObject(value); }
