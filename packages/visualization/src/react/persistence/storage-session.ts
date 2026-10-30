/** Key-scoped ordering keeps outstanding writes ahead of a source-revision remount's load. */
import type { CanvasViewStorage, CanvasWorkspaceView } from '../model/workspace.ts';

const pending = new WeakMap<CanvasViewStorage, Map<string, Promise<void>>>();

export async function loadWorkspace(storage: CanvasViewStorage, key: string): Promise<CanvasWorkspaceView | undefined> {
  await pending.get(storage)?.get(key);
  return storage.load(key);
}

export function saveWorkspace(storage: CanvasViewStorage, key: string, view: CanvasWorkspaceView): Promise<void> {
  let keys = pending.get(storage);
  if (!keys) { keys = new Map(); pending.set(storage, keys); }
  const previous = keys.get(key) ?? Promise.resolve();
  const write = () => storage.save(key, view);
  const next = previous.then(write, write);
  keys.set(key, next);
  const release = () => { if (keys!.get(key) === next) keys!.delete(key); };
  void next.then(release, release);
  return next;
}
