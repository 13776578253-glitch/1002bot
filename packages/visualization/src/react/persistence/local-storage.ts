/** Local storage adapter owns read/write and one-time backups; schema normalization lives in workspace-schema.ts. */
import type { CanvasViewStorage } from './storage-types.ts';
import { normalizeWorkspaceView } from './workspace-schema.ts';

/** 一次性备份后缀；同名备份已存在时永不覆盖。 */
const UNIFORM_CARDS_BACKUP = 'before-uniform-cards-v1';
const THREE_VIEWS_BACKUP = 'before-three-views-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 创建 localStorage 视图存储；load 校验后返回，save 先校验再按固定顺序写一次性备份。 */
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
      // 三视图备份只在旧记录仍是单视图结构时写入。
      const threeViewsBackup = `${key}:${THREE_VIEWS_BACKUP}`;
      if (original !== null) {
        const previous: unknown = JSON.parse(original);
        normalizeWorkspaceView(previous);
        if (view.views && storage.getItem(threeViewsBackup) === null && isRecord(previous) && previous.views === undefined) storage.setItem(threeViewsBackup, original);
      }
      // 最后写主记录；此前任何解析或校验失败都不会替换旧记录。
      storage.setItem(key, JSON.stringify(view));
    },
  };
}
