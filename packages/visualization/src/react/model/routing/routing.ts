/** Diagram edge routing with obstacle collection and stub extension. */
import { compareRouteCost, type PortPolicy, type RouteCost } from '../../../core/layout/port-policy.ts';
import type { Projection } from '../../../core/projection/index.ts';
import {
  obstacleFromRect, portAnchor, routeOrthogonal, segmentBounds, segmentCrossesRect, simplifyPoints,
  type Point, type PortSide, type Rect,
} from '../../../core/layout/geometry.ts';
import { parseSlotHandle, slotFractions, type EndpointRole } from '../../../core/layout/node-port-allocator.ts';
import { validateRoute } from '../../../core/layout/legality.ts';
import { DEFAULT_SEARCH_LIMITS } from '../../../core/layout/search-limits.ts';
import { CARD_SIZE, structureHeaderHeight, type CanvasNode } from '../layout/node.ts';
import { nodeIsVisible } from '../layout/visibility.ts';
import { overlapLength } from './route-quality.ts';
import { SpatialIndex, expandBounds } from '../layout/spatial-index.ts';

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
  frozenOwnerId?: string;
  obstacle?: { nodeId: string; bounds: Rect };
}

/** 同一次交互更新中，所有失效边共享同一份几何。 */
type ReservedPart = { edgeId: string; rect: Rect; frozenOwnerId?: string };

export interface DiagramGeometry {
  bounds: Map<string, Rect>;
  blockers: Rect[];
  frames: Rect[];
  obstacles: Map<string, DiagramObstacle>;
  obstacleIndex: SpatialIndex<DiagramObstacle>;
  reserved: ReservedPart[];
  reservedIndex: SpatialIndex<ReservedPart>;
}

function reservedRects(reserved: readonly ReservedRoute[]): ReservedPart[] {
  return reserved.flatMap((route) => route.points.flatMap((point, index) => {
    if (index === 0) return [];
    return [{
      edgeId: route.edgeId, rect: expandBounds(segmentBounds(route.points[index - 1]!, point), 3),
      ...(route.frozenOwnerId ? { frozenOwnerId: route.frozenOwnerId } : {}),
    }];
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
  const reservedIndex = new SpatialIndex<ReservedPart>();
  reservedParts.forEach((entry, index) => reservedIndex.set(String(index), entry.rect, entry));
  return { bounds, blockers, frames, obstacles, obstacleIndex, reserved: reservedParts, reservedIndex };
}

/** 调用方缩小或移除受保护路径时，重建保留空间索引。 */
export function withReservedRoutes(geometry: DiagramGeometry, reserved: readonly ReservedPart[]): DiagramGeometry {
  const reservedIndex = new SpatialIndex<ReservedPart>();
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

const sourceSides: Record<string, Exclude<PortSide, 'auto'>> = { out: 'bottom', 'top-out': 'top', 'return-out': 'right', 'left-out': 'left' };
const targetSides: Record<string, Exclude<PortSide, 'auto'>> = { in: 'top', 'bottom-in': 'bottom', return: 'right', 'left-in': 'left' };

export function routeEndpoint(bounds: Rect | undefined, handle: string | undefined, role: EndpointRole) {
  if (!bounds || !handle) return undefined;
  const side = (role === 'source' ? sourceSides : targetSides)[handle];
  if (side) return { side, anchor: portAnchor(bounds, side) };
  const slot = parseSlotHandle(handle);
  if (!slot || slot.role !== role) return undefined;
  const fraction = slotFractions(slot.side === 'top' || slot.side === 'bottom' ? bounds.w : bounds.h)[slot.index];
  return fraction === undefined ? undefined : { side: slot.side, anchor: portAnchor(bounds, slot.side, fraction) };
}

/** 校验整条展示路径的端口、方向、折线与当前障碍。 */
export function routeIsLegal(route: { points: readonly Point[]; sourceHandle: string; targetHandle: string }, geometry: DiagramGeometry, sourceId: string, targetId: string, edgeId?: string): boolean {
  const source = routeEndpoint(geometry.bounds.get(sourceId), route.sourceHandle, 'source');
  const target = routeEndpoint(geometry.bounds.get(targetId), route.targetHandle, 'target');
  if (!source || !target) return false;
  return validateRoute({
    points: route.points, sourceId, targetId,
    sourceAnchor: source.anchor, sourceSide: source.side, targetAnchor: target.anchor, targetSide: target.side,
    requireAttachment: true,
    obstaclesAt: (rect) => geometry.obstacleIndex.query(rect),
    reservedAt: (rect) => geometry.reservedIndex.query(rect),
    ...(edgeId === undefined ? {} : { ignoreEdgeId: edgeId }),
  }).length === 0;
}

/** 同一冻结组捕获的内部路径共享几何，外部锁定路径继续作为障碍。 */
export function sharedFrozenGeometry(geometry: DiagramGeometry, edgeId: string): DiagramGeometry {
  const owners = new Set(geometry.reserved.flatMap((part) => part.edgeId === edgeId && part.frozenOwnerId ? [part.frozenOwnerId] : []));
  if (!owners.size) return geometry;
  return withReservedRoutes(geometry, geometry.reserved.filter((part) => !part.frozenOwnerId || !owners.has(part.frozenOwnerId)));
}

export function preferredSide(source: Rect, target: Rect): Exclude<PortSide, 'auto'> {
  const dx = target.x + target.w / 2 - source.x - source.w / 2;
  const dy = target.y + target.h / 2 - source.y - source.h / 2;
  return Math.abs(dx) > Math.abs(dy) * 1.15 ? dx > 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
}

const handlePair = {
  bottom: { sourceHandle: 'out', targetHandle: 'in' },
  top: { sourceHandle: 'top-out', targetHandle: 'bottom-in' },
  right: { sourceHandle: 'return-out', targetHandle: 'left-in' },
  left: { sourceHandle: 'left-out', targetHandle: 'return' },
};

function preferredHandles(geometry: DiagramGeometry, sourceId: string, targetId: string, policy: PortPolicy) {
  const side = policy.direction === 'top-down' ? 'bottom' : preferredSide(geometry.bounds.get(sourceId)!, geometry.bounds.get(targetId)!);
  return handlePair[side];
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
    if (!routeIsLegal(route, geometry, sourceId, targetId, edgeId)) continue;
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
  return best ?? { ...preferred, points: [] as Point[], feasible: false, cost: { length: Infinity, bends: Infinity, direction: Infinity, portCrowding: Infinity, overlap: Infinity } };
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
  return { ...handles, points };
}
