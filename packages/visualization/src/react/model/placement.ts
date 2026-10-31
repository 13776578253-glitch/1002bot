/** Incremental stage geometry: open required ancestors and place additions without moving inherited content. */
import type { Projection } from '../../core/projection/index.ts';
import type { StageSnapshot } from '../../core/schema/types.ts';
import type { Point, Rect } from '../../core/layout/geometry.ts';
import { CARD_SIZE, MIN_EDGE_GAP, worldPosition, type CanvasNode } from './grouping.ts';
import { hierarchyProjection, nodeIsVisible } from './hierarchy.ts';
import { toggleFrozenExpansion } from './frozen.ts';
import { containerInset, MAX_CONTAINER_EXTRA } from './spacing.ts';
import type { EdgeRouteSnapshot, FrozenGroupSnapshot, StagePlacementRecord } from './workspace.ts';
import type { StageConflict } from './stage-types.ts';

export interface PlacementInput {
  nodes: readonly CanvasNode[];
  stage: StageSnapshot;
  projection: Projection;
  addedNodeIds: readonly string[];
  preferredPositions?: Readonly<Record<string, Point>>;
  frozenGroups?: readonly FrozenGroupSnapshot[];
  routes?: readonly EdgeRouteSnapshot[];
  reservedPaths?: readonly { points: Point[]; source: string; target: string }[];
}
export interface PlacementResult {
  nodes: CanvasNode[];
  placements: StagePlacementRecord[];
  expanded: string[];
  conflicts: StageConflict[];
}

const GAP = 24, STEP = 64, MAX_GRID = 1024, EPS = 0.000001;
const byId = (nodes: readonly CanvasNode[], id: string) => nodes.find((node) => node.id === id)!;
const size = (node: CanvasNode) => ({ w: node.width ?? CARD_SIZE.width, h: node.height ?? CARD_SIZE.height });
const box = (node: CanvasNode, nodes: readonly CanvasNode[]): Rect => ({ ...worldPosition(node, nodes), ...size(node) });
const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap - EPS && a.x + a.w + gap > b.x + EPS && a.y < b.y + b.h + gap - EPS && a.y + a.h + gap > b.y + EPS;
const replace = (nodes: readonly CanvasNode[], replacement: CanvasNode): CanvasNode[] => nodes.map((node) => node.id === replacement.id ? replacement : node);

function ancestorIds(nodes: readonly CanvasNode[], id: string): string[] {
  const result: string[] = [];
  let parent = byId(nodes, id).parentId;
  while (parent) { result.unshift(parent); parent = byId(nodes, parent).parentId; }
  return result;
}

function intersectsSegment(rect: Rect, a: Point, b: Point): boolean {
  if (a.y === b.y) return a.y > rect.y && a.y < rect.y + rect.h && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.w;
  return a.x > rect.x && a.x < rect.x + rect.w && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.h;
}

function routeBlocked(rect: Rect, routes: readonly EdgeRouteSnapshot[], reserved: NonNullable<PlacementInput['reservedPaths']>, nodes: readonly CanvasNode[], nodeId: string): boolean {
  if (reserved.some((route) => route.source !== nodeId && route.target !== nodeId && route.points.slice(1).some((point, index) => intersectsSegment(rect, route.points[index]!, point)))) return true;
  return routes.some((route) => {
    if (route.state === 'auto' || route.source.nodeId === nodeId || route.target.nodeId === nodeId) return false;
    const owner = route.space.kind === 'owner' ? nodes.find((node) => node.id === (route.space as { kind: 'owner'; ownerId: string }).ownerId) : undefined;
    if (route.space.kind === 'owner' && !owner) return false;
    const origin = owner ? worldPosition(owner, nodes) : { x: 0, y: 0 };
    const points = route.points.map((point) => ({ x: point.x + origin.x, y: point.y + origin.y }));
    return points.slice(1).some((point, index) => intersectsSegment(rect, points[index]!, point));
  });
}

