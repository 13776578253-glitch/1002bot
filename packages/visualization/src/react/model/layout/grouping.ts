/** Interactive clustering, sibling separation and coordinate translation between local and world space. */
import { fitMovedContainers } from './spacing.ts';
import { CARD_SIZE, nodeSize, structureHeaderHeight, worldPosition, type CanvasNode } from './node.ts';
import { layoutProtectionConflict } from './protection.ts';
import { separateSiblings } from './siblings.ts';

const GROUP_PADDING = { x: 24, top: 60, bottom: 24 };
function removeEmptyClusters(input: readonly CanvasNode[]): CanvasNode[] {
  let nodes = [...input];
  while (true) {
    const parents = new Set(nodes.map((node) => node.parentId));
    const next = nodes.filter((node) => node.type !== 'cluster' || parents.has(node.id));
    if (next.length === nodes.length) return nodes;
    nodes = next;
  }
}

function recordNaturalSizes(nodes: readonly CanvasNode[], affectedIds: readonly string[]): CanvasNode[] {
  const affected = new Set(affectedIds);
  const key = nodes.filter((node) => node.data.expanded).map((node) => node.id).sort().join('|');
  return nodes.map((node) => {
    const { reflowOrigin: _origin, ...data } = node.data;
    if (!affected.has(node.id) || node.type !== 'structure' && node.type !== 'cluster') return { ...node, data };
    const size = nodeSize(node);
    return { ...node, data: { ...data, contentWidth: size.width, contentHeight: size.height, fitOffset: { x: 0, y: 0 }, expansionSizes: { [key]: size } } };
  });
}

/** 提取当前选中的最高层级根节点（排除选中的内部后代）。 */
export function selectionRoots(nodes: readonly CanvasNode[]): CanvasNode[] {
  const selected = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  return nodes.filter((node) => {
    if (!selected.has(node.id)) return false;
    let parent = nodes.find((item) => item.id === node.parentId);
    while (parent) {
      if (selected.has(parent.id)) return false;
      parent = nodes.find((item) => item.id === parent?.parentId);
    }
    return true;
  });
}

/** 规范化框选状态；当某一祖先节点已被选中时，取消其所有后代节点的选中状态。 */
export function normalizeMarqueeSelection(nodes: readonly CanvasNode[]): CanvasNode[] {
  const selectedAncestors = new Set<string>();
  for (const node of nodes) {
    if (!node.selected) continue;
    let parent = nodes.find((item) => item.id === node.parentId);
    while (parent) {
      selectedAncestors.add(parent.id);
      parent = nodes.find((item) => item.id === parent?.parentId);
    }
  }
  return nodes.map((node) => node.selected && selectedAncestors.has(node.id) ? { ...node, selected: false } : node);
}

function ancestors(node: CanvasNode, nodes: readonly CanvasNode[]): string[] {
  const result: string[] = [];
  let parent = nodes.find((item) => item.id === node.parentId);
  while (parent) {
    result.push(parent.id);
    parent = nodes.find((item) => item.id === parent?.parentId);
  }
  return result;
}

function parentFirst(nodes: readonly CanvasNode[]): CanvasNode[] {
  const result: CanvasNode[] = [], visited = new Set<string>();
  const visit = (node: CanvasNode) => {
    if (visited.has(node.id)) return;
    const parent = nodes.find((item) => item.id === node.parentId);
    if (parent) visit(parent);
    visited.add(node.id);
    result.push(node);
  };
  nodes.forEach(visit);
  return result;
}

function encloseChildren(input: readonly CanvasNode[], parentIds: readonly string[], avoidSiblings = false): CanvasNode[] {
  let nodes = [...input];
  const affected = new Set<string>();
  for (const id of parentIds) {
    let parent = nodes.find((node) => node.id === id);
    while (parent) {
      affected.add(parent.id);
      parent = nodes.find((node) => node.id === parent?.parentId);
    }
  }
  const ordered = [...affected].sort((a, b) => ancestors(nodes.find((node) => node.id === b)!, nodes).length - ancestors(nodes.find((node) => node.id === a)!, nodes).length);
  for (const id of ordered) {
    const parent = nodes.find((node) => node.id === id)!;
    if (parent.type !== 'structure' && parent.type !== 'cluster') continue;
    const children = nodes.filter((node) => node.parentId === id);
    const top = parent.type === 'structure' ? 72 : GROUP_PADDING.top;
    const dx = children.length ? GROUP_PADDING.x - Math.min(...children.map((node) => node.position.x)) : 0;
    const dy = children.length ? top - Math.min(...children.map((node) => node.position.y)) : 0;
    const oldWidth = parent.width ?? CARD_SIZE.width, oldHeight = parent.height ?? CARD_SIZE.height;
    const width = Math.max(CARD_SIZE.width + GROUP_PADDING.x * 2, ...children.map((node) => node.position.x + dx + nodeSize(node).width + GROUP_PADDING.x));
    const height = Math.max(top + CARD_SIZE.height + GROUP_PADDING.bottom, ...children.map((node) => node.position.y + dy + nodeSize(node).height + GROUP_PADDING.bottom));
    nodes = nodes.map((node) => {
      if (node.id === id) return { ...node, position: { x: node.position.x - dx, y: node.position.y - dy },
        width, height, measured: { width, height }, style: { ...node.style, width, height },
        data: { ...node.data, contentWidth: node.data.contentWidth ?? oldWidth, contentHeight: node.data.contentHeight ?? oldHeight } };
      if (node.parentId === id && (dx || dy)) return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
      return node;
    });
    if (avoidSiblings) nodes = separateSiblings(nodes, id);
  }
  return nodes;
}

