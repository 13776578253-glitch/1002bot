/** Diagram edge routing with obstacle collection and stub extension. */
import { compareRouteCost, type PortPolicy, type RouteCost } from '../../core/layout/port-policy.ts';
import type { Projection } from '../../core/projection/index.ts';
import {
  midpointOfPoints, obstacleFromRect, portAnchor, routeOrthogonal, segmentBounds, segmentCrossesRect, simplifyPoints,
  type Point, type PortSide, type Rect,
} from '../../core/layout/geometry.ts';
import { validateRoute } from '../../core/layout/legality.ts';
import { DEFAULT_SEARCH_LIMITS } from '../../core/layout/search-limits.ts';
import { CARD_SIZE, structureHeaderHeight, type CanvasNode } from './grouping.ts';
import { nodeIsVisible } from './hierarchy.ts';
import { SpatialIndex, expandBounds } from './spatial-index.ts';

export interface DiagramObstacle {
  id: string;
  bounds: Rect;
  padded: Rect;
  card: boolean;
  endpointBounds?: Rect;
}

export interface ReservedRoute {
  edgeId: string;
  points: Point[];
  obstacle?: { nodeId: string; bounds: Rect };
}

/** Geometry is shared by all invalidated edges in one interaction update. */
export interface DiagramGeometry {
  bounds: Map<string, Rect>;
  blockers: Rect[];
  frames: Rect[];
  obstacles: Map<string, DiagramObstacle>;
  obstacleIndex: SpatialIndex<DiagramObstacle>;
  reserved: { edgeId: string; rect: Rect }[];
  reservedIndex: SpatialIndex<{ edgeId: string; rect: Rect }>;
}

function reservedRects(reserved: readonly ReservedRoute[]): { edgeId: string; rect: Rect }[] {
  return reserved.flatMap((route) => route.points.flatMap((point, index) => {
    if (index === 0) return [];
    return [{ edgeId: route.edgeId, rect: expandBounds(segmentBounds(route.points[index - 1]!, point), 3) }];
  }));
}

export function createDiagramGeometry(nodes: readonly CanvasNode[], projection: Projection, reserved: readonly ReservedRoute[] = []): DiagramGeometry {
  const protectedFrames = new Map(reserved.flatMap(route => route.obstacle ? [[route.obstacle.nodeId, route.obstacle.bounds] as const] : []));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const bounds = new Map<string, Rect>();
  const rect = (node: CanvasNode): Rect => {
    const cached = bounds.get(node.id);
    if (cached) return cached;
    const parent = node.parentId ? rect(byId.get(node.parentId)!) : { x: 0, y: 0 };
    const result = { x: parent.x + node.position.x, y: parent.y + node.position.y, w: node.width ?? CARD_SIZE.width, h: node.height ?? CARD_SIZE.height };
    bounds.set(node.id, result);
    return result;
  };
  const blockers: Rect[] = [], frames: Rect[] = [];
  const obstacles = new Map<string, DiagramObstacle>();
  const obstacleIndex = new SpatialIndex<DiagramObstacle>();
  for (const node of nodes) {
    const full = rect(node);
    if (!nodeIsVisible(node, nodes, projection)) continue;
    const card = node.type === 'card';
    const obstacle = protectedFrames.get(node.id) ?? (card ? full : { ...full, h: node.type === 'structure' ? structureHeaderHeight(node) : 54 });
    const entry = { id: node.id, bounds: obstacle, padded: expandBounds(obstacle, card ? 10 : 0), card, endpointBounds: card ? full : { ...full, h: node.type === 'structure' ? structureHeaderHeight(node) : 54 } };
    obstacles.set(node.id, entry);
    obstacleIndex.set(node.id, entry.padded, entry);
    blockers.push(obstacle);
    if (!card) frames.push(full);
  }
  const reservedParts = reservedRects(reserved);
  const reservedIndex = new SpatialIndex<{ edgeId: string; rect: Rect }>();
  reservedParts.forEach((entry, index) => reservedIndex.set(String(index), entry.rect, entry));
  return { bounds, blockers, frames, obstacles, obstacleIndex, reserved: reservedParts, reservedIndex };
}

/** Rebuilds the reserved spatial index when a caller narrows or drops protected paths. */
export function withReservedRoutes(geometry: DiagramGeometry, reserved: readonly { edgeId: string; rect: Rect }[]): DiagramGeometry {
  const reservedIndex = new SpatialIndex<{ edgeId: string; rect: Rect }>();
  reserved.forEach((entry, index) => reservedIndex.set(String(index), entry.rect, entry));
  return { ...geometry, reserved: [...reserved], reservedIndex };
}

