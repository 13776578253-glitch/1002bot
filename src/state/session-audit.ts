/** Recovery diagnoses archived execution without replaying inputs or changing tool effect classifications. */
import type { SessionEntry, SessionIssue, Event, UserInput, OperationOrigin, OperationRecord, ToolEffects, RunOrigin } from '../protocol/index.ts';
import { InputError, operationKey } from '../protocol/index.ts';
const kinds = new Set(['world_stream_registered', 'trigger_received', 'heartbeat', 'input', 'run_started', 'run_finished', 'event', 'provider_request', 'provider_response', 'tool_call', 'tool_outcome', 'task_changed', 'task_claimed', 'operation_detached', 'operation_late']);

interface Run { calls: Map<string, { name: string; owner?: 'world' | 'agent'; effects?: ToolEffects; worldId?: string }>; started: boolean; requests: number;
  association?: { generation: SessionEntry['generation']; triggerKind: SessionEntry['triggerKind']; triggerId: SessionEntry['triggerId']; source: SessionEntry['source'] } }
export class SessionAudit {
  private readonly receipts = new Map<string, number>();
  private readonly runs = new Map<string, Run>();
  private readonly legacyCalls = new Map<string, string>();
  /** 撤权登记跨越原 run 终态，迟到结算不重开普通运行。 */
  private readonly detached = new Map<string, OperationOrigin>();
  readonly issues: SessionIssue[] = [];
  issueCount = 0;
  records = 0;
  legacyWorld = 0;
  private readonly pendingLimit: number;
  private readonly sessionId: string | undefined;
  constructor(pendingLimit: number, sessionId?: string) { this.pendingLimit = pendingLimit; this.sessionId = sessionId; }
  issue(code: string, message: string, entry?: SessionEntry | RunOrigin): void {
    ++this.issueCount;
    const origin = entry && 'kind' in entry && (entry.kind === 'operation_detached' || entry.kind === 'operation_late') ? entry.origin : entry;
    if (this.issues.length < 64) this.issues.push({ code, message: message.slice(0, 1024), record: this.records,
      ...(origin?.runId ? { runId: origin.runId } : {}), ...(origin?.triggerId ? { triggerId: origin.triggerId } : {}) });
  }
  append(entry: SessionEntry): void {
    ++this.records;
    if (!kinds.has(entry.kind) || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)) || entry.runId !== undefined && (typeof entry.runId !== 'string' || !entry.runId)) throw new InputError('session_schema', 'Session entry has an unsupported kind, time or run identity');
    if (entry.kind === 'operation_detached' || entry.kind === 'operation_late') {
      // 独立关联只存 origin，禁止混入普通运行组或推进来源结算水位。
      if (entry.runId !== undefined || entry.delivery !== undefined || entry.generation !== undefined || entry.triggerKind !== undefined
        || entry.triggerId !== undefined || entry.source !== undefined) throw new InputError('session_schema', 'Independent operation records cannot carry ordinary run authority');
      this.operation(entry);
      if (this.detached.size > this.pendingLimit) throw new Error('Recovery detached operations exceed capacity');
      return;
    }
    if (entry.kind === 'event' && !eventShape(entry.event) || entry.kind === 'input' && !inputShape(entry.input)) throw new InputError('session_schema', 'Execution input has an invalid shape');
    if (entry.kind === 'provider_response' && (!entry.response || !['stop', 'tool_calls', 'length', 'error'].includes(entry.response.finishReason) || !Array.isArray(entry.response.toolCalls))) throw new InputError('session_schema', 'Provider response has an invalid protocol header');
    if (entry.kind === 'tool_call' && (!entry.call || typeof entry.call.callId !== 'string' || !entry.call.callId || typeof entry.call.toolName !== 'string' || !entry.call.toolName)) throw new InputError('session_schema', 'Tool declaration has an invalid identity');
    if (entry.kind === 'tool_outcome' && (!entry.outcome || !['succeeded', 'failed', 'cancelled', 'unknown'].includes(entry.outcome.status) || typeof entry.outcome.callId !== 'string' || typeof entry.outcome.toolName !== 'string')) throw new InputError('session_schema', 'Tool receipt has an invalid identity or effect classification');
    if ((entry.kind === 'tool_call' || entry.kind === 'tool_outcome') && entry.owner !== undefined && entry.owner !== 'world' && entry.owner !== 'agent') throw new InputError('session_schema', 'Tool record has an invalid owner');
    if (entry.kind === 'tool_call' && entry.effects !== undefined && entry.effects !== 'none' && entry.effects !== 'external') throw new InputError('session_schema', 'Tool effect capability is unsupported');
    if (entry.kind === 'world_stream_registered') return;
    if (entry.kind === 'event' && !entry.delivery) ++this.legacyWorld;
    if (entry.kind === 'trigger_received') {
      if (!entry.trigger || !['user_input', 'world_event', 'heartbeat'].includes(entry.trigger.kind) || entry.triggerKind !== entry.trigger.kind || typeof entry.triggerId !== 'string' || !entry.triggerId || !Number.isSafeInteger(entry.queueSequence) || entry.queueSequence < 1) throw new InputError('session_schema', 'Saved receipt has invalid trigger association or sequence');
      if (entry.trigger.kind === 'world_event' && !eventShape(entry.trigger.event) || entry.trigger.kind === 'user_input' && !inputShape(entry.trigger.input)) throw new InputError('session_schema', 'Saved receipt has invalid source facts');
      const id = receiptKey(entry);
      if (this.receipts.has(id)) this.issue('receipt_conflict', 'A receipt identity was repeated before settlement', entry);
      this.receipts.set(id, this.records);
      if (entry.trigger.kind === 'world_event' && !entry.delivery) ++this.legacyWorld;
    }
    if (entry.runId && entry.kind !== 'trigger_received') {
      let run = this.runs.get(entry.runId);
      if (!run) { run = { calls: new Map(), started: false, requests: 0 }; this.runs.set(entry.runId, run); }
      if (entry.kind === 'run_started') {
        if (run.started) this.issue('run_conflict', 'Run has more than one start', entry);
        run.started = true;
        run.association = { generation: entry.generation, triggerKind: entry.triggerKind, triggerId: entry.triggerId, source: entry.source };
      }
      if (entry.kind === 'provider_request') ++run.requests;
      if (entry.kind === 'tool_call') {
        if (run.calls.has(entry.call.callId)) this.issue('tool_conflict', 'Tool identity was declared twice', entry);
        run.calls.set(entry.call.callId, { name: entry.call.toolName, ...(entry.owner ? { owner: entry.owner } : {}), ...(entry.effects ? { effects: entry.effects } : {}), ...(entry.worldId ? { worldId: entry.worldId } : {}) });
      }
      if (entry.kind === 'tool_outcome') {
        const declared = run.calls.get(entry.outcome.callId);
        if (declared?.name !== entry.outcome.toolName && entry.outcome.status !== 'cancelled') this.issue('tool_pairing', 'Tool outcome has no matching declared call', entry);
        // 新记录的调用和回执必须保持归属；旧日志未声明 owner 时沿用兼容配对。
        if (declared?.owner !== undefined && declared.owner !== entry.owner) this.issue('tool_owner', 'Tool outcome changed its declared owner', entry);
        run.calls.delete(entry.outcome.callId);
        if (entry.outcome.status === 'unknown') this.issue('tool_unknown', 'Archived tool effect is unknown', entry);
      }
      if (entry.kind === 'run_finished') {
        if (run.calls.size) this.issue('tool_unsettled', 'Run ended with missing tool receipts', entry);
        this.runs.delete(entry.runId);
      }
    } else if (entry.kind === 'tool_call') this.legacyCalls.set(entry.call.callId, entry.call.toolName);
    else if (entry.kind === 'tool_outcome') {
      if (this.legacyCalls.get(entry.outcome.callId) !== entry.outcome.toolName || entry.outcome.status === 'unknown') this.issue('legacy_effect', 'Legacy tool effect cannot be safely associated', entry);
      this.legacyCalls.delete(entry.outcome.callId);
    }
    if (entry.kind === 'run_finished') {
      if (!entry.result || !['succeeded', 'failed', 'cancelled'].includes(entry.result.status) || typeof entry.result.persisted !== 'boolean') throw new InputError('session_schema', 'Saved terminal has an invalid result');
      if (!this.receipts.delete(receiptKey(entry))) this.issue('terminal_receipt', 'Terminal lacks an admitted receipt', entry);
      if (!entry.result.persisted || entry.result.code === 'storage_error') this.issue('storage_error', 'Archived terminal reports a storage failure', entry);
    }
    if (this.receipts.size + this.runs.size + this.legacyCalls.size + this.detached.size > this.pendingLimit) throw new Error('Recovery pending identities exceed capacity');
  }
  private operation(entry: OperationRecord): void {
    const origin = entry.origin;
    if (entry.schema !== 1 || !originShape(origin) || this.sessionId !== undefined && origin.sessionId !== this.sessionId) throw new InputError('session_schema', 'Operation record has invalid schema or original identity');
    const key = operationKey(origin);
    if (entry.kind === 'operation_detached') {
      if (!errorShape(entry.reason)) throw new InputError('session_schema', 'Operation detachment has no valid reason');
      const run = this.runs.get(origin.runId), association = run?.association;
      const call = origin.kind === 'world' ? run?.calls.get(origin.callId) : undefined;
      // 撤权时核验仍活动的原声明；独立登记随后可跨越该 run 的普通终态。
      if (!run?.started || !association || association.generation !== origin.generation || association.triggerKind !== origin.triggerKind
        || association.triggerId !== origin.triggerId || association.source !== origin.source
        || (origin.kind === 'world' ? origin.effects !== 'none' || call?.effects !== 'none' || call.name !== origin.toolName || call.worldId !== origin.worldId || call.owner === 'agent' : origin.round !== run.requests)) {
        this.issue('operation_pairing', 'Detachment lacks its original active read or model call', entry);
      }
      if (this.detached.has(key)) this.issue('operation_conflict', 'Operation was detached twice', entry);
      this.detached.set(key, structuredClone(origin));
    } else {
      const previous = this.detached.get(key);
      // 原运行组可能已经移除，迟到配对仍须匹配完整原关联。
      if (!previous || !sameOrigin(previous, origin)) this.issue('operation_pairing', 'Late record lacks matching detachment', entry);
      const result = entry.result;
      if (!result || !['returned', 'failed', 'discarded'].includes(result.status)) throw new InputError('session_schema', 'Late result classification is invalid');
      if (result.status === 'returned') {
        const outcome = result.outcome;
        if (origin.kind !== 'world' || origin.effects !== 'none' || !outcome || outcome.callId !== origin.callId || outcome.toolName !== origin.toolName
          || !['succeeded', 'failed', 'cancelled', 'unknown'].includes(outcome.status)) throw new InputError('session_schema', 'Late receipt differs from its read call');
        if (outcome.status === 'unknown') this.issue('tool_unknown', 'Read-only late receipt reports an unknown effect', entry);
      } else if (!errorShape(result.error) || result.outcome !== undefined) throw new InputError('session_schema', 'Late failure or discard has invalid diagnostic');
      if (result.error?.code === 'invalid_late_outcome') this.issue('operation_pairing', 'Late World receipt failed its original-call contract', entry);
      this.detached.delete(key);
    }
  }
  finish(): void {
    if (this.receipts.size) this.issue('receipt_unsettled', `${this.receipts.size} saved receipts have no terminal`);
    if (this.runs.size) this.issue('run_unsettled', `${this.runs.size} runs have no terminal`);
    if (this.legacyCalls.size) this.issue('legacy_unsettled', `${this.legacyCalls.size} legacy tools lack receipts`);
    // 归档结束仍缺结算时只报告阻断，不重建或重发旧调用。
    if (this.detached.size) this.issue('operation_unsettled', `${this.detached.size} detached operations lack final records`, this.detached.values().next().value);
  }
}
function originShape(origin: OperationOrigin): boolean {
  return !!origin && typeof origin === 'object' && [origin.sessionId, origin.runId, origin.triggerId, origin.source].every(value => typeof value === 'string' && !!value)
    && Number.isSafeInteger(origin.generation) && origin.generation > 0 && ['user_input', 'world_event', 'heartbeat'].includes(origin.triggerKind)
    && (origin.kind === 'world' ? typeof origin.worldId === 'string' && !!origin.worldId && typeof origin.callId === 'string' && !!origin.callId && typeof origin.toolName === 'string' && !!origin.toolName
      && origin.effects === 'none' : origin.kind === 'provider' && Number.isSafeInteger(origin.round) && origin.round > 0);
}
function sameOrigin(a: OperationOrigin, b: OperationOrigin): boolean {
  return operationKey(a) === operationKey(b) && a.triggerKind === b.triggerKind && a.triggerId === b.triggerId && a.source === b.source
    && (a.kind === 'provider' || b.kind === 'world' && a.worldId === b.worldId && a.toolName === b.toolName && a.effects === b.effects);
}
function errorShape(value: { code: string; message: string } | undefined): boolean { return !!value && typeof value.code === 'string' && !!value.code && typeof value.message === 'string'; }
function receiptKey(entry: SessionEntry): string { return JSON.stringify([entry.triggerKind, entry.triggerId, entry.generation]); }
function eventShape(event: Event): boolean {
  return !!event && typeof event === 'object' && typeof event.id === 'string' && typeof event.source === 'string' && typeof event.type === 'string' && typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt)) && 'payload' in event;
}
function inputShape(input: UserInput): boolean {
  return !!input && typeof input.inputId === 'string' && typeof input.source === 'string' && !!input.content && input.content.kind === 'text' && typeof input.content.text === 'string' && !!input.content.text.trim();
}
