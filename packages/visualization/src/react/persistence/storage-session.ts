/** Storage session owns per-key write ordering; loads wait for outstanding saves so a remount cannot read stale data. */
import type { CanvasViewStorage, CanvasWorkspaceView } from '../model/workspace.ts';

/** 每个存储实例、每个键一条待完成写入链；完成后释放。 */
const pending = new WeakMap<CanvasViewStorage, Map<string, Promise<void>>>();

/** 读取前等待同键未完成写入；没有待写入时直接读取。 */
export async function loadWorkspace(storage: CanvasViewStorage, key: string): Promise<CanvasWorkspaceView | undefined> {
  await pending.get(storage)?.get(key);
  return storage.load(key);
}

/** 同键写入串行化；前一次失败不阻塞下一次写入。 */
export function saveWorkspace(storage: CanvasViewStorage, key: string, view: CanvasWorkspaceView): Promise<void> {
  let keys = pending.get(storage);
  if (!keys) { keys = new Map(); pending.set(storage, keys); }
  const previous = keys.get(key) ?? Promise.resolve();
  const write = () => storage.save(key, view);
  // 成功和失败都继续写入，避免一次失败卡住同键队列。
  const next = previous.then(write, write);
  keys.set(key, next);
  // 只在仍是最新链时删除键，避免删掉后续写入。
  const release = () => { if (keys!.get(key) === next) keys!.delete(key); };
  void next.then(release, release);
  return next;
}
