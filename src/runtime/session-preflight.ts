/** Preflight reads confirmed facts without opening World resources or advancing archived execution. */
import type { DeliveryLimits, HistoryLimits, SessionDiagnosis, SessionStore, WorldStream, TaskLimits } from '../protocol/index.ts';
import { InputError, STANDARD_INPUT_LIMITS } from '../protocol/index.ts';
import { WorldDeliveryState } from './world-delivery-state.ts';
import { HistoryWindow } from '../state/history-window.ts';
import { SessionAudit } from '../state/session-audit.ts';
import { TaskProjection } from '../state/task-projection.ts';

export interface SessionInspectionOptions {
  worldId: string;
  sessionId: string;
  worldStreams?: readonly WorldStream[];
  deliveryLimits?: Partial<DeliveryLimits>;
  historyLimits?: Partial<HistoryLimits>;
  includeUnsuccessfulHistory?: boolean;
  admissionIds?: number;
  taskLimits?: Partial<TaskLimits>;
  /** 启用任务能力时必须具有流式归档扫描口。 */
  requireTasks?: boolean;
}
export async function preflightSession(store: SessionStore, options: SessionInspectionOptions, signal?: AbortSignal) {
  const state = new WorldDeliveryState(options.worldId, options.sessionId, options.worldStreams ?? [], options.deliveryLimits);
  const window = new HistoryWindow(options.historyLimits, options.includeUnsuccessfulHistory);
  const tasks = new TaskProjection(options.sessionId, options.taskLimits);
  const audit = new SessionAudit((options.admissionIds ?? STANDARD_INPUT_LIMITS.admissionIds) + state.limits.legacyIds + state.limits.positions + 1);
  if (!store.scan) {
    const required = state.ordered || options.requireTasks;
    const diagnosis: SessionDiagnosis = { status: required ? 'blocked' : 'legacy_store', records: 0, issueCount: required ? 1 : 0,
      issues: [{ code: 'session_capability', message: 'Ordered delivery and persistent tasks require Session.scan; legacy storage has no bounded recovery guarantee' }], history: window.stats };
    return { state, window: undefined, tasks, diagnosis };
  }
  try {
    // 同一遍归档扫描校验配对并重建各投影，认领事实保留原消费身份。
    for await (const entry of store.scan(signal)) {
      signal?.throwIfAborted();
      audit.append(entry); state.observe(entry); tasks.observe(entry); window.append(entry);
    }
    audit.finish();
    if (state.ordered && audit.legacyWorld && state.registrations().length) audit.issue('legacy_source_boundary', 'Legacy World facts lack a trusted boundary for ordered source registration');
  } catch (error) {
    signal?.throwIfAborted();
    audit.issue(error instanceof InputError ? error.code : 'session_read', error instanceof Error ? error.message : String(error));
  }
  signal?.throwIfAborted();
  const diagnosis: SessionDiagnosis = { status: audit.issueCount ? 'blocked' : 'ready', records: audit.records, issueCount: audit.issueCount, issues: audit.issues, history: window.stats };
  return { state, window, tasks, diagnosis };
}

/** 只读结果表示该快照的重启条件；不会停止正在运行的 Runtime，也不补写登记。 */
export async function diagnoseSession(store: SessionStore, options: SessionInspectionOptions): Promise<SessionDiagnosis> {
  return (await preflightSession(store, options)).diagnosis;
}
