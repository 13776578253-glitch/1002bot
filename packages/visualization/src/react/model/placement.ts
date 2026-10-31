/** Deterministic gap filling for newly introduced stage nodes. */
import type { Projection } from '../../core/projection/index.ts';
import type { StageSnapshot } from '../../core/schema/types.ts';
import { rectIntersects, type Point, type Rect } from '../../core/layout/geometry.ts';
import {
  CARD_SIZE,
  MIN_EDGE_GAP,
  layoutProtectionConflict,
  separateSiblings,
  worldPosition,
  type CanvasNode,
} from './grouping.ts';
import { containerGrowthCeiling, containerInset, fitMovedContainers } from './spacing.ts';
import type { EdgeRouteSnapshot, FrozenGroupSnapshot, StagePlacementRecord } from './workspace.ts';
import type { StageConflict } from './stage-types.ts';

export interface PlacementInput {
  nodes: readonly CanvasNode[];
  stage: StageSnapshot;
  projection: Projection;
  addedNodeIds: readonly string[];
  preferredPositions?: Readonly<Record<string, { x: number; y: number }>>;
  frozenGroups?: readonly FrozenGroupSnapshot[];
  routes?: readonly EdgeRouteSnapshot[];
}

export interface PlacementResult {
  nodes: CanvasNode[];
  placements: StagePlacementRecord[];
  expanded: string[];
  conflicts: StageConflict[];
}

interface Candidate {
  position: Point;
  score: number;
  mode: StagePlacementRecord['mode'];
}

const EPSILON = 0.001;
const GRID_STEP = 32;
const MAX_CANDIDATES = 360;

const size = (node: CanvasNode) => ({ w: node.width ?? CARD_SIZE.width, h: node.height ?? CARD_SIZE.height });

function worldRect(node: CanvasNode, nodes: readonly CanvasNode[]): Rect {
  const origin = worldPosition(node, nodes), extent = size(node);
  return { x: origin.x, y: origin.y, w: extent.w, h: extent.h };
}

function nodeById(nodes: readonly CanvasNode[], id: string): CanvasNode | undefined {
  return nodes.find((node) => node.id === id);
}

function parentOf(nodes: readonly CanvasNode[], id: string): string | undefined {
  return nodeById(nodes, id)?.parentId;
}

function isDescendant(nodes: readonly CanvasNode[], candidateId: string, ancestorId: string): boolean {
  let parent = parentOf(nodes, candidateId);
  while (parent) {
    if (parent === ancestorId) return true;
    parent = parentOf(nodes, parent);
  }
  return false;
}

function depthOf(nodes: readonly CanvasNode[], node: CanvasNode): number {
  let depth = 0, parent = node.parentId;
  while (parent) { depth += 1; parent = parentOf(nodes, parent); }
  return depth;
}

function groupContaining(groups: readonly FrozenGroupSnapshot[], id: string | undefined): FrozenGroupSnapshot | undefined {
  if (!id) return undefined;
  return groups.find((group) => group.rootId === id || group.memberIds.includes(id));
}

function routePoints(route: EdgeRouteSnapshot, nodes: readonly CanvasNode[]): Point[] | undefined {
  if (route.space.kind === 'world') return route.points;
  const owner = nodeById(nodes, route.space.ownerId);
  if (!owner) return undefined;
  const origin = worldPosition(owner, nodes);
  return route.points.map((point) => ({ x: point.x + origin.x, y: point.y + origin.y }));
}

function segmentCrosses(rect: Rect, from: Point, to: Point): boolean {
  if (from.y === to.y) return from.y > rect.y && from.y < rect.y + rect.h && Math.max(from.x, to.x) > rect.x && Math.min(from.x, to.x) < rect.x + rect.w;
  return from.x > rect.x && from.x < rect.x + rect.w && Math.max(from.y, to.y) > rect.y && Math.min(from.y, to.y) < rect.y + rect.h;
}

