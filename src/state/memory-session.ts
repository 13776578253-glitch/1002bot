/** An instance-local Session confirms bounded serialized records and scans fixed snapshots. */
import type { SessionEntry, SessionStore } from '../protocol/index.ts';
import { STANDARD_SESSION_RECORD_BYTES } from './jsonl-session.ts';

/** JSON UTF-8 budgets include each record's line terminator. */
export interface MemorySessionLimits {
  /** 单条确认记录字节上限，与 JSONL 默认边界一致。 */
  recordBytes?: number;
  /** 本实例累计记录字节上限；达到上限明确失败。 */
  bytes?: number
}
export const STANDARD_MEMORY_SESSION_BYTES = 256 * 1024 * 1024;

export class MemorySessionStore implements SessionStore {
  readonly recordBytes: number;
  readonly capacityBytes: number;
  private readonly records: string[] = [];
  private bytes = 0;
  /** 追加失败保留在队列上，后续读写共同失败。 */
  private tail: Promise<void> = Promise.resolve();
  constructor(limits: MemorySessionLimits = {}) {
    this.recordBytes = limits.recordBytes ?? STANDARD_SESSION_RECORD_BYTES;
    this.capacityBytes = limits.bytes ?? STANDARD_MEMORY_SESSION_BYTES;
    if (![this.recordBytes, this.capacityBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid memory Session capacity');
  }
  append(entry: SessionEntry): Promise<void> {
    // 在调用边界冻结 JSON 值，后续修改调用方对象不会改变待确认记录。
    let line: string;
    try { line = JSON.stringify(entry) + '\n'; }
    catch (error) { this.tail = this.tail.then(() => { throw error; }); return this.tail; }
    this.tail = this.tail.then(() => {
      const bytes = Buffer.byteLength(line);
      if (bytes > this.recordBytes || this.bytes + bytes > this.capacityBytes) throw new Error('Memory Session capacity reached');
      this.records.push(line); this.bytes += bytes;
    });
    return this.tail;
  }
  async read(): Promise<readonly SessionEntry[]> {
    const result: SessionEntry[] = [];
    for await (const entry of this.scan()) result.push(entry);
    return result;
  }
  async *scan(signal?: AbortSignal): AsyncIterable<SessionEntry> {
    await this.tail;
    signal?.throwIfAborted();
    const length = this.records.length;
    // 每条读取独立解析；扫描开始后的追加不进入本次确认视图。
    for (let index = 0; index < length; index++) { signal?.throwIfAborted(); yield JSON.parse(this.records[index]!) as SessionEntry; }
  }
}
