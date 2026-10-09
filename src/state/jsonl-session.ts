/** JSONL confirms serialized appends and scans fixed file snapshots; it does not repair or fsync records. */
import { appendFile, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionEntry, SessionStore } from '../protocol/index.ts';

/** 单条记录读取/追加边界；超过时明确失败，不能截掉 Provider 原生项或工具回执。 */
export const STANDARD_SESSION_RECORD_BYTES = 16 * 1024 * 1024;

export class JsonlSessionStore implements SessionStore {
  /** 写入失败保留在链上，后续追加和读取一并失败，不自动越过损坏位置。 */
  private writeQueue: Promise<void> = Promise.resolve();
  private directoryReady: Promise<void> | undefined;
  private readonly path: string;
  readonly recordBytes: number;

  constructor(path: string, recordBytes = STANDARD_SESSION_RECORD_BYTES) {
    if (!Number.isSafeInteger(recordBytes) || recordBytes < 1) throw new Error('Invalid Session recordBytes');
    this.path = path; this.recordBytes = recordBytes;
  }

  append(entry: SessionEntry): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const line = `${JSON.stringify(entry)}\n`;
      if (Buffer.byteLength(line) > this.recordBytes) throw new Error(`Session record exceeds ${this.recordBytes} bytes`);
      await (this.directoryReady ??= mkdir(dirname(this.path), { recursive: true }).then(() => undefined));
      // 完成表示 appendFile 已返回；此处没有 fsync 或多条记录的原子提交。
      await appendFile(this.path, line, 'utf8');
    });
    return this.writeQueue;
  }

  async read(): Promise<readonly SessionEntry[]> {
    const entries: SessionEntry[] = [];
    for await (const entry of this.scan()) entries.push(entry);
    return entries;
  }

  async *scan(signal?: AbortSignal): AsyncIterable<SessionEntry> {
    // 捕获确认后的文件长度，扫描期间的新追加不会混入这个读取视图。
    await this.writeQueue;
    signal?.throwIfAborted();
    let file;
    try { file = await open(this.path, 'r'); }
    catch (error) { if (isNodeError(error) && error.code === 'ENOENT') return; throw error; }
    try {
      const size = (await file.stat()).size;
      const chunk = Buffer.alloc(64 * 1024);
      let position = 0, length = 0, row = 0;
      let parts: Buffer[] = [];
      const parse = (): SessionEntry => {
        ++row;
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, length));
        const entry: unknown = JSON.parse(text);
        if (!entry || typeof entry !== 'object' || !('kind' in entry) || typeof entry.kind !== 'string') throw new Error(`Invalid Session entry at row ${row}`);
        return entry as SessionEntry;
      };
      while (position < size) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, size - position), position);
        if (!bytesRead) throw new Error(`Session changed while scanning at byte ${position}`);
        position += bytesRead;
        let start = 0;
        for (let index = 0; index < bytesRead; index++) {
          if (chunk[index] !== 10) continue;
          const part = Buffer.from(chunk.subarray(start, index));
          parts.push(part); length += part.length;
          if (length + 1 > this.recordBytes) throw new Error(`Session row ${row + 1} exceeds ${this.recordBytes} bytes`);
          if (length) { try { yield parse(); } catch (error) { throw new Error(`Session row ${row}: ${String(error)}`, { cause: error }); } }
          parts = []; length = 0; start = index + 1;
        }
        if (start < bytesRead) { const part = Buffer.from(chunk.subarray(start, bytesRead)); parts.push(part); length += part.length; }
        if (length + 1 > this.recordBytes) throw new Error(`Session row ${row + 1} exceeds ${this.recordBytes} bytes`);
      }
      // 完整 JSON 但没有行终止符同样未确认，不自动补齐或截断。
      if (length) throw new Error(`Session has an unconfirmed tail at row ${row + 1}`);
    } finally { await file.close(); }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