function routeCollides(rect: Rect, routes: readonly EdgeRouteSnapshot[], nodes: readonly CanvasNode[], addedId: string): boolean {
  for (const route of routes) {
    if (route.state === 'auto' || route.source.nodeId === addedId || route.target.nodeId === addedId) continue;
    const points = routePoints(route, nodes);
    if (!points) continue;
    for (let index = 1; index < points.length; index += 1) {
      if (segmentCrosses(rect, points[index - 1]!, points[index]!)) return true;
    }
  }
  return false;
}

function insideParent(rect: Rect, parent: CanvasNode, parentWorld: Point): boolean {
  const inset = containerInset(parent), extent = size(parent);
  return rect.x >= parentWorld.x + inset.x - EPSILON
    && rect.y >= parentWorld.y + inset.top - EPSILON
    && rect.x + rect.w <= parentWorld.x + extent.w - inset.x + EPSILON
    && rect.y + rect.h <= parentWorld.y + extent.h - inset.bottom + EPSILON;
}

function collides(rect: Rect, gap: number, blockers: readonly Rect[]): boolean {
  return blockers.some((blocker) => rectIntersects(
    { x: rect.x - gap, y: rect.y - gap, w: rect.w + gap * 2, h: rect.h + gap * 2 },
    blocker,
  ));
}

function positionsFor(nodeId: string, nodes: readonly CanvasNode[], stage: StageSnapshot): { point: Point; score: number }[] {
  const node = nodeById(nodes, nodeId);
  if (!node) return [];
  const related = new Map<string, number>();
  for (const edge of [...stage.graph.edges].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    if (edge.source.nodeId === nodeId && edge.target.nodeId !== nodeId) related.set(edge.target.nodeId, related.get(edge.target.nodeId) ?? edge.order);
    if (edge.target.nodeId === nodeId && edge.source.nodeId !== nodeId) related.set(edge.source.nodeId, related.get(edge.source.nodeId) ?? edge.order);
  }
  const targets = [...related.keys()].flatMap((id) => nodeById(nodes, id) ?? []).filter((item) => item.id !== nodeId);
  const output: { point: Point; score: number }[] = [];
  for (const target of targets) {
    const rect = worldRect(target, nodes), extent = size(node);
    const offsets = [
      { x: rect.x + rect.w + MIN_EDGE_GAP, y: rect.y },
      { x: rect.x - extent.w - MIN_EDGE_GAP, y: rect.y },
      { x: rect.x, y: rect.y + rect.h + MIN_EDGE_GAP },
      { x: rect.x, y: rect.y - extent.h - MIN_EDGE_GAP },
      { x: rect.x + (rect.w - extent.w) / 2, y: rect.y + rect.h + MIN_EDGE_GAP },
      { x: rect.x + (rect.w - extent.w) / 2, y: rect.y - extent.h - MIN_EDGE_GAP },
    ];
    for (const point of offsets) output.push({ point, score: Math.hypot(point.x - rect.x, point.y - rect.y) });
  }
  return output;
}

function gridPositions(nodeId: string, nodes: readonly CanvasNode[]): { point: Point; score: number }[] {
  const node = nodeById(nodes, nodeId);
  if (!node) return [];
  const parent = node.parentId ? nodeById(nodes, node.parentId) : undefined;
  const output: { point: Point; score: number }[] = [];
  if (parent) {
    const inset = containerInset(parent), extent = size(parent), own = size(node);
    const origin = worldPosition(parent, nodes);
    const x0 = inset.x, x1 = extent.w - inset.x - own.w;
    const y0 = inset.top, y1 = extent.h - inset.bottom - own.h;
    if (x1 < x0 || y1 < y0) return output;
    for (let x = x0; x <= x1 && output.length < MAX_CANDIDATES; x += GRID_STEP) {
      for (let y = y0; y <= y1 && output.length < MAX_CANDIDATES; y += GRID_STEP) {
        output.push({ point: { x: origin.x + x, y: origin.y + y }, score: Math.hypot(x - x0, y - y0) });
      }
    }
    return output;
  }
  const visible = nodes.filter((item) => item.id !== nodeId);
  const minX = visible.length ? Math.min(...visible.map((item) => worldRect(item, nodes).x)) : 0;
  const minY = visible.length ? Math.min(...visible.map((item) => worldRect(item, nodes).y)) : 0;
  const maxX = visible.length ? Math.max(...visible.map((item) => { const rect = worldRect(item, nodes); return rect.x + rect.w; })) : CARD_SIZE.width;
  const maxY = visible.length ? Math.max(...visible.map((item) => { const rect = worldRect(item, nodes); return rect.y + rect.h; })) : CARD_SIZE.height;
  const x0 = minX - CARD_SIZE.width * 3, x1 = maxX + CARD_SIZE.width * 3;
  const y0 = minY - CARD_SIZE.height * 3, y1 = maxY + CARD_SIZE.height * 3;
  for (let x = x0; x <= x1 && output.length < MAX_CANDIDATES; x += GRID_STEP * 2) {
    for (let y = y0; y <= y1 && output.length < MAX_CANDIDATES; y += GRID_STEP * 2) {
      output.push({ point: { x, y }, score: Math.hypot(x - minX, y - minY) });
    }
  }
  return output;
}

