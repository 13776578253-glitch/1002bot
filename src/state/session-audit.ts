/** Recovery diagnoses archived execution without replaying inputs or changing tool effect classifications. */
import type { SessionEntry, SessionIssue, Event, UserInput } from '../protocol/index.ts';
import { InputError } from '../protocol/index.ts';
const kinds = new Set(['world_stream_registered', 'trigger_received', 'heartbeat', 'input', 'run_started', 'run_finished', 'event', 'provider_request', 'provider_response', 'tool_call', 'tool_outcome', 'task_changed', 'task_claimed']);

interface Run { calls: Map<string, { name: string; owner?: 'world' | 'agent' }>; started: boolean }
export class SessionAudit {
  private readonly receipts = new Map<string, number>();
  private readonly runs = new Map<string, Run>();
  private readonly legacyCalls = new Map<string, string>();
  readonly issues: SessionIssue[] = [];
  issueCount = 0;
  records = 0;
  legacyWorld = 0;
  private readonly pendingLimit: number;
  constructor(pendingLimit: number) { this.pendingLimit = pendingLimit; }
  issue(code: string, message: string, entry?: SessionEntry): void {
    ++this.issueCount;
    if (this.issues.length < 64) this.issues.push({ code, message: message.slice(0, 1024), record: this.records,
      ...(entry?.runId ? { runId: entry.runId } : {}), ...(entry?.triggerId ? { triggerId: entry.triggerId } : {}) });
  }
  append(entry: SessionEntry): void {
    ++this.records;
    if (!kinds.has(entry.kind) || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)) || entry.runId !== undefined && (typeof entry.runId !== 'string' || !entry.runId)) throw new InputError('session_schema', 'Session entry has an unsupported kind, time or run identity');
    if (entry.kind === 'event' && !eventShape(entry.event) || entry.kind === 'input' && !inputShape(entry.input)) throw new InputError('session_schema', 'Execution input has an invalid shape');
    if (entry.kind === 'provider_response' && (!entry.response || !['stop', 'tool_calls', 'length', 'error'].includes(entry.response.finishReason) || !Array.isArray(entry.response.toolCalls))) throw new InputError('session_schema', 'Provider response has an invalid protocol header');
    if (entry.kind === 'tool_call' && (!entry.call || typeof entry.call.callId !== 'string' || !entry.call.callId || typeof entry.call.toolName !== 'string' || !entry.call.toolName)) throw new InputError('session_schema', 'Tool declaration has an invalid identity');
    if (entry.kind === 'tool_outcome' && (!entry.outcome || !['succeeded', 'failed', 'cancelled', 'unknown'].includes(entry.outcome.status) || typeof entry.outcome.callId !== 'string' || typeof entry.outcome.toolName !== 'string')) throw new InputError('session_schema', 'Tool receipt has an invalid identity or effect classification');
    if ((entry.kind === 'tool_call' || entry.kind === 'tool_outcome') && entry.owner !== undefined && entry.owner !== 'world' && entry.owner !== 'agent') throw new InputError('session_schema', 'Tool record has an invalid owner');
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
      if (!run) { run = { calls: new Map(), started: false }; this.runs.set(entry.runId, run); }
      if (entry.kind === 'run_started') {
        if (run.started) this.issue('run_conflict', 'Run has more than one start', entry);
        run.started = true;
      }
      if (entry.kind === 'tool_call') {
        if (run.calls.has(entry.call.callId)) this.issue('tool_conflict', 'Tool identity was declared twice', entry);
        run.calls.set(entry.call.callId, { name: entry.call.toolName, ...(entry.owner ? { owner: entry.owner } : {}) });
      }
      if (entry.kind === 'tool_outcome') {
        const declared = run.calls.get(entry.outcome.callId);
        if (declared?.name !== entry.outcome.toolName && entry.outcome.status !== 'cancelled') this.issue('tool_pairing', 'Tool outcome has no matching declared call', entry);
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
    if (this.receipts.size + this.runs.size + this.legacyCalls.size > this.pendingLimit) throw new Error('Recovery pending identities exceed capacity');
  }
  finish(): void {
    if (this.receipts.size) this.issue('receipt_unsettled', `${this.receipts.size} saved receipts have no terminal`);
    if (this.runs.size) this.issue('run_unsettled', `${this.runs.size} runs have no terminal`);
    if (this.legacyCalls.size) this.issue('legacy_unsettled', `${this.legacyCalls.size} legacy tools lack receipts`);
  }
}
function receiptKey(entry: SessionEntry): string { return JSON.stringify([entry.triggerKind, entry.triggerId, entry.generation]); }
function eventShape(event: Event): boolean {
  return !!event && typeof event === 'object' && typeof event.id === 'string' && typeof event.source === 'string' && typeof event.type === 'string' && typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt)) && 'payload' in event;
}
function inputShape(input: UserInput): boolean {
  return !!input && typeof input.inputId === 'string' && typeof input.source === 'string' && !!input.content && input.content.kind === 'text' && typeof input.content.text === 'string' && !!input.content.text.trim();
}
