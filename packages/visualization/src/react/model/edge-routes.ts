/** Persisted canonical-edge routes and their projection onto visible display edges. */
import { portAnchor, type Point, type PortSide } from '../../core/layout/geometry.ts';
import type { Projection } from '../../core/projection/index.ts';
import type { CanonicalEdge } from '../../core/schema/types.ts';
import type { DisplayEdge } from './display-edges.ts';
import type { CachedRoute } from './route-cache.ts';
import { createDiagramGeometry, pathIsClear, segmentCrossesRect, type DiagramGeometry, type ReservedRoute } from './routing.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from './grouping.ts';
import { nodeIsVisible } from './hierarchy.ts';
import type { EdgeRouteSnapshot, EdgeRouteState, FrozenGroupSnapshot } from './workspace.ts';
import { boundaryWorldPoints, resolveFrozenBoundaryRoute } from './blackbox-routes.ts';

const retainedBoundaryRoutes = new WeakSet<CachedRoute>();

export function endpointFingerprint(edge: CanonicalEdge): string {
  return `${edge.id}:${edge.source.nodeId}:${edge.source.portId ?? ''}>${edge.target.nodeId}:${edge.target.portId ?? ''}`;
}

export function worldRoutePoints(route: EdgeRouteSnapshot, nodes: readonly CanvasNode[]): Point[] | undefined {
  const space = route.space;
  if (space.kind === 'world') return route.points;
  const owner = nodes.find((node) => node.id === space.ownerId);
  if (!owner) return undefined;
  const origin = worldPosition(owner, nodes);
  return route.points.map((point) => ({ x: point.x + origin.x, y: point.y + origin.y }));
}

function groupContainingBoth(groups: readonly FrozenGroupSnapshot[], source: string, target: string): FrozenGroupSnapshot | undefined {
  return groups.find((group) => {
    const ids = new Set([group.rootId, ...group.memberIds]);
    return ids.has(source) && ids.has(target);
  });
}

export function routeSnapshot(edge: DisplayEdge, route: CachedRoute, state: EdgeRouteState, nodes: readonly CanvasNode[], groups: readonly FrozenGroupSnapshot[]): EdgeRouteSnapshot | undefined {
  const member = edge.members[0];
  if (!member) return undefined;
  const canonical = member.edge;
  const owner = groupContainingBoth(groups, canonical.source.nodeId, canonical.target.nodeId);
  const origin = owner ? worldPosition(nodes.find((node) => node.id === owner.rootId)!, nodes) : undefined;
  return {
    canonicalEdgeId: canonical.id,
    state,
    source: { nodeId: canonical.source.nodeId, ...(canonical.source.portId === undefined ? {} : { portId: canonical.source.portId }), ...(route.sourceHandle ? { handle: route.sourceHandle } : {}) },
    target: { nodeId: canonical.target.nodeId, ...(canonical.target.portId === undefined ? {} : { portId: canonical.target.portId }), ...(route.targetHandle ? { handle: route.targetHandle } : {}) },
    points: origin ? route.points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y })) : route.points.map((point) => ({ ...point })),
    space: owner ? { kind: 'owner', ownerId: owner.rootId } : { kind: 'world' },
    endpointFingerprint: endpointFingerprint(canonical),
    ...(route.label ? { label: origin ? { ...route.label, x: route.label.x - origin.x, y: route.label.y - origin.y } : { ...route.label } } : {}),
  };
}

/** Retain routes for a newly frozen group: internal edges lock, boundary edges pin. */
export function captureRoutesForGroup(edges: readonly DisplayEdge[], routes: ReadonlyMap<string, CachedRoute>, group: FrozenGroupSnapshot, nodes: readonly CanvasNode[], groups: readonly FrozenGroupSnapshot[]): EdgeRouteSnapshot[] {
  const inside = new Set([group.rootId, ...group.memberIds]);
  const captured = new Map<string, EdgeRouteSnapshot>();
  for (const edge of edges) {
    if (edge.aggregated) continue;
    const member = edge.members[0];
    if (!member || member.source.boundary || member.target.boundary) continue;
    const canonical = member.edge;
    const sourceIn = inside.has(canonical.source.nodeId), targetIn = inside.has(canonical.target.nodeId);
    if (!sourceIn && !targetIn) continue;
    const route = routes.get(edge.id);
    if (!route) continue;
    const state: EdgeRouteState = sourceIn && targetIn ? 'locked' : 'pinned';
    const snapshot = routeSnapshot(edge, route, state, nodes, groups);
    if (snapshot) captured.set(snapshot.canonicalEdgeId, snapshot);
  }
  return [...captured.values()];
}