function localPoint(point: Point, parent: CanvasNode | undefined, nodes: readonly CanvasNode[]): Point {
  if (!parent) return point;
  const origin = worldPosition(parent, nodes);
  return { x: point.x - origin.x, y: point.y - origin.y };
}

function candidateNodes(node: CanvasNode, point: Point, parent: CanvasNode | undefined, nodes: readonly CanvasNode[]): Point {
  return localPoint(point, parent, nodes);
}

function replace(nodes: readonly CanvasNode[], node: CanvasNode): CanvasNode[] {
  return nodes.map((item) => item.id === node.id ? node : item);
}

function affectedContainers(nodes: readonly CanvasNode[], addedIds: readonly string[]): Set<string> {
  const affected = new Set<string>();
  for (const id of addedIds) {
    let parent = parentOf(nodes, id);
    while (parent) { affected.add(parent); parent = parentOf(nodes, parent); }
  }
  return affected;
}

function ceilingsHold(nodes: readonly CanvasNode[], affected: ReadonlySet<string>): boolean {
  for (const id of affected) {
    const node = nodeById(nodes, id);
    if (!node || node.type === 'card') continue;
    const ceiling = containerGrowthCeiling(node);
    if ((node.width ?? 0) > ceiling.width + EPSILON || (node.height ?? 0) > ceiling.height + EPSILON) return false;
  }
  return true;
}

/**
 * Place added nodes into legal gaps or grow their containers within the retained ceiling.
 *
 * Candidates are deterministic: related-node neighbours, then a bounded local grid,
 * then a limited right/bottom expansion. Protected nodes never enter the moved set.
 */
