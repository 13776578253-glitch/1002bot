/** An exclusive bounded journal preserves native mappings and envelopes in file or instance-local memory. */
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WorldDelivery, ToolOutcome } from '1002bot/protocol';
import { object, type QQBinding, type QQLimits } from './config.ts';
import type { MessageSnapshot } from './normalize.ts';

export type JournalRow =
  | { kind: 'binding'; schema: 1; binding: QQBinding }
  | { kind: 'received'; key: string; message: MessageSnapshot; delivery: WorldDelivery }
  | { kind: 'saved'; sequence: number }
  | { kind: 'intent'; operationId: string; callId: string; text: string; at: string }
  | { kind: 'result'; operationId: string; outcome: ToolOutcome; message?: MessageSnapshot }
  | { kind: 'diagnostic'; code: string; message: string; at: string };

export class QQJournal {
  private file: FileHandle | undefined;
  private lock: FileHandle | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private mutationTail: Promise<unknown> = Promise.resolve();
  private poisoned: Error | undefined;
  /** 内存模式保存同一实例的确认记录；stop/start 保留，新 World 实例清空。 */
  private readonly memoryRows: string[] | undefined;
  private memoryOpen = false;
  bytes = 0;
  sequence = 0;
  saved = 0;
  private readonly path: string | undefined;
  private readonly binding: QQBinding;
  private readonly limits: QQLimits;
  constructor(path: string | undefined, binding: QQBinding, limits: QQLimits) { this.path = path; this.binding = binding; this.limits = limits; this.memoryRows = path === undefined ? [] : undefined; }

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.memoryRows) {
      this.memoryOpen = true;
      if (!this.memoryRows.length) await this.append({ kind: 'binding', schema: 1, binding: this.binding });
      return;
    }
    const path = this.path!;
    await mkdir(dirname(path), { recursive: true });
    const lockPath = path + '.lock';
    try { this.lock = await open(lockPath, 'wx'); }
    catch (error) {
      if (!object(error) || error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number };
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid QQ journal lock');
      try { process.kill(owner.pid, 0); throw new Error('QQ journal is already in use'); }
      catch (probe) { if (!object(probe) || probe.code !== 'ESRCH') throw probe; }
      await unlink(lockPath); this.lock = await open(lockPath, 'wx');
    }
    try {
      signal.throwIfAborted();
      await this.lock.writeFile(JSON.stringify({ pid: process.pid }));
      this.file = await open(path, 'a+');
      this.bytes = (await this.file.stat()).size;
      if (this.bytes > this.limits.journalBytes) throw new Error('QQ journal exceeds configured capacity');
      let bound = false; this.sequence = 0; this.saved = 0; this.poisoned = undefined; this.tail = Promise.resolve();
      for await (const row of this.rows()) {
        signal.throwIfAborted();
        if (row.kind === 'binding') {
          if (bound || JSON.stringify(row.binding) !== JSON.stringify(this.binding) || row.schema !== 1) throw new Error('QQ journal binding conflict');
          bound = true;
        } else {
          if (!bound) throw new Error('QQ journal has no binding');
          if (row.kind === 'received') {
            const d = row.delivery;
            if (d.sequence !== this.sequence + 1 || d.streamId !== this.binding.streamId || d.epoch !== this.binding.epoch || d.event.source !== this.binding.worldId) throw new Error('QQ journal sequence conflict');
            this.sequence = d.sequence;
          } else if (row.kind === 'saved') {
            if (!Number.isSafeInteger(row.sequence) || row.sequence < this.saved || row.sequence > this.sequence) throw new Error('QQ journal saved prefix conflict');
            this.saved = row.sequence;
          }
        }
      }
      if (!bound) await this.append({ kind: 'binding', schema: 1, binding: this.binding });
    } catch (error) { await this.close(); throw error; }
  }
  append(row: JournalRow, capture = false): Promise<void> {
    const work = this.tail.then(async () => {
      if (this.poisoned) throw this.poisoned;
      if (!this.file && !this.memoryOpen) throw new Error('QQ journal is closed');
      const line = Buffer.from(JSON.stringify(row) + '\n');
      if (line.length > this.rowBytes || this.bytes + line.length > this.limits.journalBytes - (capture ? this.limits.reserveBytes : 0)) throw new Error('QQ journal capacity reached');
      if (this.memoryRows) { this.memoryRows.push(line.toString('utf8')); this.bytes += line.length; return; }
      // 一次追加完成前不发布身份；短写循环完成，失败后禁止在破损尾部继续写。
      let offset = 0;
      try {
        while (offset < line.length) {
          const { bytesWritten } = await this.file!.write(line, offset, line.length - offset);
          if (!bytesWritten) throw new Error('QQ journal made no write progress');
          offset += bytesWritten;
        }
        this.bytes += line.length;
      } catch (error) { this.poisoned = error instanceof Error ? error : new Error(String(error)); throw error; }
    });
    this.tail = work.catch(() => undefined); return work;
  }
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.mutationTail.then(work);
    this.mutationTail = task.catch(() => undefined); return task;
  }
  commitResult(row: Extract<JournalRow, { kind: 'result' }>): Promise<void> {
    return this.exclusive(async () => {
      if (row.message && await this.findMessage(JSON.stringify([row.message.accountId, row.message.conversation.kind, row.message.conversation.id, row.message.messageId]))) throw new Error('Confirmed message_id collides with an existing native binding');
      await this.append(row);
    });
  }
  private get rowBytes(): number { return Math.max(this.limits.eventBytes * 2 + 4096, this.limits.textBytes * 2 + 4096); }
  async *rows(): AsyncIterable<JournalRow> {
    if (this.memoryRows) {
      const end = this.memoryRows.length;
      for (let index = 0; index < end; index++) yield JSON.parse(this.memoryRows[index]!) as JournalRow;
      return;
    }
    const stream = createReadStream(this.path!, { highWaterMark: 64 * 1024 });
    const end = this.bytes;
    let consumed = 0, rest = Buffer.alloc(0);
    try {
      for await (const raw of stream) {
        const chunk = (raw as Buffer).subarray(0, end - consumed); consumed += chunk.length;
        rest = Buffer.concat([rest, chunk]);
        let newline: number;
        while ((newline = rest.indexOf(10)) >= 0) {
          if (newline > this.rowBytes) throw new Error('QQ journal record exceeds capacity');
          const row: unknown = JSON.parse(rest.subarray(0, newline).toString('utf8'));
          if (!object(row) || !['binding', 'received', 'saved', 'intent', 'result', 'diagnostic'].includes(String(row.kind))) throw new Error('Invalid QQ journal record');
          yield row as JournalRow; rest = rest.subarray(newline + 1);
        }
        if (rest.length > this.rowBytes) throw new Error('QQ journal record exceeds capacity');
        if (consumed >= end) break;
      }
      if (rest.length) throw new Error('QQ journal has an incomplete tail; inspect before recovery');
    } finally { stream.destroy(); }
  }
  async findMessage(key: string): Promise<MessageSnapshot | undefined> {
    for await (const row of this.rows()) {
      if (row.kind === 'received' && row.key === key) return row.message;
      if (row.kind === 'result' && row.message && JSON.stringify([row.message.accountId, row.message.conversation.kind, row.message.conversation.id, row.message.messageId]) === key) return row.message;
    }
  }
  async delivery(sequence: number): Promise<WorldDelivery | undefined> {
    for await (const row of this.rows()) if (row.kind === 'received' && row.delivery.sequence === sequence) return row.delivery;
  }
  async close(): Promise<void> {
    await this.mutationTail;
    await this.tail;
    this.memoryOpen = false;
    const file = this.file, lock = this.lock; this.file = undefined; this.lock = undefined;
    try { await file?.close(); }
    finally { if (lock) { await lock.close(); await unlink(this.path + '.lock'); } }
  }
}
