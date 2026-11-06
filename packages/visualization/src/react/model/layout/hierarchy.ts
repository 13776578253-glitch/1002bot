/** Hierarchical card tree, container expansion/collapse and cross-baseline expansion synchronization. */
import { hierarchyProjection, nodeIsVisible } from './visibility.ts';
import { CARD_SIZE, detailCardSize, type CanvasNode } from './node.ts';
import { solveHierarchyExpansion } from './placement.ts';
import { fitAuthoredLayout } from './manual-layout.ts';
import type { StageConflict } from '../contracts/stage-types.ts';
import type { VisualizationBaseline } from '../../../core/schema/baseline.ts';
import type { CanonicalNode, StageSnapshot } from '../../../core/schema/types.ts';
import { indexGraph } from '../../../core/graph/index.ts';

/** 基线的初始画布节点，携带变更标记。 */
export function baselineNodes(baseline: VisualizationBaseline): CanvasNode[] {
  const positions = baseline.layout ? Object.fromEntries(Object.entries(baseline.layout.nodes).map(([id, frame]) => [id, frame.position])) : baseline.positions;
  return createHierarchyNodes(baseline.stage, positions).map((node) => {
    const frame = baseline.layout?.nodes[node.id];
    const expanded = !!frame?.initiallyExpanded && !!node.data.expandable;
    const container = (node.data.childCount ?? 0) > 0;
    const detailSize = detailCardSize(node.data.details?.length ?? 0);
    const size = expanded ? container ? frame?.expandedSize : detailSize : CARD_SIZE;
    return { ...node,
      ...(frame ? { position: { ...frame.position }, ...size, measured: { ...size! }, style: { ...size! }, type: expanded && container ? 'structure' : 'card', ...(expanded && container ? { dragHandle: '.structure-header' } : {}) } : {}),
      data: { ...node.data, change: baseline.nodeChanges[node.id]!, ...(frame ? { expanded, authored: { collapsedSize: { ...CARD_SIZE }, ...(frame.expandedSize ? { expandedSize: container ? { ...frame.expandedSize } : { ...detailSize } } : {}) } } : {}) },
    };
  });
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
        layoutEdits: { version: 1 },
        expandable: parents.has(node.id) || Boolean(node.details?.length), expanded: false, childCount: parents.get(node.id) ?? 0,
        ...(node.details ? { details: node.details } : {}),
        ...(node.details?.length && !parents.has(node.id) ? { authored: { collapsedSize: { ...CARD_SIZE }, expandedSize: { ...detailCardSize(node.details.length) } } } : {}),
      },
    };
  });
}

/** 通过共享的增量几何求解器切换展开状态。 */
export function toggleHierarchy(input: readonly CanvasNode[], id: string, stage: StageSnapshot, onConflict?: (conflict: StageConflict) => void): CanvasNode[] {
  const authored = input.find((node) => node.id === id)?.data.authored;
  if (authored) {
    const next = input.map((node) => {
      if (node.id !== id || !node.data.expandable) return node;
      const expanded = !node.data.expanded;
      const preference = node.data.layoutEdits?.sizes?.[expanded ? 'expanded' : 'collapsed'];
      const responsibility = !node.data.childCount && !!node.data.details?.length;
      const selectedSize = expanded ? responsibility ? detailCardSize(node.data.details!.length) : { width: Math.max(preference?.width ?? 0, node.data.contentWidth ?? authored.expandedSize!.width), height: Math.max(preference?.height ?? 0, node.data.contentHeight ?? authored.expandedSize!.height) } : preference ?? CARD_SIZE;
      const size = { width: selectedSize.width, height: selectedSize.height };
      const { dragHandle: _handle, ...rest } = node;
      const container = input.some((child) => child.parentId === node.id);
      return { ...rest, type: expanded && container ? 'structure' : 'card', ...size, measured: { ...size }, style: { ...node.style, ...size }, ...(expanded && container ? { dragHandle: '.structure-header' } : {}),
        data: { ...node.data, expanded, ...(!expanded ? { contentWidth: node.width!, contentHeight: node.height! } : {}) } };
    });
    const changed = [id, ...next.filter((node) => node.parentId === id && next.find((item) => item.id === id)!.data.expanded).map((node) => node.id)];
    const fitted = fitAuthoredLayout(input, next, changed, stage);
    if (fitted.conflict) { onConflict?.(fitted.conflict); return input as CanvasNode[]; }
    const projection = hierarchyProjection(fitted.nodes, stage);
    return fitted.nodes.map((node) => nodeIsVisible(node, fitted.nodes, projection) || !node.selected ? node : { ...node, selected: false });
  }
  const nodes = solveHierarchyExpansion(input, id, stage);
  if (nodes === input) return nodes;
  const projection = hierarchyProjection(nodes, stage);
  return nodes.map(node => nodeIsVisible(node, nodes, projection) || !node.selected ? node : { ...node, selected: false });
}

/**
 * 跨基线展开状态同步。
 * 关闭操作按层级由深至浅执行，打开操作按层级由浅至深执行，确保容器尺寸级联计算正确。
 */
export function syncHierarchyExpansion(target: readonly CanvasNode[], source: readonly CanvasNode[], stage: StageSnapshot, accept: (before: CanvasNode[], after: CanvasNode[]) => boolean = () => true, onConflict?: (conflict: StageConflict) => void): CanvasNode[] {
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
    const next = toggleHierarchy(nodes, node.id, stage, onConflict);
    return accept(nodes, next) ? next : nodes;
  }, [...target]);
}