/** Grow a frame around settled children, compensating child coordinates when its origin shifts. */
function fitFrame(input: readonly CanvasNode[], id: string, pending: ReadonlySet<string>, opening: boolean, bias: Point = { x: 0, y: 0 }): CanvasNode[] | undefined {
  const parent = byId(input, id);
  const inset = { x: 24, top: parent.type === 'cluster' ? 60 : 72, bottom: 24 };
  const children = input.filter((node) => node.parentId === id && !pending.has(node.id));
  const totalChildren = input.filter((node) => node.parentId === id).length;
  const width = parent.width ?? CARD_SIZE.width, height = parent.height ?? CARD_SIZE.height;
  let minX = Math.min(0, ...children.map((child) => child.position.x - inset.x));
  let minY = Math.min(0, ...children.map((child) => child.position.y - inset.top));
  const maxX = Math.max(opening ? 48 + CARD_SIZE.width : width, ...children.map((child) => child.position.x + size(child).w + inset.x));
  const maxY = Math.max(opening ? inset.top + CARD_SIZE.height + inset.bottom : height, ...children.map((child) => child.position.y + size(child).h + inset.bottom));
  const nextWidth = maxX - minX, nextHeight = maxY - minY;
  if (opening) {
    if (bias.x < 0) { const lower = Math.max(width - nextWidth, ...children.map((child) => child.position.x + size(child).w + inset.x - nextWidth)); minX += (minX - lower) * bias.x; }
    if (bias.y < 0) { const lower = Math.max(height - nextHeight, ...children.map((child) => child.position.y + size(child).h + inset.bottom - nextHeight)); minY += (minY - lower) * bias.y; }
  }
  if (!opening) {
    const ceiling = { width: (parent.data.contentWidth ?? width) + MAX_CONTAINER_EXTRA, height: (parent.data.contentHeight ?? height) + MAX_CONTAINER_EXTRA };
    if (nextWidth > ceiling.width + EPS || nextHeight > ceiling.height + EPS) return undefined;
  }
  const fitOffset = { x: (parent.data.fitOffset?.x ?? 0) + minX, y: (parent.data.fitOffset?.y ?? 0) + minY };
  const next = input.map((node) => {
    if (node.id === id) return {
      ...node, position: { x: node.position.x + minX, y: node.position.y + minY }, width: nextWidth, height: nextHeight,
      measured: { width: nextWidth, height: nextHeight }, style: { ...node.style, width: nextWidth, height: nextHeight },
      data: { ...node.data, fitOffset, contentWidth: opening ? nextWidth : node.data.contentWidth ?? width, contentHeight: opening ? nextHeight : node.data.contentHeight ?? height },
    };
    if (node.parentId !== id || (!minX && !minY)) return node;
    return { ...node, position: { x: node.position.x - minX, y: node.position.y - minY }, ...(node.data.reflowOrigin ? { data: { ...node.data, reflowOrigin: { x: node.data.reflowOrigin.x - minX, y: node.data.reflowOrigin.y - minY } } } : {}) };
  });
  return next;
}

/** Only newly created overlaps are rejected; existing source geometry is preserved. */
function collisionFree(before: readonly CanvasNode[], after: readonly CanvasNode[], stage: StageSnapshot, pending: ReadonlySet<string>): boolean {
  const previous = new Map(before.map((node) => [node.id, node]));
  const oldProjection = hierarchyProjection(before, stage), nextProjection = hierarchyProjection(after, stage);
  const visible = after.filter((node) => !pending.has(node.id) && nodeIsVisible(node, after, nextProjection));
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i]!, b = visible[j]!;
    if (a.parentId !== b.parentId) continue;
    const gap = a.type === 'card' && b.type === 'card' ? MIN_EDGE_GAP : GAP;
    if (!overlaps(box(a, after), box(b, after), gap)) continue;
    const oldA = previous.get(a.id), oldB = previous.get(b.id);
    if (!oldA || !oldB || !nodeIsVisible(oldA, before, oldProjection) || !nodeIsVisible(oldB, before, oldProjection)
      || !overlaps(box(oldA, before), box(oldB, before), gap)) return false;
  }
  return true;
}

function fitChain(nodes: readonly CanvasNode[], ids: readonly string[], stage: StageSnapshot, pending: ReadonlySet<string>, opened: ReadonlySet<string>, bias: Point = { x: 0, y: 0 }): CanvasNode[] | undefined {
  let next = [...nodes];
  for (const id of [...ids].reverse()) {
    const fitted = fitFrame(next, id, pending, opened.has(id), bias);
    if (!fitted || !collisionFree(next, fitted, stage, pending)) return undefined;
    next = fitted;
  }
  return next;
}

