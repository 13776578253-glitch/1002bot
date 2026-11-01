/** Hierarchical card tree, container expansion/collapse and cross-baseline expansion synchronization. */
import { projectGraph, type Projection } from '../../core/projection/index.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from './grouping.ts';
import { solveHierarchyExpansion } from './placement.ts';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { CanonicalNode, StageSnapshot } from '../../core/schema/types.ts';
import { indexGraph } from '../../core/graph/index.ts';

/** Initial canvas nodes for a baseline, carrying its change marks. */
export function baselineNodes(baseline: VisualizationBaseline): CanvasNode[] {
  return createHierarchyNodes(baseline.stage, baseline.positions).map((node) => ({ ...node, data: { ...node.data, change: baseline.nodeChanges[node.id]! } }));
}

/**
 * 将阶段快照转换为初始画布节点集合。
 * 深度优先遍历建立扁平树；未显式指定坐标的节点按 3 列网格分配初始局部坐标。
 */
export function createHierarchyNodes(stage: StageSnapshot, positions: Readonly<Record<string, { x: number; y: number }>> = {}): CanvasNode[] {
  const parents = new Map<string, number>();
  for (const node of stage.graph.nodes) if (node.parentId) parents.set(node.parentId, (parents.get(node.parentId) ?? 0) + 1);
  const graph = indexGraph(stage), ordered: CanonicalNode[] = [];
  const appendChildren = (parentId: string): void => {
    for (const id of graph.childrenOf.get(parentId) ?? []) {
      const node = graph.byId.get(id)!;
      ordered.push(node);
      appendChildren(id);
    }
  };
  appendChildren(stage.graph.rootId);
  const siblingIndices = new Map<string, number>();
  return ordered.map((node) => {
    const parentId = node.parentId ?? stage.graph.rootId;
    const index = siblingIndices.get(parentId) ?? 0;
    siblingIndices.set(parentId, index + 1);
    const internal = parentId !== stage.graph.rootId;
    const initial = positions[node.id] ?? { x: (internal ? 24 : 0) + index % 3 * 312, y: (internal ? 72 : 0) + Math.floor(index / 3) * (internal ? 146 : 164) };
    return {
      id: node.id, type: 'card', position: { ...initial }, ...CARD_SIZE,
      ...(internal ? { parentId, extent: 'parent' as const } : {}),
      data: {
        title: node.label, ...(node.summary ? { summary: node.summary } : {}), ...(node.planned ? { planned: true } : {}),
        expandable: parents.has(node.id), expanded: false, childCount: parents.get(node.id) ?? 0,
      },
    };
  });
}

/** 基于当前画布节点的展开标记计算逻辑图投影。 */
export function hierarchyProjection(nodes: readonly CanvasNode[], stage: StageSnapshot): Projection {
  return projectGraph(stage, new Set(nodes.filter((node) => node.data.expanded).map((node) => node.id)));
}

/** 判断节点在当前投影下是否可见；聚合分组在其内含任一可见节点时显示。 */
export function nodeIsVisible(node: CanvasNode, nodes: readonly CanvasNode[], projection: Projection): boolean {
  if (node.type !== 'cluster') return projection.nodeById.has(node.id);
  let parent = nodes.find((item) => item.id === node.parentId);
  while (parent) {
    if (parent.data.expandable && !parent.data.expanded) return false;
    parent = nodes.find((item) => item.id === parent?.parentId);
  }
  return nodes.some((item) => {
    if (!projection.nodeById.has(item.id)) return false;
    let owner = item.parentId;
    while (owner) { if (owner === node.id) return true; owner = nodes.find((ancestor) => ancestor.id === owner)?.parentId; }
    return false;
  });
}

/** Toggle through the shared incremental geometry solver. */
export function toggleHierarchy(input: readonly CanvasNode[], id: string, stage: StageSnapshot): CanvasNode[] {
  const nodes = solveHierarchyExpansion(input, id, stage);
  if (nodes === input) return nodes;
  const projection = hierarchyProjection(nodes, stage);
  return nodes.map(node => nodeIsVisible(node, nodes, projection) || !node.selected ? node : { ...node, selected: false });
}

/**
 * 跨基线展开状态同步。
 * 关闭操作按层级由深至浅执行，打开操作按层级由浅至深执行，确保容器尺寸级联计算正确。
 */
export function syncHierarchyExpansion(target: readonly CanvasNode[], source: readonly CanvasNode[], stage: StageSnapshot, accept: (before: CanvasNode[], after: CanvasNode[]) => boolean = () => true): CanvasNode[] {
  const sourceState = new Map(source.filter((node) => node.data.expandable).map((node) => [node.id, !!node.data.expanded]));
  const depth = (node: CanvasNode): number => {
    let count = 0, parentId = node.parentId;
    while (parentId) { count += 1; parentId = target.find((item) => item.id === parentId)?.parentId; }
    return count;
  };
  const changed = target.filter((node) => node.data.expandable && !node.data.frozen && sourceState.has(node.id) && !!node.data.expanded !== sourceState.get(node.id));
  const closing = changed.filter((node) => !sourceState.get(node.id)).sort((a, b) => depth(b) - depth(a));
  const opening = changed.filter((node) => sourceState.get(node.id)).sort((a, b) => depth(a) - depth(b));
  return [...closing, ...opening].reduce((nodes, node) => {
    const next = toggleHierarchy(nodes, node.id, stage);
    return accept(nodes, next) ? next : nodes;
  }, [...target]);
}

/** 按两节点世界坐标相对夹角计算最佳出入连接桩（水平优先选择左右侧，垂直优先选择上下侧）。 */
export function edgeHandles(nodes: readonly CanvasNode[], sourceId: string, targetId: string): { sourceHandle: string; targetHandle: string } {
  const source = nodes.find((node) => node.id === sourceId)!, target = nodes.find((node) => node.id === targetId)!;
  const a = worldPosition(source, nodes), b = worldPosition(target, nodes);
  const dx = b.x + (target.width ?? CARD_SIZE.width) / 2 - a.x - (source.width ?? CARD_SIZE.width) / 2;
  const dy = b.y + (target.height ?? CARD_SIZE.height) / 2 - a.y - (source.height ?? CARD_SIZE.height) / 2;
  if (Math.abs(dx) > Math.abs(dy) * 1.15) return dx > 0 ? { sourceHandle: 'return-out', targetHandle: 'left-in' } : { sourceHandle: 'left-out', targetHandle: 'return' };
  return dy >= 0 ? { sourceHandle: 'out', targetHandle: 'in' } : { sourceHandle: 'top-out', targetHandle: 'bottom-in' };
}
