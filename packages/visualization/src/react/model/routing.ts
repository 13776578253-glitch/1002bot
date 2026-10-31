/** Diagram edge routing with obstacle collection and stub extension. */
import type { Projection } from '../../core/projection/index.ts';
import {
  midpointOfPoints, obstacleFromRect, portAnchor, routeOrthogonal, simplifyPoints,
  type Point, type PortSide, type Rect,
} from '../../core/layout/geometry.ts';
import { CARD_SIZE, type CanvasNode } from './grouping.ts';
import { nodeIsVisible } from './hierarchy.ts';
import { SpatialIndex, expandBounds } from './spatial-index.ts';

export interface DiagramObstacle {
  id: string;
  bounds: Rect;
  padded: Rect;
  card: boolean;
}

export interface ReservedRoute {
  edgeId: string;
  points: Point[];
}

/** Geometry is shared by all invalidated edges in one interaction update. */
export interface DiagramGeometry {
  bounds: Map<string, Rect>;
  blockers: Rect[];
  frames: Rect[];
  obstacles: Map<string, DiagramObstacle>;
  obstacleIndex: SpatialIndex<DiagramObstacle>;
  reserved: { edgeId: string; rect: Rect }[];
}

function reservedRects(reserved: readonly ReservedRoute[]): { edgeId: string; rect: Rect }[] {
  return reserved.flatMap((route) => route.points.flatMap((point, index) => {
    if (index === 0) return [];
    return [{ edgeId: route.edgeId, rect: expandBounds(segmentBounds(route.points[index - 1]!, point), 3) }];
  }));
}

export function createDiagramGeometry(nodes: readonly CanvasNode[], projection: Projection, reserved: readonly ReservedRoute[] = []): DiagramGeometry {
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
    const obstacle = card ? full : { ...full, h: node.type === 'structure' ? 68 : 54 };
    const entry = { id: node.id, bounds: obstacle, padded: expandBounds(obstacle, card ? 10 : 0), card };
    obstacles.set(node.id, entry);
    obstacleIndex.set(node.id, entry.padded, entry);
    blockers.push(obstacle);
    if (!card) frames.push(full);
  }
  return { bounds, blockers, frames, obstacles, obstacleIndex, reserved: reservedRects(reserved) };
}

export function segmentBounds(from: Point, to: Point): Rect {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) };
}

export function segmentCrossesRect(from: Point, to: Point, rect: Rect): boolean {
  if (from.y === to.y) return from.y > rect.y && from.y < rect.y + rect.h && Math.max(from.x, to.x) > rect.x && Math.min(from.x, to.x) < rect.x + rect.w;
  return from.x > rect.x && from.x < rect.x + rect.w && Math.max(from.y, to.y) > rect.y && Math.min(from.y, to.y) < rect.y + rect.h;
}

export function pathIsClear(points: readonly Point[], geometry: DiagramGeometry, sourceId: string, targetId: string, ignoreEdgeId?: string): boolean {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!;
    for (const obstacle of geometry.obstacleIndex.query(segmentBounds(from, to))) {
      const bounds = obstacle.id === sourceId || obstacle.id === targetId ? obstacle.bounds : obstacle.padded;
      if (segmentCrossesRect(from, to, bounds)) return false;
    }
    for (const reserved of geometry.reserved) {
      if (reserved.edgeId !== ignoreEdgeId && segmentCrossesRect(from, to, reserved.rect)) return false;
    }
  }
  return true;
}

/**
 * 计算两节点间的图表连线正交避障路由。
 * 收集可见卡片与容器标题栏障碍物，从两端连接桩向外延伸引脚 stub，执行 A* 避障并输出平滑折线点集。
 */
export function routeDiagramEdge(nodes: readonly CanvasNode[], projection: Projection, sourceId: string, targetId: string, geometry = createDiagramGeometry(nodes, projection)) {
  return routeDiagramGeometry(geometry, sourceId, targetId);
}

export function routeDiagramGeometry(geometry: DiagramGeometry, sourceId: string, targetId: string, edgeId?: string) {
  const source = geometry.bounds.get(sourceId)!, target = geometry.bounds.get(targetId)!;
  const dx = target.x + target.w / 2 - source.x - source.w / 2;
  const dy = target.y + target.h / 2 - source.y - source.h / 2;
  const handles = Math.abs(dx) > Math.abs(dy) * 1.15
    ? dx > 0 ? { sourceHandle: 'return-out', targetHandle: 'left-in' } : { sourceHandle: 'left-out', targetHandle: 'return' }
    : dy >= 0 ? { sourceHandle: 'out', targetHandle: 'in' } : { sourceHandle: 'top-out', targetHandle: 'bottom-in' };
  const sourceSides: Record<string, PortSide> = { out: 'bottom', 'top-out': 'top', 'return-out': 'right', 'left-out': 'left' };
  const targetSides: Record<string, PortSide> = { in: 'top', 'bottom-in': 'bottom', return: 'right', 'left-in': 'left' };
  const sourceSide = sourceSides[handles.sourceHandle]!, targetSide = targetSides[handles.targetHandle]!;
  const start = portAnchor(source, sourceSide), end = portAnchor(target, targetSide);

  // 收集可见卡片全包围盒与容器顶部标题栏避障区域（结构容器内部可走线，但避开头部）
  const selected = new Map(geometry.obstacleIndex.query(expandBounds(segmentBounds(start, end), 64)).map((entry) => [entry.id, entry]));
  selected.set(sourceId, geometry.obstacles.get(sourceId)!);
  selected.set(targetId, geometry.obstacles.get(targetId)!);
  const obstacleBounds = (entry: DiagramObstacle) => entry.id === sourceId || entry.id === targetId ? entry.bounds : entry.padded;
  const reservedObstacles = geometry.reserved.filter((entry) => entry.edgeId !== edgeId).map((entry) => obstacleFromRect(entry.rect, 2));
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
  let points: Point[];
  while (true) {
    const middle = routeOrthogonal({ ...startStub, w: 0, h: 0 }, { ...endStub, w: 0, h: 0 }, obstacles, { offset: 0, padding: 10 });
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
