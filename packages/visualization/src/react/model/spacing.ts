/** Container sizing, growth ceilings and recursive ancestor refitting. */
import { CARD_SIZE, restoreSiblings, separateSiblings, structureHeaderHeight, type CanvasNode } from './grouping.ts';
import { preferredEditedSize } from './layout-intent.ts';

export { MIN_EDGE_GAP } from './grouping.ts';

/** 对齐吸附触发阈值（屏幕像素）；实际画布距离为 SNAP_SCREEN_DISTANCE / zoom。 */
export const SNAP_SCREEN_DISTANCE = 6;

/** 单轴最大允许扩容绝对余量（像素）。 */
export const MAX_CONTAINER_EXTRA = 800;

/** 单轴最大扩容比例；额外余量不超过自然基础尺寸的 100%。 */
export const MAX_CONTAINER_RATIO = 1;

/** 容器顶部避开标题与职责区块，cluster 预留 60px。 */
export const containerInset = (node: CanvasNode) => ({ x: 24, top: node.type === 'structure' ? structureHeaderHeight(node) + 4 : 60, bottom: 24 });

const extra = (size: number) => Math.min(MAX_CONTAINER_EXTRA, size * MAX_CONTAINER_RATIO);

function containerContentBounds(node: CanvasNode, nodes: readonly CanvasNode[], ignored: ReadonlySet<string> = new Set()) {
  const inset = containerInset(node);
  const children = nodes.filter((child) => child.parentId === node.id && !ignored.has(child.id));
  const anchor = { x: -(node.data.fitOffset?.x ?? 0), y: -(node.data.fitOffset?.y ?? 0) };
  const preference = preferredEditedSize(node);
  const left = Math.min(anchor.x, ...children.map((child) => child.position.x - inset.x));
  const top = Math.min(anchor.y, ...children.map((child) => child.position.y - inset.top));
  const right = Math.max(anchor.x + (preference?.width ?? 288), ...children.map((child) => child.position.x + (child.width ?? CARD_SIZE.width) + inset.x));
  const bottom = Math.max(anchor.y + Math.max(preference?.height ?? 0, inset.top + CARD_SIZE.height + inset.bottom), ...children.map((child) => child.position.y + (child.height ?? CARD_SIZE.height) + inset.bottom));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 计算容器容纳其当前全部子节点所需的最小包围盒尺寸。 */
export function containerContentSize(node: CanvasNode, nodes: readonly CanvasNode[]) {
  const { width, height } = containerContentBounds(node, nodes);
  return { width, height };
}

/** 计算容器在当前基准尺寸下的最大允许扩容尺寸（自然基础尺寸 + 额外允许余量）。 */
export function containerGrowthCeiling(node: CanvasNode) {
  const width = node.data.contentWidth ?? node.width!;
  const height = node.data.contentHeight ?? node.height!;
  return {
    width: width + extra(width), height: height + extra(height),
  };
}

/** 计算容器容纳当前子节点的自然推荐尺寸。 */
export function preferredContainerSize(node: CanvasNode, nodes: readonly CanvasNode[]) {
  const content = containerContentSize(node, nodes);
  return {
    width: content.width,
    height: content.height,
    contentWidth: content.width, contentHeight: content.height,
  };
}

export function containerSizeLimits(node: CanvasNode, nodes: readonly CanvasNode[]) {
  const content = containerContentSize(node, nodes);
  const ceiling = containerGrowthCeiling(node);
  return { minWidth: content.width, minHeight: content.height, maxWidth: Math.max(content.width, ceiling.width), maxHeight: Math.max(content.height, ceiling.height) };
}

/**
 * 子节点位移后自底向上（从最深层父级到最外层）重新贴合所有受影响容器尺寸。
 * 使用 fitOffset 跟踪边界偏移，保持内部坐标系稳定并支持回拖反向收缩。
 */
export function fitMovedContainers(input: readonly CanvasNode[], movedIds: readonly string[], options: { moveNeighbours?: boolean; ignored?: ReadonlySet<string>; preserveFrozen?: boolean } = {}): CanvasNode[] {
  let nodes = [...input];
  const ancestors = new Set<string>();
  for (const id of movedIds) {
    let parent = nodes.find((node) => node.id === id)?.parentId;
    while (parent) { ancestors.add(parent); parent = nodes.find((node) => node.id === parent)?.parentId; }
  }
  const depth = (id: string): number => { const parent = nodes.find((node) => node.id === id)?.parentId; return parent ? depth(parent) + 1 : 0; };
  const excluded = new Set([...ancestors, ...movedIds]);
  for (const id of [...ancestors].sort((a, b) => depth(b) - depth(a))) {
    const node = nodes.find((item) => item.id === id)!;
    if (node.type === 'card' && !node.data.expanded) continue;
    if (options.preserveFrozen && node.data.frozen) continue;
    const { x, y, width, height } = containerContentBounds(node, nodes, options.ignored);
    const changed = x || y || width !== node.width || height !== node.height || node.data.contentWidth === undefined || node.data.contentHeight === undefined;
    if (changed) nodes = nodes.map((item) => {
      if (item.id === id) return { ...item, position: { x: item.position.x + x, y: item.position.y + y }, width, height, measured: { width, height }, style: { ...item.style, width, height }, data: { ...item.data, contentWidth: item.data.contentWidth ?? item.width!, contentHeight: item.data.contentHeight ?? item.height!, fitOffset: { x: (item.data.fitOffset?.x ?? 0) + x, y: (item.data.fitOffset?.y ?? 0) + y }, ...(item.data.reflowOrigin ? { reflowOrigin: { x: item.data.reflowOrigin.x + x, y: item.data.reflowOrigin.y + y } } : {}) } };
      return (x || y) && item.parentId === id ? { ...item, position: { x: item.position.x - x, y: item.position.y - y }, ...(item.data.reflowOrigin ? { data: { ...item.data, reflowOrigin: { x: item.data.reflowOrigin.x - x, y: item.data.reflowOrigin.y - y } } } : {}) } : item;
    });
    if (options.moveNeighbours !== false) {
      nodes = restoreSiblings(nodes, node.parentId, excluded);
      if (x || y || width > node.width! || height > node.height!) nodes = separateSiblings(nodes, id, true);
    }
  }
  return nodes;
}
