/** A bounded projection retains whole settled runs under the selected history policy. */
import type { HistoryLimits, HistoryQuery, HistoryStats, SessionEntry, SessionStore } from '../protocol/index.ts';
import { InputError, STANDARD_HISTORY_LIMITS } from '../protocol/index.ts';

interface Group { entries: SessionEntry[]; bytes: number; oversized: boolean }
export class HistoryWindow {
  private readonly groups: Group[] = [];
  private active: { id: string; group: Group } | undefined;
  private totalBytes = 0;
  private omittedRuns = 0;
  private readonly includeUnsuccessful: boolean;
  readonly limits: HistoryLimits;
  constructor(limits: Partial<HistoryLimits> = {}, includeUnsuccessful = false) {
    this.includeUnsuccessful = includeUnsuccessful;
    this.limits = Object.freeze({ ...STANDARD_HISTORY_LIMITS, ...limits });
    for (const [name, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid history ${name}`);
  }
  append(entry: SessionEntry): void {
    if (!entry.runId || entry.kind === 'trigger_received' || entry.kind === 'world_stream_registered') return;
    if (!this.active || this.active.id !== entry.runId) this.active = { id: entry.runId, group: { entries: [], bytes: 0, oversized: false } };
    const group = this.active.group;
    const size = Buffer.byteLength(JSON.stringify(entry));
    group.bytes += size;
    if (!group.oversized && group.bytes <= this.limits.bytes) group.entries.push(structuredClone(entry));
    else { group.entries = []; group.oversized = true; }
    if (entry.kind !== 'run_finished') return;
    if ((entry.result.status === 'succeeded' || this.includeUnsuccessful) && !group.oversized && complete(group.entries)) {
      this.groups.push(group); this.totalBytes += group.bytes;
      while (this.groups.length > this.limits.runs || this.totalBytes > this.limits.bytes) { this.totalBytes -= this.groups.shift()!.bytes; ++this.omittedRuns; }
    } else ++this.omittedRuns;
    this.active = undefined;
  }
  snapshot(): readonly SessionEntry[] { return structuredClone(this.groups.flatMap(group => group.entries)); }
  get stats(): HistoryStats { return { runs: this.groups.length, bytes: this.totalBytes, omittedRuns: this.omittedRuns }; }
}

/** 调用声明与回执必须完整配对；失败/取消运行保留在归档，不进入默认窗口。 */
function complete(entries: readonly SessionEntry[]): boolean {
  if (!entries.some(entry => entry.kind === 'run_started') || !entries.some(entry => entry.kind === 'event' || entry.kind === 'input' || entry.kind === 'heartbeat')) return false;
  const calls = entries.flatMap(entry => entry.kind === 'provider_response' ? entry.response.toolCalls.map(call => call.callId) : []);
  const outcomes = entries.flatMap(entry => entry.kind === 'tool_outcome' ? [entry.outcome.callId] : []);
  return calls.length === outcomes.length && new Set(calls).size === calls.length && calls.every(id => outcomes.filter(value => value === id).length === 1);
}

export async function queryHistory(store: SessionStore, limits: HistoryLimits, query: HistoryQuery = {}): Promise<readonly SessionEntry[]> {
  if (!store.scan) throw new InputError('session_capability', 'History queries require Session.scan');
  const runs = query.runs ?? limits.runs, bytes = query.bytes ?? limits.bytes;
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > limits.runs || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > limits.bytes) throw new InputError('history_limit', 'History query exceeds its declared budget');
  const window = new HistoryWindow({ ...limits, runs, bytes }, query.includeUnsuccessful);
  for await (const entry of store.scan()) {
    if (query.beforeRunId && entry.runId === query.beforeRunId) break;
    window.append(entry);
  }
  return window.snapshot();
}