export function routeSnapshotForEdge(edge: DisplayEdge, route: CachedRoute, state: EdgeRouteState, nodes: readonly CanvasNode[], groups: readonly FrozenGroupSnapshot[]): EdgeRouteSnapshot | undefined {
  return routeSnapshot(edge, route, state, nodes, groups);
}

export function upsertRoute(routes: readonly EdgeRouteSnapshot[], route: EdgeRouteSnapshot): EdgeRouteSnapshot[] {
  return [...routes.filter((item) => item.canonicalEdgeId !== route.canonicalEdgeId), route];
}

export function removeRoute(routes: readonly EdgeRouteSnapshot[], canonicalEdgeId: string): EdgeRouteSnapshot[] {
  return routes.filter((route) => route.canonicalEdgeId !== canonicalEdgeId);
}

export function routeStateFor(routes: readonly EdgeRouteSnapshot[], canonicalEdgeId: string): EdgeRouteState | undefined {
  return routes.find((route) => route.canonicalEdgeId === canonicalEdgeId)?.state;
}

/** Locked routes remain hard obstacles; pinned routes are intentionally soft. */
export function reservedLockedRoutes(routes: readonly EdgeRouteSnapshot[], nodes: readonly CanvasNode[], groups: readonly FrozenGroupSnapshot[] = []): ReservedRoute[] {
  const closed = new Map(groups.flatMap(group => {
    const root = nodes.find(node => node.id === group.rootId)!;
    return root.data.expandable && !root.data.expanded ? [[group.rootId, group] as const] : [];
  }));
  const frames: ReservedRoute[] = [...closed.values()].map(group => {
    const owner = nodes.find(node => node.id === group.rootId)!, origin = worldPosition(owner, nodes);
    const frame = group.protectedFrame ?? { x: 0, y: 0, width: group.worldBounds.w, height: group.worldBounds.h };
    return { edgeId: `frozen-frame:${group.rootId}`, points: [], obstacle: { nodeId: group.rootId, bounds: { x: origin.x + frame.x, y: origin.y + frame.y, w: frame.width, h: frame.height } } };
  });
  return [...frames, ...routes.flatMap((route) => {
    const boundaries=(route.frozenBoundaries??[]).filter(part=>!closed.has(part.ownerId)).map(part=>({edgeId:route.canonicalEdgeId,points:boundaryWorldPoints(part,nodes)}));
    if (route.state !== 'locked') return boundaries;
    if (route.space.kind === 'owner' && closed.has(route.space.ownerId)) return boundaries;
    const points = worldRoutePoints(route, nodes);
    return points ? [{ edgeId: route.canonicalEdgeId, points },...boundaries] : boundaries;
  })];
}