function candidates(node: CanvasNode, nodes: readonly CanvasNode[], stage: StageSnapshot, pending: ReadonlySet<string>, preferred?: Point): Point[] {
  const parent = node.parentId ? byId(nodes, node.parentId) : undefined;
  const parentWorld = parent ? worldPosition(parent, nodes) : { x: 0, y: 0 };
  const own = size(node), positions: Point[] = [];
  if (preferred) positions.push({ x: parentWorld.x + preferred.x, y: parentWorld.y + preferred.y });
  for (const edge of stage.graph.edges) {
    const other = edge.source.nodeId === node.id ? edge.target.nodeId : edge.target.nodeId === node.id ? edge.source.nodeId : undefined;
    if (!other || pending.has(other)) continue;
    const relative = nodes.find((item) => item.id === other);
    if (!relative || relative.parentId !== node.parentId) continue;
    const r = box(relative, nodes);
    positions.push({ x: r.x + r.w + MIN_EDGE_GAP, y: r.y }, { x: r.x, y: r.y + r.h + MIN_EDGE_GAP },
      { x: r.x - own.w - MIN_EDGE_GAP, y: r.y }, { x: r.x, y: r.y - own.h - MIN_EDGE_GAP });
  }
  for (const sibling of nodes.filter((item) => item.id !== node.id && item.parentId === node.parentId && !pending.has(item.id))) {
    const r = box(sibling, nodes), gap = sibling.type === 'card' && node.type === 'card' ? MIN_EDGE_GAP : GAP;
    positions.push({ x: r.x + r.w + gap, y: r.y }, { x: r.x, y: r.y + r.h + gap },
      { x: r.x - own.w - gap, y: r.y }, { x: r.x, y: r.y - own.h - gap });
  }
  if (parent) {
    const inset = containerInset(parent), extent = size(parent);
    for (let y = inset.top; y + own.h <= extent.h - inset.bottom && positions.length < MAX_GRID; y += STEP) {
      for (let x = inset.x; x + own.w <= extent.w - inset.x && positions.length < MAX_GRID; x += STEP) positions.push({ x: parentWorld.x + x, y: parentWorld.y + y });
    }
    const offsets = [
      { x: extent.w + GAP, y: inset.top }, { x: inset.x, y: extent.h + GAP },
      { x: -own.w - GAP, y: inset.top }, { x: inset.x, y: -own.h - GAP },
    ];
    for (let i = 0; i < 12; i++) for (const offset of offsets) positions.push({ x: parentWorld.x + offset.x + (offset.y === inset.top ? 0 : i * STEP), y: parentWorld.y + offset.y + (offset.y === inset.top ? i * STEP : 0) });
  } else {
    const settled = nodes.filter((item) => !item.parentId && !pending.has(item.id));
    const center = settled.length ? box(settled[0]!, nodes) : { x: 0, y: 0, w: 0, h: 0 };
    for (let radius = 1; radius <= 24; radius++) for (let i = -radius; i <= radius; i++) {
      for (const [x, y] of [[-radius, i], [radius, i], [i, -radius], [i, radius]]) positions.push({ x: center.x + x! * (own.w + MIN_EDGE_GAP), y: center.y + y! * (own.h + MIN_EDGE_GAP) });
    }
  }
  return positions;
}

