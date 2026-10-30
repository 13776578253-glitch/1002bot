/** Drag constraints, alignment snapping and collision avoidance for canvas nodes. */
import type { Point, Rect } from '../../core/layout/geometry.ts';
import { rectIntersects } from '../../core/layout/geometry.ts';
import { CARD_SIZE, layoutProtectionConflict, worldPosition, type CanvasNode } from './grouping.ts';
import { containerGrowthCeiling, fitMovedContainers, MIN_EDGE_GAP, SNAP_SCREEN_DISTANCE } from './spacing.ts';

export interface AlignmentGuide { axis: 'x' | 'y'; value: number; start: number; end: number; }
export interface VisibleLink { source: string; target: string; }

function geometryLookup() {
  const arrays = new WeakMap<readonly CanvasNode[], Map<string, CanvasNode>>();
  const origins = new WeakMap<readonly CanvasNode[], Map<string, Point>>();
  return (node: CanvasNode, nodes: readonly CanvasNode[]): Rect => {
    let byId = arrays.get(nodes), positions = origins.get(nodes);
    if (!byId) { byId = new Map(nodes.map((item) => [item.id, item])); arrays.set(nodes, byId); }
    if (!positions) { positions = new Map(); origins.set(nodes, positions); }
    const parentWorld = (id: string): Point => {
      const cached = positions!.get(id);
      if (cached) return cached;
      const current = byId!.get(id)!;
      const parent = current.parentId ? parentWorld(current.parentId) : { x: 0, y: 0 };
      const point = { x: parent.x + current.position.x, y: parent.y + current.position.y };
      positions!.set(id, point);
      return point;
    };
    const parent = node.parentId ? parentWorld(node.parentId) : { x: 0, y: 0 };
    return { x: parent.x + node.position.x, y: parent.y + node.position.y, w: node.width ?? CARD_SIZE.width, h: node.height ?? CARD_SIZE.height };
  };
}

/**
 * 限制拖动位移：
 * 1. 在屏幕像素阈值 (6px / zoom) 内与同级卡片中心及边缘对齐并生成辅助线；
 * 2. 多轮迭代规避与同层或连线关联卡片的碰撞，保持最小间隔；
 * 3. 递归重算受影响容器尺寸；若超出扩容上限，二分插值回退至最大允许位移。
 */