/** Report moves that detach a locked route or introduce a node over its path. */
export function validateStoredRoutes(before: readonly CanvasNode[], after: readonly CanvasNode[], routes: readonly EdgeRouteSnapshot[], projection: Projection, afterRoutes: readonly EdgeRouteSnapshot[]=routes): string | undefined {
  const oldNodes = new Map(before.map((node) => [node.id, node]));
  const newNodes = new Map(after.map((node) => [node.id, node]));
  const geometry = createDiagramGeometry(after, projection);
  for (const route of routes) {
    const updated=afterRoutes.find(item=>item.canonicalEdgeId===route.canonicalEdgeId)??route;
    for(const part of route.frozenBoundaries??[]){
      const nextPart=updated.frozenBoundaries?.find(item=>item.ownerId===part.ownerId&&item.endpoint===part.endpoint)??part;
      const a=boundaryWorldPoints(part,before),b=boundaryWorldPoints(nextPart,after);
      const endpoint=part.endpoint==='source'?route.source.nodeId:route.target.nodeId;
      const old=oldNodes.get(endpoint),next=newNodes.get(endpoint);
      if(!old||!next)return '冻结分段的端点不存在';
      const x=worldPosition(old,before),y=worldPosition(next,after);
      if(Math.abs(y.x-x.x-b[0]!.x+a[0]!.x)>0.001||Math.abs(y.y-x.y-b[0]!.y+a[0]!.y)>0.001)return '冻结分段的内部端点不能独立移动';
      for(const node of after){
        if(node.id===endpoint||node.id===part.ownerId||!nodeIsVisible(node,after,projection))continue;
        let parent=node.parentId,inside=false;
        while(parent){if(parent===part.ownerId){inside=true;break;}parent=newNodes.get(parent)?.parentId;}
        if(inside&&node.data.frozen)continue;
        const point=worldPosition(node,after),rect={...point,w:node.width!,h:node.type==='card'?node.height!:68};
        if(b.slice(1).some((p,i)=>segmentCrossesRect(b[i]!,p,rect))){
          const prior=oldNodes.get(node.id);if(!prior||JSON.stringify(worldPosition(prior,before))!==JSON.stringify(point))return '节点不能遮挡冻结连接的内部段';
        }
      }
    }
    if (route.state !== 'locked') continue;
    const oldPoints = worldRoutePoints(route, before), nextPoints = worldRoutePoints(updated, after);
    if (!oldPoints || !nextPoints) return '锁定路径的所有者不存在';
    const dx = nextPoints[0]!.x - oldPoints[0]!.x, dy = nextPoints[0]!.y - oldPoints[0]!.y;
    for (const id of [route.source.nodeId, route.target.nodeId]) {
      const old = oldNodes.get(id), next = newNodes.get(id);
      if (!old || !next) return '锁定路径的端点不存在';
      const a = worldPosition(old, before), b = worldPosition(next, after);
      if (Math.abs(b.x - a.x - dx) > 0.001 || Math.abs(b.y - a.y - dy) > 0.001) return '锁定路径的端点无法单独移动';
    }
    if (projection.nodeById.has(route.source.nodeId) && projection.nodeById.has(route.target.nodeId)
      && route.source.handle && route.target.handle && !storedRouteAttached(updated, after, geometry)) return '展开或尺寸变化会使端点脱离锁定路径';
    const ancestors = new Set<string>();
    for (const id of [route.source.nodeId, route.target.nodeId]) {
      let parent = newNodes.get(id)?.parentId;
      while (parent) { ancestors.add(parent); parent = newNodes.get(parent)?.parentId; }
    }
    const crosses = (node: CanvasNode, list: readonly CanvasNode[], points: readonly Point[]) => {
      const p = worldPosition(node, list);
      const bounds = { x: p.x, y: p.y, w: node.width ?? CARD_SIZE.width, h: node.type === 'card' ? node.height ?? CARD_SIZE.height : node.type === 'structure' ? 68 : 54 };
      return points.slice(1).some((point, index) => segmentCrossesRect(points[index]!, point, bounds));
    };
    for (const node of after) {
      if (node.id === route.source.nodeId || node.id === route.target.nodeId || ancestors.has(node.id) || !nodeIsVisible(node, after, projection)) continue;
      const old = oldNodes.get(node.id);
      if (crosses(node, after, nextPoints) && (!old || !crosses(old, before, oldPoints))) return '节点不能遮挡锁定路径';
    }
  }
  return undefined;
}

/** The stored endpoints must still coincide with the current node handles. */
export function storedRouteAttached(route: EdgeRouteSnapshot, nodes: readonly CanvasNode[], geometry: DiagramGeometry): boolean {
  const points = worldRoutePoints(route, nodes), source = geometry.bounds.get(route.source.nodeId), target = geometry.bounds.get(route.target.nodeId);
  if (!points || points.length < 2 || !source || !target) return false;
  const sides: Record<string, PortSide> = { out: 'bottom', 'top-out': 'top', 'return-out': 'right', 'left-out': 'left', in: 'top', 'bottom-in': 'bottom', return: 'right', 'left-in': 'left' };
  const sourceSide = route.source.handle && sides[route.source.handle], targetSide = route.target.handle && sides[route.target.handle];
  if (!sourceSide || !targetSide) return false;
  const start = portAnchor(source, sourceSide), end = portAnchor(target, targetSide);
  return Math.abs(points[0]!.x - start.x) < 0.001 && Math.abs(points[0]!.y - start.y) < 0.001
    && Math.abs(points.at(-1)!.x - end.x) < 0.001 && Math.abs(points.at(-1)!.y - end.y) < 0.001;
}

