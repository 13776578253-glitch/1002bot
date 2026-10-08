/** JSONL serializes appends within one store instance; transactions and crash recovery are outside its scope. */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionEntry, SessionStore } from '../protocol/index.ts';

export class JsonlSessionStore implements SessionStore {
  /** 写入失败保留在链上，后续追加和读取一并失败，不自动越过损坏位置。 */
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) { this.path = path; }

  append(entry: SessionEntry): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      // 完成表示 appendFile 已返回；此处没有 fsync 或多条记录的原子提交。
      await appendFile(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
    });
    return this.writeQueue;
  }

  async read(): Promise<readonly SessionEntry[]> {
    // 读取等待此前已进入的追加结算，失败的写入链同样使读取失败。
    await this.writeQueue;
    try {
      const text = await readFile(this.path, 'utf8');
      return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SessionEntry);
    } catch (error) {
      // 仅文件不存在视为空历史；解析损坏与其他读取错误交给调用方处理。
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