export { segmentBounds, segmentCrossesRect };

export function pathIsClear(points: readonly Point[], geometry: DiagramGeometry, sourceId: string, targetId: string, ignoreEdgeId?: string): boolean {
  return validateRoute({
    points,
    sourceId,
    targetId,
    obstaclesAt: (rect) => geometry.obstacleIndex.query(rect),
    reservedAt: (rect) => geometry.reservedIndex.query(rect),
    requireOrthogonal: false,
    ...(ignoreEdgeId === undefined ? {} : { ignoreEdgeId }),
  }).length === 0;
}

/**
 * 计算两节点间的图表连线正交避障路由。
 * 收集可见卡片与容器标题栏障碍物，从两端连接桩向外延伸引脚 stub，执行 A* 避障并输出平滑折线点集。
 */
export function routeDiagramEdge(nodes: readonly CanvasNode[], projection: Projection, sourceId: string, targetId: string, geometry = createDiagramGeometry(nodes, projection)) {
  return routeDiagramGeometry(geometry, sourceId, targetId);
}

export interface RouteOccupancy {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  points: readonly Point[];
}

const sourceSides: Record<string, PortSide> = { out: 'bottom', 'top-out': 'top', 'return-out': 'right', 'left-out': 'left' };
const targetSides: Record<string, PortSide> = { in: 'top', 'bottom-in': 'bottom', return: 'right', 'left-in': 'left' };

function preferredHandles(geometry: DiagramGeometry, sourceId: string, targetId: string, policy: PortPolicy) {
  if (policy.direction === 'top-down') return { sourceHandle: 'out', targetHandle: 'in' };
  const source = geometry.bounds.get(sourceId)!, target = geometry.bounds.get(targetId)!;
  const dx = target.x + target.w / 2 - source.x - source.w / 2;
  const dy = target.y + target.h / 2 - source.y - source.h / 2;
  return Math.abs(dx) > Math.abs(dy) * 1.15
    ? dx > 0 ? { sourceHandle: 'return-out', targetHandle: 'left-in' } : { sourceHandle: 'left-out', targetHandle: 'return' }
    : dy >= 0 ? { sourceHandle: 'out', targetHandle: 'in' } : { sourceHandle: 'top-out', targetHandle: 'bottom-in' };
}

function overlapLength(a: readonly Point[], b: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const p = a[i - 1]!, q = a[i]!, r = b[j - 1]!, s = b[j]!;
    if (p.y === q.y && r.y === s.y && p.y === r.y) total += Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)));
    if (p.x === q.x && r.x === s.x && p.x === r.x) total += Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)));
  }
  return total;
}

export function routeDiagramGeometry(geometry: DiagramGeometry, sourceId: string, targetId: string, edgeId?: string, policy: PortPolicy = {}, occupied: readonly RouteOccupancy[] = []) {
  const preferred = preferredHandles(geometry, sourceId, targetId, policy);
  type Candidate = ReturnType<typeof routeWithHandles> & { feasible: boolean; cost: RouteCost };
  let best: Candidate | undefined;
  const peers = occupied.filter(route => route.id !== edgeId);
  const sourceHandles = [...new Set([preferred.sourceHandle, 'out', 'return-out', 'left-out', 'top-out'])];
  const targetHandles = [...new Set([preferred.targetHandle, 'in', 'left-in', 'return', 'bottom-in'])];
  for (const sourceHandle of sourceHandles) for (const targetHandle of targetHandles) {
    const route = routeWithHandles(geometry, sourceId, targetId, edgeId, { sourceHandle, targetHandle });
    if (!pathIsClear(route.points, geometry, sourceId, targetId, edgeId) || !attachedOutward(route.points, sourceSides[sourceHandle]!, targetSides[targetHandle]!)) continue;
    const cost: RouteCost = {
      length: route.points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - route.points[index]!.x) + Math.abs(point.y - route.points[index]!.y), 0),
      bends: Math.max(0, route.points.length - 2),
      direction: Number(sourceHandle !== preferred.sourceHandle) + Number(targetHandle !== preferred.targetHandle),
      portCrowding: peers.reduce((sum, route) => sum + Number(route.source === sourceId && route.sourceHandle === sourceHandle) + Number(route.target === sourceId && targetSides[route.targetHandle] === sourceSides[sourceHandle]) + Number(route.target === targetId && route.targetHandle === targetHandle) + Number(route.source === targetId && sourceSides[route.sourceHandle] === targetSides[targetHandle]), 0),
      overlap: peers.reduce((sum, peer) => sum + overlapLength(route.points, peer.points), 0),
    };
    const candidate = { ...route, feasible: true, cost };
    if (!best || compareRouteCost(cost, best.cost, policy) < 0) best = candidate;
  }
  return best ?? { ...preferred, points: [] as Point[], label: { x: 0, y: 0 }, feasible: false, cost: { length: Infinity, bends: Infinity, direction: Infinity, portCrowding: Infinity, overlap: Infinity } };
}