/** Permanent canonical geometry seeds the cache before automatic paths are searched. */
export function retainedCanonicalRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], stored: readonly EdgeRouteSnapshot[], retained: ReadonlyMap<string, CachedRoute>, groups: readonly FrozenGroupSnapshot[] = []): Map<string, CachedRoute> {
  const result = new Map(retained);
  const geometry = createDiagramGeometry(nodes, projection);
  const byId = new Map(stored.map(route => [route.canonicalEdgeId, route]));
  for (const edge of edges) {
    if (edge.aggregated || edge.members[0]!.source.boundary || edge.members[0]!.target.boundary) continue;
    const snapshot = byId.get(edge.id);
    if (!snapshot || (snapshot.state !== 'locked' && !snapshot.frozenBoundaries?.length) || snapshot.endpointFingerprint !== endpointFingerprint(edge.members[0]!.edge)) continue;
    if (snapshot.frozenBoundaries?.some(part => !nodes.find(node => node.id === part.ownerId)!.data.expanded)) continue;
    const saved = retained.get(edge.id);
    const savedPoints = snapshot.frozenBoundaries?.length && saved && worldRoutePoints(snapshot, nodes);
    const confirmedLocked = snapshot.state === 'locked' && saved && savedPoints && savedPoints.length === saved.points.length
      && savedPoints.every((point, index) => point.x === saved.points[index]!.x && point.y === saved.points[index]!.y);
    if (snapshot.frozenBoundaries?.length && saved && (snapshot.state !== 'locked' || confirmedLocked)) {
      retainedBoundaryRoutes.add(saved);
      continue;
    }
    const attached = storedRouteAttached(snapshot, nodes, geometry);
    if (!attached && !snapshot.frozenBoundaries?.length) continue;
    let points = worldRoutePoints(snapshot, nodes)!;
    if (!attached || (snapshot.state !== 'locked' && snapshot.frozenBoundaries?.length && !retained.has(edge.id))) {
      const sides: Record<string, PortSide> = { out: 'bottom', 'top-out': 'top', 'return-out': 'right', 'left-out': 'left', in: 'top', 'bottom-in': 'bottom', return: 'right', 'left-in': 'left' };
      const start = portAnchor(geometry.bounds.get(edge.source)!, sides[snapshot.source.handle!]!);
      const end = portAnchor(geometry.bounds.get(edge.target)!, sides[snapshot.target.handle!]!);
      points = [start, { x: end.x, y: start.y }, end];
    }
    const origin = snapshot.space.kind === 'owner' ? worldPosition(nodes.find(node => node.id === (snapshot.space as { ownerId: string }).ownerId)!, nodes) : { x: 0, y: 0 };
    const label = snapshot.label ? { ...snapshot.label, x: snapshot.label.x + origin.x, y: snapshot.label.y + origin.y } : retained.get(edge.id)?.label;
    if (label) result.set(edge.id, { points, sourceHandle: snapshot.source.handle!, targetHandle: snapshot.target.handle!, label, text: edge.text });
  }
  return result;
}

/** Apply retained canonical routes only to one-to-one visible display edges. */
export function applyStoredRoutes(
  routes: ReadonlyMap<string, CachedRoute>,
  edges: readonly DisplayEdge[],
  stored: readonly EdgeRouteSnapshot[],
  nodes: readonly CanvasNode[],
  projection: Projection,
  groups: readonly FrozenGroupSnapshot[] = [],
  boundaryFailures?: Map<string, string>,
): Map<string, CachedRoute> {
  if (!stored.length) return routes as Map<string, CachedRoute>;
  const byId = new Map(stored.map((route) => [route.canonicalEdgeId, route]));
  const geometry = createDiagramGeometry(nodes, projection, reservedLockedRoutes(stored, nodes, groups));
  const next = new Map(routes);
  for (const edge of edges) {
    if (edge.aggregated) continue;
    const member = edge.members[0];
    if (!member || member.source.boundary || member.target.boundary) continue;
    const retained = byId.get(member.canonicalEdgeId);
    if (!retained) continue;
    if (retained.frozenBoundaries?.some(part => !nodes.find(node => node.id === part.ownerId)!.data.expanded)) continue;
    if (retained.endpointFingerprint !== endpointFingerprint(member.edge)) continue;
    if (retained.source.nodeId !== member.source.nodeId || retained.target.nodeId !== member.target.nodeId) continue;
    const current = routes.get(edge.id);
    if (!current) continue;
    if(retained.frozenBoundaries?.length&&groups.length){
      const resolved=resolveFrozenBoundaryRoute(edge.id,retained,nodes,geometry,edge.source,edge.target,current,groups,retainedBoundaryRoutes.has(current));
      if(resolved.ok)next.set(edge.id,resolved.route);
      else boundaryFailures?.set(edge.id, resolved.message);
      continue;
    }
    const points = worldRoutePoints(retained, nodes);
    if (!points) continue;
    if (!storedRouteAttached(retained, nodes, geometry)) continue;
    if (retained.state === 'pinned' && !pathIsClear(points, geometry, edge.source, edge.target, retained.canonicalEdgeId)) continue;
    const owner = retained.space.kind === 'owner' ? nodes.find((node) => node.id === (retained.space as { kind: 'owner'; ownerId: string }).ownerId) : undefined;
    const origin = owner ? worldPosition(owner, nodes) : undefined;
    next.set(edge.id, {
      sourceHandle: retained.source.handle ?? current.sourceHandle,
      targetHandle: retained.target.handle ?? current.targetHandle,
      points,
      label: retained.label ? { ...retained.label, x: retained.label.x + (origin?.x ?? 0), y: retained.label.y + (origin?.y ?? 0) } : current.label,
      text: current.text,
    });
  }
  return next;
}