/**
 * 将选中的顶层节点聚合为新的 Cluster 分组。
 * 计算成员的最近公共祖先 (LCA)，建立分组容器并在各节点记录 groupOrigins 原属父级账本。
 */
export function groupSelection(nodes: readonly CanvasNode[], id: string, manual = false): CanvasNode[] {
  const roots = selectionRoots(nodes);
  if (roots.length < 2 || roots.some((node) => node.data.layoutMode === 'locked')) return nodes as CanvasNode[];
  const entries = roots.map((node) => ({ node, position: worldPosition(node, nodes) }));
  const x = Math.min(...entries.map((entry) => entry.position.x)) - GROUP_PADDING.x;
  const y = Math.min(...entries.map((entry) => entry.position.y)) - GROUP_PADDING.top;
  const right = Math.max(...entries.map(({ node, position }) => position.x + nodeSize(node).width));
  const bottom = Math.max(...entries.map(({ node, position }) => position.y + nodeSize(node).height));
  const groupedIds = new Set(roots.map((node) => node.id));
  const chains = roots.map((node) => ancestors(node, nodes));
  const parentId = chains[0]!.find((candidate) => chains.every((chain) => chain.includes(candidate)));
  const parent = nodes.find((node) => node.id === parentId);
  const origin = parent ? worldPosition(parent, nodes) : { x: 0, y: 0 };
  const group: CanvasNode = {
    id, type: 'cluster', position: { x: x - origin.x, y: y - origin.y }, selected: true,
    ...(parentId ? { parentId } : {}),
    style: { width: right - x + GROUP_PADDING.x, height: bottom - y + GROUP_PADDING.bottom },
    width: right - x + GROUP_PADDING.x, height: bottom - y + GROUP_PADDING.bottom,
    data: { title: '聚合分组', contentWidth: right - x + GROUP_PADDING.x, contentHeight: bottom - y + GROUP_PADDING.bottom }, dragHandle: '.cluster-drag-handle',
  };
  const result = nodes.map((node): CanvasNode => {
    if (!groupedIds.has(node.id)) return { ...node, selected: false };
    const world = worldPosition(node, nodes);
    return { ...node, parentId: id, extent: 'parent', position: { x: world.x - x, y: world.y - y }, selected: false,
      data: { ...node.data, groupOrigins: { ...node.data.groupOrigins, [id]: node.parentId ?? null } } };
  });
  const oldParents = roots.flatMap((node) => node.parentId ? [node.parentId] : []);
  let grouped = removeEmptyClusters([group, ...result]);
  if (manual) return parentFirst(fitMovedContainers(grouped, [id], { moveNeighbours: false, preserveFrozen: true }));
  grouped = encloseChildren(grouped, oldParents);
  grouped = separateSiblings(grouped, id);
  grouped = encloseChildren(grouped, parentId ? [parentId] : [], true);
  const next = parentFirst(recordNaturalSizes(grouped, [id, ...chains.flat()]));
  return layoutProtectionConflict(nodes, next) ? nodes as CanvasNode[] : next;
}

/**
 * 解散聚合分组。
 * 读取 groupOrigins 账本将内部节点归还回各自原属父容器，移除空分组并重算尺寸。
 */
export function ungroup(nodes: readonly CanvasNode[], id: string, manual = false): CanvasNode[] {
  const parent = nodes.find((node) => node.id === id);
  if (!parent || parent.data.layoutMode === 'locked' || nodes.some((node) => node.parentId === id && node.data.layoutMode === 'locked')) return nodes as CanvasNode[];
  const result = nodes.filter((node) => node.id !== id).map((node): CanvasNode => {
    if (node.parentId !== id) return { ...node, selected: false };
    const world = worldPosition(node, nodes);
    const { [id]: originalParent, ...origins } = node.data.groupOrigins ?? {};
    const restoredId = originalParent === null ? undefined : nodes.some((item) => item.id === originalParent) ? originalParent : parent.parentId;
    const restoredParent = nodes.find((item) => item.id === restoredId);
    const origin = restoredParent ? worldPosition(restoredParent, nodes) : { x: 0, y: 0 };
    const { parentId: _parent, extent: _extent, ...rest } = node;
    const { groupOrigins: _origins, ...data } = node.data;
    return { ...rest, ...(restoredParent ? { parentId: restoredParent.id, extent: 'parent' as const } : {}),
      position: { x: world.x - origin.x, y: world.y - origin.y }, selected: true,
      data: { ...data, ...(Object.keys(origins).length ? { groupOrigins: origins } : {}) } };
  });
  const restored = removeEmptyClusters(result);
  if (manual) return parentFirst(fitMovedContainers(restored, restored.filter((node) => node.selected).map((node) => node.id), { moveNeighbours: false, preserveFrozen: true }));
  const affected = [...ancestors(parent, nodes), ...restored.filter((node) => node.selected).flatMap((node) => ancestors(node, restored))];
  const next = parentFirst(recordNaturalSizes(encloseChildren(restored, affected), affected));
  return layoutProtectionConflict(nodes, next, new Set([id])) ? nodes as CanvasNode[] : next;
}

/** 提取属于选中集合的所有叶子卡片节点 ID（穿透 cluster 分组）。 */
export function leafMembers(nodes: readonly CanvasNode[], selectedIds: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  for (const node of nodes) {
    let current: CanvasNode | undefined = node;
    while (current) {
      if (selectedIds.has(current.id)) {
        if (node.type !== 'cluster') result.add(node.id);
        break;
      }
      current = nodes.find((item) => item.id === current?.parentId);
    }
  }
  return result;
}