function attachedOutward(points: readonly Point[], sourceSide: PortSide, targetSide: PortSide): boolean {
  if (points.length < 2) return false;
  const outside = (anchor: Point, next: Point, side: PortSide) => side === 'left' ? next.x < anchor.x && next.y === anchor.y : side === 'right' ? next.x > anchor.x && next.y === anchor.y : side === 'top' ? next.y < anchor.y && next.x === anchor.x : next.y > anchor.y && next.x === anchor.x;
  return outside(points[0]!, points[1]!, sourceSide) && outside(points.at(-1)!, points.at(-2)!, targetSide);
}

function routeWithHandles(geometry: DiagramGeometry, sourceId: string, targetId: string, edgeId: string | undefined, handles: { sourceHandle: string; targetHandle: string }) {
  const source = geometry.bounds.get(sourceId)!, target = geometry.bounds.get(targetId)!;
  const sourceSide = sourceSides[handles.sourceHandle]!, targetSide = targetSides[handles.targetHandle]!;
  const start = portAnchor(source, sourceSide), end = portAnchor(target, targetSide);

  // 收集可见卡片全包围盒与容器顶部标题栏避障区域（结构容器内部可走线，但避开头部）
  const selected = new Map(geometry.obstacleIndex.query(expandBounds(segmentBounds(start, end), 64)).map((entry) => [entry.id, entry]));
  selected.set(sourceId, geometry.obstacles.get(sourceId)!);
  selected.set(targetId, geometry.obstacles.get(targetId)!);
  const obstacleBounds = (entry: DiagramObstacle) => entry.id === sourceId || entry.id === targetId ? entry.endpointBounds ?? entry.bounds : entry.padded;
  const corridor = expandBounds(segmentBounds(start, end), 66);
  const reservedObstacles = geometry.reservedIndex.query(corridor).filter((entry) => entry.edgeId !== edgeId).map((entry) => obstacleFromRect(entry.rect, 2));
  const obstacleList = () => [...selected.values()].map((entry) => obstacleFromRect(obstacleBounds(entry))).concat(reservedObstacles);
  let obstacles = obstacleList();

  // 向外延伸垂直或水平引脚 stub，防止折角紧贴卡片边框
  const extend = (point: Point, side: PortSide): Point => {
    let stub = point;
    for (let distance = 28; distance >= 4; distance -= 4) {
      stub = {
        x: point.x + (side === 'right' ? distance : side === 'left' ? -distance : 0),
        y: point.y + (side === 'bottom' ? distance : side === 'top' ? -distance : 0),
      };
      if (!obstacles.some((obstacle) => stub.x > obstacle.left && stub.x < obstacle.right && stub.y > obstacle.top && stub.y < obstacle.bottom)) break;
    }
    return stub;
  };

  const startStub = extend(start, sourceSide), endStub = extend(end, targetSide);
  let points: Point[] = [];
  for (let iteration = 0; iteration < DEFAULT_SEARCH_LIMITS.maxStitchIterations; iteration += 1) {
    const middle = routeOrthogonal({ ...startStub, w: 0, h: 0 }, { ...endStub, w: 0, h: 0 }, obstacles, { offset: 0, padding: 10, startAxis: sourceSide === 'top' || sourceSide === 'bottom' ? 1 : 0, endAxis: targetSide === 'top' || targetSide === 'bottom' ? 1 : 0 });
    points = simplifyPoints([start, ...middle, end]);
    const additions = new Map<string, DiagramObstacle>();
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!, to = points[index]!;
      for (const entry of geometry.obstacleIndex.query(segmentBounds(from, to))) {
        if (!selected.has(entry.id) && segmentCrossesRect(from, to, obstacleBounds(entry))) additions.set(entry.id, entry);
      }
    }
    if (!additions.size) break;
    for (const [id, entry] of additions) selected.set(id, entry);
    obstacles = obstacleList();
  }
  return { ...handles, points, label: midpointOfPoints(points) };
}
