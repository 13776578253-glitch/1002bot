/** Frozen route fragments and connectors, with validation against current exterior geometry. */
import { obstacleFromRect, routeOrthogonal, simplifyPoints, type Point, type Rect } from '../../../core/layout/geometry.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from '../layout/node.ts';
import { pathIsClear, routeEndpoint, segmentCrossesRect, withReservedRoutes, type DiagramGeometry } from './routing.ts';
import type { CachedRoute } from './route-cache.ts';
import type { EdgeRouteSnapshot, FrozenBoundarySegment, FrozenBoundarySide, FrozenGroupSnapshot } from '../contracts/snapshot-types.ts';

const EPSILON = 0.001;
const size = (n: CanvasNode) => ({ width: n.width ?? CARD_SIZE.width, height: n.height ?? CARD_SIZE.height });
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const hasPoint = (rect: Rect, point: Point) => point.x >= rect.x - EPSILON && point.x <= rect.x + rect.w + EPSILON && point.y >= rect.y - EPSILON && point.y <= rect.y + rect.h + EPSILON;

/** 提取实际的第一个出口，包括边框上的精确端口。 */
export function frozenBoundary(points: readonly Point[], rect: Rect, ownerId: string, endpoint: 'source' | 'target'): FrozenBoundarySegment | undefined {
  const ordered = endpoint === 'source' ? points : [...points].reverse();
  if (!ordered.length || !hasPoint(rect, ordered[0]!)) return undefined;
  const inner: Point[] = [{ ...ordered[0]! }];
  for (let index = 1; index < ordered.length; index++) {
    const a = ordered[index - 1]!, b = ordered[index]!;
    if (hasPoint(rect, b)) { inner.push({ ...b }); continue; }
    let intersection: Point, side: FrozenBoundarySide;
    if (Math.abs(a.y - b.y) < EPSILON) {
      side = b.x > rect.x + rect.w ? 'right' : 'left'; intersection = { x: side === 'right' ? rect.x + rect.w : rect.x, y: a.y };
    } else if (Math.abs(a.x - b.x) < EPSILON) {
      side = b.y > rect.y + rect.h ? 'bottom' : 'top'; intersection = { x: a.x, y: side === 'bottom' ? rect.y + rect.h : rect.y };
    } else return undefined;
    if (!samePoint(inner.at(-1)!, intersection)) inner.push(intersection);
    return { ownerId, endpoint, side, points: inner.map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })) };
  }
  return undefined;
}

export function boundaryWorldPoints(boundary: FrozenBoundarySegment, nodes: readonly CanvasNode[]): Point[] {
  const owner = nodes.find((node) => node.id === boundary.ownerId)!;
  const origin = worldPosition(owner, nodes);
  return boundary.points.map((point) => ({ x: origin.x + point.x, y: origin.y + point.y }));
}

export const boundaryDirection = (side: FrozenBoundarySide) => ({ x: side === 'right' ? 1 : side === 'left' ? -1 : 0, y: side === 'bottom' ? 1 : side === 'top' ? -1 : 0 });
const boundaryCache=new WeakMap<EdgeRouteSnapshot,{points:Point[];boundaryKey:string;route:CachedRoute;connector:Point[]}>();

