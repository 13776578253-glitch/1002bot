/** localStorage adapter for persisted canvas workspaces; schema normalization lives in workspace-schema.ts. */
import type { CanvasViewStorage } from '../model/workspace.ts';
import { normalizeWorkspaceView } from './workspace-schema.ts';

const UNIFORM_CARDS_BACKUP = 'before-uniform-cards-v1';
const THREE_VIEWS_BACKUP = 'before-three-views-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createLocalStorageViewStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): CanvasViewStorage {
  return {
    load(key) {
      // 缺少记录返回 undefined；JSON 或结构非法直接抛给调用方。
      const text = storage.getItem(key);
      if (text === null) return undefined;
      const view: unknown = JSON.parse(text);
      return normalizeWorkspaceView(view);
    },
    save(key, view) {
      // 先校验 view；失败时不写任何备份或记录。
      normalizeWorkspaceView(view);
      const original = storage.getItem(key);
      // 备份顺序固定：统一卡片规格 → 三视图；已有备份不覆盖，后续解析或校验失败时保留已写备份。
      const uniformCardsBackup = `${key}:${UNIFORM_CARDS_BACKUP}`;
      if (original !== null && storage.getItem(uniformCardsBackup) === null) storage.setItem(uniformCardsBackup, original);
      const threeViewsBackup = `${key}:${THREE_VIEWS_BACKUP}`;
      if (original !== null) {
        const previous: unknown = JSON.parse(original);
        normalizeWorkspaceView(previous);
        if (view.views && storage.getItem(threeViewsBackup) === null && isRecord(previous) && previous.views === undefined) storage.setItem(threeViewsBackup, original);
      }
      storage.setItem(key, JSON.stringify(view));
    },
  };
}
