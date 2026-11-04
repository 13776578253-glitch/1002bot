/** localStorage adapter for persisted canvas workspaces; schema normalization lives in workspace-schema.ts. */
import type { CanvasViewStorage } from '../model/workspace.ts';
import { normalizeWorkspaceView } from './workspace-schema.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createLocalStorageViewStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): CanvasViewStorage {
  return {
    load(key) {
      const text = storage.getItem(key);
      if (text === null) return undefined;
      const view: unknown = JSON.parse(text);
      return normalizeWorkspaceView(view);
    },
    save(key, view) {
      normalizeWorkspaceView(view);
      const original = storage.getItem(key);
      const uniformCardsBackup = `${key}:before-uniform-cards-v1`;
      if (original !== null && storage.getItem(uniformCardsBackup) === null) storage.setItem(uniformCardsBackup, original);
      const backupKey = `${key}:before-three-views-v1`;
      if (original !== null) {
        const previous: unknown = JSON.parse(original);
        normalizeWorkspaceView(previous);
        if (view.views && storage.getItem(backupKey) === null && isRecord(previous) && previous.views === undefined) storage.setItem(backupKey, original);
      }
      storage.setItem(key, JSON.stringify(view));
    },
  };
}
