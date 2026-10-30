/** Hierarchical card tree, container expansion/collapse and cross-baseline expansion synchronization. */
import { projectGraph, type Projection } from '../../core/projection/index.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from './grouping.ts';
import { preferredContainerSize } from './spacing.ts';
import type { CanonicalNode, StageSnapshot } from '../../core/schema/types.ts';
import { indexGraph } from '../../core/graph/index.ts';

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

function resize(nodes: CanvasNode[], id: string, width: number, height: number, content?: { contentWidth: number; contentHeight: number }): void {
  const index = nodes.findIndex((node) => node.id === id);
  const node = nodes[index]!;
  const oldWidth = node.width ?? CARD_SIZE.width, oldHeight = node.height ?? CARD_SIZE.height;
  const dx = width - oldWidth, dy = height - oldHeight;
  const key = nodes.filter((item) => item.data.expanded).map((item) => item.id).sort().join('|');
  const baseline = node.data.expansionSizes?.[key] ?? (content ? { width: content.contentWidth, height: content.contentHeight } : undefined);
  nodes[index] = { ...node, width, height, measured: { width, height }, style: { ...node.style, width, height }, ...(baseline ? { data: { ...node.data, contentWidth: baseline.width, contentHeight: baseline.height, expansionSizes: { ...node.data.expansionSizes, [key]: baseline } } } : {}) };
  for (let i = 0; i < nodes.length; i++) {
    const sibling = nodes[i]!;
    if (sibling.id === id || sibling.parentId !== node.parentId) continue;
    const w = sibling.width ?? CARD_SIZE.width, h = sibling.height ?? CARD_SIZE.height;
    let x = sibling.position.x, y = sibling.position.y;
    if (dx && x >= node.position.x + oldWidth && y + h > node.position.y && y < node.position.y + oldHeight) x += dx;
    if (dy && y >= node.position.y + oldHeight && x + w > node.position.x && x < node.position.x + Math.max(width, oldWidth)) y += dy;
    if (x !== sibling.position.x || y !== sibling.position.y) nodes[i] = { ...sibling, position: { x, y } };
  }
}

/**
 * 原位切换节点展开/收起状态：
 * 1. 在 card 与 structure 类型之间原位切换；
 * 2. 展开时自动按推荐尺寸撑开并向上级联重算父容器尺寸；
 * 3. 沿 X/Y 轴推开受波及的同级兄弟节点；
 * 4. 重新计算投影并更新内部节点的选中与可见性。
 */
export function toggleHierarchy(input: readonly CanvasNode[], id: string, stage: StageSnapshot): CanvasNode[] {
  let nodes = input.map((node) => ({ ...node }));
  const index = nodes.findIndex((node) => node.id === id);
  const node = nodes[index];
  if (!node?.data.expandable) return nodes;
  const expanded = !node.data.expanded;
  const { dragHandle: _handle, ...base } = node;
  nodes[index] = {
    ...base, type: expanded ? 'structure' : 'card',
    ...(expanded ? { dragHandle: '.structure-header' } : {}),
    data: { ...node.data, expanded },
  };
  if (expanded) {
    const size = preferredContainerSize(nodes[index]!, nodes);
    resize(nodes, id, size.width, size.height, size);
  } else resize(nodes, id, CARD_SIZE.width, CARD_SIZE.height);
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodes.find((item) => item.id === parentId)!;
    if (parent.data.expandable && !parent.data.expanded) break;
    const bounds = preferredContainerSize(parent, nodes);
    resize(nodes, parentId, bounds.width, bounds.height, bounds);
    parentId = parent.parentId;
  }
  const projection = hierarchyProjection(nodes, stage);
  nodes = nodes.map((item) => nodeIsVisible(item, nodes, projection) ? item : { ...item, selected: false });
  return nodes;
}

/**
 * 跨基线展开状态同步。
 * 关闭操作按层级由深至浅执行，打开操作按层级由浅至深执行，确保容器尺寸级联计算正确。
 */
export function syncHierarchyExpansion(target: readonly CanvasNode[], source: readonly CanvasNode[], stage: StageSnapshot): CanvasNode[] {
  const sourceState = new Map(source.filter((node) => node.data.expandable).map((node) => [node.id, !!node.data.expanded]));
  const depth = (node: CanvasNode): number => {
    let count = 0, parentId = node.parentId;
    while (parentId) { count += 1; parentId = target.find((item) => item.id === parentId)?.parentId; }
    return count;
  };
  const changed = target.filter((node) => node.data.expandable && sourceState.has(node.id) && !!node.data.expanded !== sourceState.get(node.id));
  const closing = changed.filter((node) => !sourceState.get(node.id)).sort((a, b) => depth(b) - depth(a));
  const opening = changed.filter((node) => sourceState.get(node.id)).sort((a, b) => depth(a) - depth(b));
  return [...closing, ...opening].reduce((nodes, node) => toggleHierarchy(nodes, node.id, stage), [...target]);
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