export function constrainNodeMoves(
  before: readonly CanvasNode[],
  proposed: readonly CanvasNode[],
  movedIds: readonly string[],
  zoom: number,
  visibleIds: ReadonlySet<string>,
  links: readonly VisibleLink[],
): { nodes: CanvasNode[]; guides: AlignmentGuide[] } {
  const previous = new Map(before.map((node) => [node.id, node]));
  const parents = new Map(proposed.map((node) => [node.id, node.parentId]));
  const rect = geometryLookup();
  const related = (node: CanvasNode, id: string, _nodes: readonly CanvasNode[]) => {
    let parent = node.parentId;
    while (parent) { if (parent === id) return true; parent = parents.get(parent); }
    return false;
  };
  const adjacent = new Map<string, Set<string>>();
  for (const edge of links) {
    if (!adjacent.has(edge.source)) adjacent.set(edge.source, new Set());
    if (!adjacent.has(edge.target)) adjacent.set(edge.target, new Set());
    adjacent.get(edge.source)!.add(edge.target); adjacent.get(edge.target)!.add(edge.source);
  }
  const connected = (a: string, b: string) => adjacent.get(a)?.has(b) ?? false;
  movedIds = movedIds.filter((id) => previous.get(id)!.data.layoutMode !== 'locked');
  proposed = proposed.map((node) => previous.get(node.id)?.data.layoutMode === 'locked' && !movedIds.some((id) => related(node, id, proposed)) && (node.position.x !== previous.get(node.id)!.position.x || node.position.y !== previous.get(node.id)!.position.y) ? { ...node, position: previous.get(node.id)!.position } : node);
  const moved = new Set(movedIds);
  const roots = proposed.filter((node) => moved.has(node.id) && !movedIds.some((id) => related(node, id, proposed))).map((node) => { if (!node.data.reflowOrigin) return node; const { reflowOrigin: _origin, ...data } = node.data; return { ...node, data }; });
  const primary = roots[0];
  if (!primary) return { nodes: [...proposed], guides: [] as AlignmentGuide[] };
  const peers = proposed.filter((node) => visibleIds.has(node.id) && !moved.has(node.id) && !roots.some((item) => related(node, item.id, proposed) || related(item, node.id, proposed)));
  const anchor = rect(primary, proposed);
  const threshold = SNAP_SCREEN_DISTANCE / zoom;
  let dx = 0, dy = 0, bestX = threshold + 1, bestY = threshold + 1;
  let xGuide: AlignmentGuide | undefined, yGuide: AlignmentGuide | undefined;

  // 计算与同级卡片的中心 (0.5) 及两侧边缘 (0, 1) 的吸附偏移
  for (const peer of peers.filter((item) => item.type === primary.type || item.type === 'card' && primary.type === 'card')) {
    const other = rect(peer, proposed);
    for (const t of [0.5, 0, 1]) {
      const x = other.x + other.w * t - anchor.x - anchor.w * t;
      const y = other.y + other.h * t - anchor.y - anchor.h * t;
      if (Math.abs(x) <= threshold && Math.abs(x) < bestX) { dx = x; bestX = Math.abs(x); xGuide = { axis: 'x', value: other.x + other.w * t, start: Math.min(anchor.y, other.y) - 12, end: Math.max(anchor.y + anchor.h, other.y + other.h) + 12 }; }
      if (Math.abs(y) <= threshold && Math.abs(y) < bestY) { dy = y; bestY = Math.abs(y); yGuide = { axis: 'y', value: other.y + other.h * t, start: Math.min(anchor.x, other.x) - 12, end: Math.max(anchor.x + anchor.w, other.x + other.w) + 12 }; }
    }
  }

  const candidate = (node: CanvasNode, xDelta: number, yDelta: number): Point => {
    return { x: node.position.x + xDelta, y: node.position.y + yDelta };
  };

  let working = proposed.map((node) => { if (!moved.has(node.id) || !node.data.reflowOrigin) return node; const { reflowOrigin: _origin, ...data } = node.data; return { ...node, data }; });
  for (const node of roots) {
    const oldNode = before.find((item) => item.id === node.id)!;
    const oldRect = rect(oldNode, before);
    let local = candidate(node, dx, dy);
    let nextNode = { ...node, position: local };

    // 最多执行三轮迭代以消除多实体连续碰撞
    for (let pass = 0; pass < 3; pass++) {
      let adjusted = false;
      for (const peer of peers) {
        const linked = connected(node.id, peer.id);
        if (!linked && peer.parentId !== node.parentId) continue;
        const gap = linked && node.type === 'card' && peer.type === 'card' ? MIN_EDGE_GAP : 20;
        const other = rect(peer, working), current = rect(nextNode, working);
        if (!rectIntersects(current, { x: other.x - gap, y: other.y - gap, w: other.w + gap * 2, h: other.h + gap * 2 })) continue;
        const options: Point[] = [];
        if (oldRect.x + oldRect.w <= other.x + 1) options.push({ x: other.x - current.w - gap, y: current.y });
        if (oldRect.x >= other.x + other.w - 1) options.push({ x: other.x + other.w + gap, y: current.y });
        if (oldRect.y + oldRect.h <= other.y + 1) options.push({ x: current.x, y: other.y - current.h - gap });
        if (oldRect.y >= other.y + other.h - 1) options.push({ x: current.x, y: other.y + other.h + gap });
        options.sort((a, b) => Math.hypot(a.x - current.x, a.y - current.y) - Math.hypot(b.x - current.x, b.y - current.y));
        const target = options[0];
        if (!target) { local = oldNode.position; } else {
          const parent = working.find((item) => item.id === node.parentId);
          const origin = parent ? worldPosition(parent, working) : { x: 0, y: 0 };
          local = candidate(node, target.x - origin.x - node.position.x, target.y - origin.y - node.position.y);
        }
        nextNode = { ...node, position: local };
        adjusted = true;
      }
      if (!adjusted) break;
    }

    if (peers.some((peer) => {
      const linked = connected(node.id, peer.id);
      if (!linked && peer.parentId !== node.parentId) return false;
      const gap = linked && node.type === 'card' && peer.type === 'card' ? MIN_EDGE_GAP : 20;
      const other = rect(peer, working);
      return rectIntersects(rect(nextNode, working), { x: other.x - gap, y: other.y - gap, w: other.w + gap * 2, h: other.h + gap * 2 });
    })) nextNode = { ...node, position: oldNode.position };
    working = working.map((item) => item.id === node.id ? nextNode : item);
  }

  // 多选整体拖动时各节点保持严格位移一致
  if (roots.length > 1) {
    const offsets = roots.map((node) => { const current = working.find((item) => item.id === node.id)!; return { x: current.position.x - node.position.x, y: current.position.y - node.position.y }; });
    if (offsets.some((offset) => Math.abs(offset.x - offsets[0]!.x) > 0.1 || Math.abs(offset.y - offsets[0]!.y) > 0.1)) {
      return { nodes: working.map((node) => moved.has(node.id) ? { ...node, position: before.find((item) => item.id === node.id)!.position } : node), guides: [] as AlignmentGuide[] };
    }
  }

  const final = rect(working.find((node) => node.id === primary.id)!, working);
  const guides = [xGuide && Math.abs(final.x - anchor.x - dx) < 0.1 ? xGuide : undefined, yGuide && Math.abs(final.y - anchor.y - dy) < 0.1 ? yGuide : undefined].filter((guide): guide is AlignmentGuide => guide !== undefined);

  const valid = (fitted: readonly CanvasNode[], expectedNodes: readonly CanvasNode[]) => !layoutProtectionConflict(before, fitted, new Set(roots.map((node) => node.id))) && fitted.every((node) => {
    if (node.type === 'card') return true;
    const ceiling = containerGrowthCeiling(node);
    return node.width! <= ceiling.width && node.height! <= ceiling.height;
  }) && roots.every((node) => {
    const current = fitted.find((item) => item.id === node.id)!;
    const expected = worldPosition(expectedNodes.find((item) => item.id === node.id)!, expectedNodes), actual = worldPosition(current, fitted);
    return Math.abs(expected.x - actual.x) < 0.01 && Math.abs(expected.y - actual.y) < 0.01 && !peers.some((peer) => {
      const otherNode = fitted.find((item) => item.id === peer.id)!;
      const linked = connected(node.id, peer.id);
      if (!linked && current.parentId !== otherNode.parentId) return false;
      const gap = linked && current.type === 'card' && peer.type === 'card' ? MIN_EDGE_GAP : 20;
      const other = rect(otherNode, fitted);
      return rectIntersects(rect(current, fitted), { x: other.x - gap, y: other.y - gap, w: other.w + gap * 2, h: other.h + gap * 2 });
    });
  });

  const fitted = fitMovedContainers(working, movedIds);
  if (valid(fitted, working)) return { nodes: fitted, guides };

  // 超过容器扩容封顶时，二分搜索最大安全位移比例
  let low = 0, high = 1, accepted = [...before];
  const rootIds = new Set(roots.map((node) => node.id));
  for (let step = 0; step < 20; step++) {
    const fraction = (low + high) / 2;
    const interpolated = working.map((node) => {
      if (!rootIds.has(node.id)) return node;
      const old = before.find((item) => item.id === node.id)!;
      return { ...node, position: { x: old.position.x + (node.position.x - old.position.x) * fraction, y: old.position.y + (node.position.y - old.position.y) * fraction } };
    });
    const trial = fitMovedContainers(interpolated, movedIds);
    if (valid(trial, interpolated)) { low = fraction; accepted = trial; } else high = fraction;
  }
  return { nodes: accepted, guides: [] as AlignmentGuide[] };
}