export function placeAddedNodes(input: PlacementInput): PlacementResult {
  const working: CanvasNode[] = input.nodes.map((node) => ({ ...node, position: { ...node.position } }));
  const original = working.map((node) => ({ ...node, position: { ...node.position } }));
  const frozenGroups = input.frozenGroups ?? [];
  const routes = input.routes ?? [];
  const visible = new Set(input.projection.nodes.map((node) => node.id));
  const frozenMembers = new Set(frozenGroups.flatMap((group) => [group.rootId, ...group.memberIds]));
  const order = new Map(input.stage.graph.nodes.map((node) => [node.id, node.order]));
  const added = input.addedNodeIds
    .flatMap((id) => nodeById(working, id) ?? [])
    .sort((a, b) => depthOf(working, a) - depthOf(working, b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.id.localeCompare(b.id));
  const placements: StagePlacementRecord[] = [];
  const conflicts: StageConflict[] = [];

  for (const node of added) {
    const current = nodeById(working, node.id);
    if (!current) continue;
    const parent = current.parentId ? nodeById(working, current.parentId) : undefined;
    const frozen = groupContaining(frozenGroups, parent?.id);
    if (frozen) {
      conflicts.push({ kind: 'frozen-violation', entityIds: [current.id], containerId: frozen.rootId, message: '新增节点位于冻结子图内，需先解冻或调整归属', actions: ['unfreeze', 'cancel'] });
      continue;
    }

    const blockers: Rect[] = working.flatMap((item) => {
      if (item.id === current.id) return [];
      if (isDescendant(working, current.id, item.id)) return [];
      if (isDescendant(working, item.id, current.id)) return [];
      if (item.parentId === current.parentId) return [worldRect(item, working)];
      if (visible.has(item.id) || frozenMembers.has(item.id)) return [worldRect(item, working)];
      return [];
    });
    for (const group of frozenGroups) blockers.push({ ...group.worldBounds });
    const parentWorld = parent ? worldPosition(parent, working) : undefined;
    const preferred = input.preferredPositions?.[current.id];
    const valid = (candidate: CanvasNode, gap: number, allowOutside: boolean, state: readonly CanvasNode[] = working): boolean => {
      const rect = worldRect(candidate, state);
      const currentParent = parent && nodeById(state, parent.id);
      if (currentParent && !allowOutside && !insideParent(rect, currentParent, worldPosition(currentParent, state))) return false;
      return !collides(rect, gap, blockers) && !routeCollides(rect, routes, working, current.id);
    };

    if (preferred) {
      const candidate = { ...current, position: preferred };
      if (valid(candidate, 0, false)) {
        working.splice(working.findIndex((item) => item.id === current.id), 1, candidate);
        placements.push({ nodeId: current.id, mode: 'provided' });
        continue;
      }
    }

    const candidates: Candidate[] = [];
    for (const candidate of [...positionsFor(current.id, working, input.stage), ...gridPositions(current.id, working)]) {
      candidates.push({ position: candidateNodes(current, candidate.point, parent, working), score: candidate.score, mode: 'gap' });
    }
    if (parent) {
      const inset = containerInset(parent), extent = size(parent);
      candidates.push({ position: { x: extent.w - inset.x + 24, y: inset.top }, score: 1e6, mode: 'expanded' });
      candidates.push({ position: { x: inset.x, y: extent.h - inset.bottom + 24 }, score: 1e6, mode: 'expanded' });
    } else {
      const boxes = working.map((item) => worldRect(item, working));
      const maxX = boxes.length ? Math.max(...boxes.map((rect) => rect.x + rect.w)) : 0;
      const minY = boxes.length ? Math.min(...boxes.map((rect) => rect.y)) : 0;
      candidates.push({ position: { x: maxX + MIN_EDGE_GAP, y: minY }, score: 1e6, mode: 'expanded' });
    }
    candidates.sort((a, b) => a.score - b.score || a.position.y - b.position.y || a.position.x - b.position.x);

    let placed = false;
    for (const choice of candidates) {
      const candidate = { ...current, position: choice.position };
      if (!valid(candidate, choice.mode === 'expanded' ? 0 : 24, choice.mode === 'expanded')) continue;
      if (choice.mode === 'expanded') {
        let trial = replace(working, candidate);
        trial = fitMovedContainers(trial, [current.id]);
        trial = separateSiblings(trial, current.id, true);
        const fitted = nodeById(trial, current.id)!;
        const affected = affectedContainers(trial, [current.id]);
        if (layoutProtectionConflict(original, trial) || !ceilingsHold(trial, affected) || !valid(fitted, 0, false, trial)) continue;
        working.splice(0, working.length, ...trial);
      } else {
        working.splice(working.findIndex((item) => item.id === current.id), 1, candidate);
      }
      placements.push({ nodeId: current.id, mode: choice.mode });
      placed = true;
      break;
    }
    if (!placed) {
      conflicts.push({
        kind: 'no-space', entityIds: [current.id], ...(parent ? { containerId: parent.id } : {}),
        message: '新增节点没有可用空隙，容器扩容也已达到上限', actions: ['expand', 'move-free-nodes', 'cancel'],
      });
    }
  }

  if (!conflicts.length) {
    const fitted = fitMovedContainers(working, added.map((node) => node.id));
    const affected = affectedContainers(fitted, added.map((node) => node.id));
    if (layoutProtectionConflict(original, fitted) || !ceilingsHold(fitted, affected)) {
      conflicts.push({ kind: 'growth-ceiling', entityIds: added.map((node) => node.id), message: '阶段布局超出了受保护容器或扩容上限', actions: ['expand', 'move-free-nodes', 'cancel'] });
    } else {
      working.splice(0, working.length, ...fitted);
    }
  }

  return { nodes: working, placements, expanded: [], conflicts };
}