export function placeAddedNodes(input: PlacementInput): PlacementResult {
  let working = [...input.nodes];
  const pending = new Set(input.addedNodeIds), opened = new Set<string>();
  const routes = input.routes ?? [];
  const order = new Map(input.stage.graph.nodes.map((node) => [node.id, node.order]));
  const opensExisting = (id: string) => ancestorIds(working, id).some((parent) => !pending.has(parent) && !byId(working, parent).data.expanded);
  const ids = [...input.addedNodeIds].sort((a, b) => Number(opensExisting(b)) - Number(opensExisting(a)) || ancestorIds(working, a).length - ancestorIds(working, b).length || (order.get(a) ?? 0) - (order.get(b) ?? 0) || a.localeCompare(b));
  const placements: StagePlacementRecord[] = [], conflicts: StageConflict[] = [];

  for (const id of ids) {
    const ancestors = ancestorIds(working, id);
    let failed = false;
    for (const ancestor of ancestors) {
      const node = byId(working, ancestor);
      if (!node.data.expandable || node.data.expanded) continue;
      const next = node.data.frozen
        ? toggleFrozenExpansion(working, ancestor, true, input.frozenGroups)
        : replace(working, { ...node, type: 'structure', dragHandle: '.structure-header', data: { ...node.data, expanded: true } });
      let fitted: CanvasNode[] | undefined;
      for (const bias of [{ x: 0, y: 0 }, { x: -0.5, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: -0.5, y: -1 }, { x: -1, y: -1 }]) {
        fitted = fitChain(next, [...ancestorIds(next, ancestor), ancestor], input.stage, pending, node.data.frozen ? new Set() : new Set([ancestor]), bias);
        if (fitted && collisionFree(working, fitted, input.stage, pending)) break;
        fitted = undefined;
      }
      if (!fitted || !collisionFree(working, fitted, input.stage, pending)) {
        conflicts.push({ kind: 'no-space', entityIds: [id], containerId: ancestor, message: '必要容器无法展开而保持已确认布局', actions: ['expand', 'cancel'] });
        failed = true; break;
      }
      working = fitted; opened.add(ancestor);
    }
    if (failed) continue;

    const original = byId(working, id);
    const children = ids.filter((child) => byId(working, child).parentId === id);
    const columns = Math.min(3, children.length), rows = Math.ceil(children.length / 3);
    const width = 48 + columns * CARD_SIZE.width + Math.max(0, columns - 1) * MIN_EDGE_GAP;
    const height = 72 + rows * CARD_SIZE.height + Math.max(0, rows - 1) * MIN_EDGE_GAP + 24;
    const current = children.length && original.data.expandable && !original.data.expanded
      ? { ...original, type: 'structure', dragHandle: '.structure-header', width, height, measured: { width, height }, style: { ...original.style, width, height }, data: { ...original.data, expanded: true, contentWidth: width, contentHeight: height } }
      : original;
    const parent = current.parentId ? byId(working, current.parentId) : undefined;
    const parentWorld = parent ? worldPosition(parent, working) : { x: 0, y: 0 };
    const choices = candidates(current, working, input.stage, pending, input.preferredPositions?.[id]);
    if (parent) {
      const frame = box(parent, working), inset = containerInset(parent), own = size(current);
      const inside = (point: Point) => point.x >= frame.x + inset.x && point.y >= frame.y + inset.top && point.x + own.w <= frame.x + frame.w - inset.x && point.y + own.h <= frame.y + frame.h - inset.bottom;
      choices.sort((a, b) => Number(!inside(a)) - Number(!inside(b)));
    }
    let accepted: CanvasNode[] | undefined, acceptedMode: StagePlacementRecord['mode'] = 'gap';
    for (const [index, point] of choices.entries()) {
      const candidate = { ...current, position: { x: point.x - parentWorld.x, y: point.y - parentWorld.y } };
      const candidateBox = { ...point, ...size(candidate) };
      const projection = hierarchyProjection(working, input.stage);
      const siblings = working.filter((item) => item.id !== id && item.parentId === current.parentId && !pending.has(item.id) && nodeIsVisible(item, working, projection));
      if (siblings.some((sibling) => overlaps(candidateBox, box(sibling, working), candidate.type === 'card' && sibling.type === 'card' ? MIN_EDGE_GAP : GAP)) || routeBlocked(candidateBox, routes, input.reservedPaths ?? [], working, id)) continue;
      const trialPending = new Set(pending); trialPending.delete(id);
      const trial = replace(working, candidate);
      const fitted = fitChain(trial, ancestors, input.stage, trialPending, new Set());
      if (!fitted || !collisionFree(working, fitted, input.stage, trialPending)) continue;
      accepted = fitted;
      acceptedMode = input.preferredPositions?.[id] && index === 0 ? 'provided' : parent && (point.x < parentWorld.x || point.y < parentWorld.y || point.x + size(current).w > parentWorld.x + size(parent).w || point.y + size(current).h > parentWorld.y + size(parent).h) ? 'expanded' : 'gap';
      break;
    }
    if (!accepted) {
      conflicts.push({ kind: 'no-space', entityIds: [id], ...(parent ? { containerId: parent.id } : {}), message: '新增节点无法放入可用空隙或有限扩容区域', actions: ['expand', 'cancel'] });
      continue;
    }
    working = accepted; pending.delete(id); placements.push({ nodeId: id, mode: acceptedMode });
    if (current !== original) opened.add(id);
  }
  return { nodes: working, placements, expanded: [...opened], conflicts };
}