/** 在自由空间中连接刚性内部段；无效结果即为冲突。 */
export function resolveFrozenBoundaryRoute(edgeId: string, snapshot: EdgeRouteSnapshot, nodes: readonly CanvasNode[], geometry: DiagramGeometry, sourceId: string, targetId: string, fallback: CachedRoute, groups: readonly FrozenGroupSnapshot[]): { ok: true; route: CachedRoute } | { ok: false; message: string } {
  const source = snapshot.frozenBoundaries?.find((part) => part.endpoint === 'source');
  const target = snapshot.frozenBoundaries?.find((part) => part.endpoint === 'target');
  if (!source && !target) return { ok: true, route: fallback };
  const sourcePort = routeEndpoint(geometry.bounds.get(sourceId), fallback.sourceHandle, 'source');
  const targetPort = routeEndpoint(geometry.bounds.get(targetId), fallback.targetHandle, 'target');
  if (!sourcePort || !targetPort) return { ok: false, message: '冻结连接的端口不存在' };
  const sourceFragment = source ? boundaryWorldPoints(source, nodes) : [sourcePort.anchor];
  const targetFragment = target ? boundaryWorldPoints(target, nodes) : [targetPort.anchor];
  const boundaryKey=JSON.stringify([sourceFragment,targetFragment,fallback.sourceHandle,fallback.targetHandle]);
  const cached=boundaryCache.get(snapshot);
  const start = sourceFragment.at(-1)!, end = targetFragment.at(-1)!;
  const startSide = source?.side ?? sourcePort.side;
  const endSide = target?.side ?? targetPort.side;
  const a = boundaryDirection(startSide), b = boundaryDirection(endSide);
  const ownerIds = new Set([source?.ownerId, target?.ownerId].filter((id): id is string => !!id));
  const ownerRects = [...ownerIds].map((id) => {
    const owner = nodes.find((node) => node.id === id)!, group = groups.find((item) => item.rootId === id)!;
    const origin = worldPosition(owner, nodes), frame = group.protectedFrame ?? { x: 0, y: 0, ...(group.frozenFrames?.[id] ?? size(owner)) };
    return { x: origin.x + frame.x, y: origin.y + frame.y, w: frame.width, h: frame.height };
  });
  const internal = (rect: Rect) => ownerRects.some(owner => rect.x >= owner.x - 4 && rect.y >= owner.y - 4 && rect.x + rect.w <= owner.x + owner.w + 4 && rect.y + rect.h <= owner.y + owner.h + 4);
  const externalReserved = geometry.reserved.filter(item => !item.frozenOwnerId || !ownerIds.has(item.frozenOwnerId) || !internal(item.rect));
  const connectorGeometry = withReservedRoutes(geometry, externalReserved);
  const matches = (part: FrozenBoundarySegment | undefined) => {
    if (!part) return true;
    const owner = nodes.find(node => node.id === part.ownerId)!;
    const group = groups.find(item => item.rootId === part.ownerId)!;
    const origin = worldPosition(owner, nodes), frame = group.protectedFrame ?? { x: 0, y: 0, ...(group.frozenFrames?.[owner.id] ?? size(owner)) };
    const actual = frozenBoundary(fallback.points, { x: origin.x + frame.x, y: origin.y + frame.y, w: frame.width, h: frame.height }, owner.id, part.endpoint);
    if (!actual) return false;
    const expected = boundaryWorldPoints(part, nodes), observed = boundaryWorldPoints(actual, nodes).map(point => ({ x: point.x + frame.x, y: point.y + frame.y }));
    return expected.length === observed.length && expected.every((point, index) => samePoint(point, observed[index]!));
  };
  if (matches(source) && matches(target) && pathIsClear(fallback.points, connectorGeometry, sourceId, targetId, edgeId)) {
    let points = fallback.points;
    for (const point of [sourceFragment.at(-1)!, targetFragment.at(-1)!]) {
      if (points.some(existing => samePoint(existing, point))) continue;
      const index = points.findIndex((to, index) => {
        if (!index) return false;
        const from = points[index - 1]!;
        return (Math.abs(from.x - to.x) < EPSILON && Math.abs(point.x - from.x) < EPSILON && point.y > Math.min(from.y, to.y) && point.y < Math.max(from.y, to.y))
          || (Math.abs(from.y - to.y) < EPSILON && Math.abs(point.y - from.y) < EPSILON && point.x > Math.min(from.x, to.x) && point.x < Math.max(from.x, to.x));
      });
      if (index > 0) points = [...points.slice(0, index), point, ...points.slice(index)];
    }
    const route = points === fallback.points ? fallback : { ...fallback, points };
    const connector = route.points.slice(sourceFragment.length - 1, route.points.length - targetFragment.length + 1);
    boundaryCache.set(snapshot, { points: fallback.points, boundaryKey, route, connector });
    return { ok: true, route };
  }
  if(cached&&cached.boundaryKey===boundaryKey&&pathIsClear(cached.connector,connectorGeometry,sourceId,targetId,edgeId))return{ok:true,route:cached.route.text === fallback.text ? cached.route : {...cached.route,text:fallback.text}};
  const obstacles = [...geometry.obstacles.values()].filter((item) => !ownerIds.has(item.id) && !internal(item.padded)).map((item) => obstacleFromRect(item.id === sourceId || item.id === targetId ? item.endpointBounds ?? item.bounds : item.padded));
  obstacles.push(...ownerRects.map((rect) => obstacleFromRect(rect)));
  obstacles.push(...externalReserved.filter((item) => item.edgeId !== edgeId).map((item) => obstacleFromRect(item.rect)));
  const extend = (point: Point, direction: Point): Point => {
    for (let distance = 16; distance >= 0; distance -= 4) {
      const stub = { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
      if (!obstacles.some(obstacle => stub.x > obstacle.left && stub.x < obstacle.right && stub.y > obstacle.top && stub.y < obstacle.bottom)) return stub;
    }
    return point;
  };
  const startStub = extend(start, a), endStub = extend(end, b);
  const clear = (points: Point[]) => !points.slice(1).some((point, index) => ownerRects.some(rect => segmentCrossesRect(points[index]!, point, rect))) && pathIsClear(points, connectorGeometry, sourceId, targetId, edgeId);
  const candidates: Point[][] = [];
  if (cached) {
    const middle = cached.connector.slice(1, -1);
    if (middle.length) candidates.push([start, startStub, a.x ? { x: middle[0]!.x, y: startStub.y } : { x: startStub.x, y: middle[0]!.y }, ...middle, b.x ? { x: middle.at(-1)!.x, y: endStub.y } : { x: endStub.x, y: middle.at(-1)!.y }, endStub, end]);
  }
  candidates.push([start, startStub, { x: endStub.x, y: startStub.y }, endStub, end], [start, startStub, { x: startStub.x, y: endStub.y }, endStub, end]);
  let connector = candidates.map(simplifyPoints).find(clear);
  if (!connector) {
    const middle = routeOrthogonal({ ...startStub, w: 0, h: 0 }, { ...endStub, w: 0, h: 0 }, obstacles, { offset: 0, padding: 10 });
    connector = [start, startStub, ...middle, endStub, end].filter((point, index, array) => index === 0 || !samePoint(point, array[index - 1]!));
  }
  if (connector.slice(1).some((point, index) => ownerRects.some((rect) => segmentCrossesRect(connector[index]!, point, rect)))) return { ok: false, message: '无法从冻结边界端口绕开容器' };
  if (!pathIsClear(connector, connectorGeometry, sourceId, targetId, edgeId)) return { ok: false, message: '无法从冻结边界端口绕开节点或锁定路径' };
  const points = [...sourceFragment, ...connector.slice(1, -1), ...[...targetFragment].reverse()]
    .filter((point, index, array) => index === 0 || !samePoint(point, array[index - 1]!));
  const route={...fallback,feasible:true,points};
  boundaryCache.set(snapshot,{points:fallback.points,boundaryKey,route,connector});
  return { ok: true, route };
}
