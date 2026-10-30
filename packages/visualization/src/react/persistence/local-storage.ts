/** Browser storage adapter; malformed records are surfaced at this external boundary. */
import type { CanvasViewStorage, CanvasWorkspaceView } from '../model/workspace.ts';

export function assertWorkspaceView(value: unknown): asserts value is CanvasWorkspaceView {
  const view = value as CanvasWorkspaceView;
  if (!view || view.version !== 1 || typeof view.baselineId !== 'string' || !view.baselines || typeof view.baselines !== 'object') throw new Error('工作视图格式不正确');
  for (const baseline of Object.values(view.baselines)) {
    if (typeof baseline.revision !== 'string' || !Array.isArray(baseline.nodes)) throw new Error('阶段视图格式不正确');
    const nodes = new Map(baseline.nodes.map((node) => [node.id, node]));
    if (nodes.size !== baseline.nodes.length) throw new Error('视图包含重复节点');
    for (const node of baseline.nodes) {
      if (typeof node.id !== 'string' || !['card', 'structure', 'cluster'].includes(node.type) || !node.data || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !Number.isFinite(node.width) || !Number.isFinite(node.height) || !(node.width > 0) || !(node.height > 0) || !['free', 'fixed', 'locked'].includes(node.data.layoutMode ?? 'free')) throw new Error('节点视图格式不正确');
      const ancestors = new Set([node.id]);
      let parent = node.parentId;
      while (parent) { if (!nodes.has(parent) || ancestors.has(parent)) throw new Error('分组层级格式不正确'); ancestors.add(parent); parent = nodes.get(parent)!.parentId; }
    }
    if (baseline.viewport && (!Number.isFinite(baseline.viewport.x) || !Number.isFinite(baseline.viewport.y) || !Number.isFinite(baseline.viewport.zoom) || !(baseline.viewport.zoom > 0))) throw new Error('视口格式不正确');
  }
}

export function createLocalStorageViewStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): CanvasViewStorage {
  return {
    load(key) {
      const text = storage.getItem(key);
      if (text === null) return undefined;
      const view: unknown = JSON.parse(text);
      assertWorkspaceView(view);
      return view;
    },
    save(key, view) { storage.setItem(key, JSON.stringify(view)); },
  };
}
