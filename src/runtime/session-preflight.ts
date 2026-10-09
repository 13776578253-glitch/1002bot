/** Preflight reads confirmed facts without opening World resources or advancing archived execution. */
import type { DeliveryLimits, HistoryLimits, SessionDiagnosis, SessionStore, WorldStream } from '../protocol/index.ts';
import { InputError, STANDARD_INPUT_LIMITS } from '../protocol/index.ts';
import { WorldDeliveryState } from './world-delivery-state.ts';
import { HistoryWindow } from '../state/history-window.ts';
import { SessionAudit } from '../state/session-audit.ts';

export interface SessionInspectionOptions {
  worldId: string;
  sessionId: string;
  worldStreams?: readonly WorldStream[];
  deliveryLimits?: Partial<DeliveryLimits>;
  historyLimits?: Partial<HistoryLimits>;
  admissionIds?: number;
}
export async function preflightSession(store: SessionStore, options: SessionInspectionOptions, signal?: AbortSignal) {
  const state = new WorldDeliveryState(options.worldId, options.sessionId, options.worldStreams ?? [], options.deliveryLimits);
  const window = new HistoryWindow(options.historyLimits);
  const audit = new SessionAudit((options.admissionIds ?? STANDARD_INPUT_LIMITS.admissionIds) + state.limits.legacyIds + state.limits.positions + 1);
  if (!store.scan) {
    const diagnosis: SessionDiagnosis = { status: state.ordered ? 'blocked' : 'legacy_store', records: 0, issueCount: state.ordered ? 1 : 0,
      issues: [{ code: 'session_capability', message: 'Ordered delivery requires Session.scan; legacy storage has no bounded recovery guarantee' }], history: window.stats };
    return { state, window: undefined, diagnosis };
  }
  try {
    for await (const entry of store.scan(signal)) {
      signal?.throwIfAborted();
      audit.append(entry); state.observe(entry); window.append(entry);
    }
    audit.finish();
    if (state.ordered && audit.legacyWorld && state.registrations().length) audit.issue('legacy_source_boundary', 'Legacy World facts lack a trusted boundary for ordered source registration');
  } catch (error) {
    signal?.throwIfAborted();
    audit.issue(error instanceof InputError ? error.code : 'session_read', error instanceof Error ? error.message : String(error));
  }
  signal?.throwIfAborted();
  const diagnosis: SessionDiagnosis = { status: audit.issueCount ? 'blocked' : 'ready', records: audit.records, issueCount: audit.issueCount, issues: audit.issues, history: window.stats };
  return { state, window, diagnosis };
}

/** 只读结果表示该快照的重启条件；不会停止正在运行的 Runtime，也不补写登记。 */
export async function diagnoseSession(store: SessionStore, options: SessionInspectionOptions): Promise<SessionDiagnosis> {
  return (await preflightSession(store, options)).diagnosis;
}
