/** In-process key/value State is separate from Session history and provides no restart persistence. */
import type { JsonValue, StateStore } from '../protocol/index.ts';

export class MemoryState implements StateStore {
  /** 按引用保存 JSON 值，读写不复制；调用方修改对象会影响同一实例中的值。 */
  private readonly values = new Map<string, JsonValue>();

  async get(key: string): Promise<JsonValue | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: JsonValue): Promise<void> {
    this.values.set(key, value);
  }
}
