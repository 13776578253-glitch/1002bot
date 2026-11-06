/** Persisted canonical-edge routes and their projection onto visible display edges. */
import type { Point } from '../../../core/layout/geometry.ts';
import type { Projection } from '../../../core/projection/index.ts';
import type { CanonicalEdge } from '../../../core/schema/types.ts';
import type { EdgeLabelPlacement } from '../contracts/label-types.ts';
import type { DisplayEdge } from './display-edges.ts';
import type { CachedRoute } from './route-cache.ts';
import { createDiagramGeometry, routeEndpoint, routeIsLegal, segmentCrossesRect, sharedFrozenGeometry, type DiagramGeometry, type ReservedRoute } from './routing.ts';
import { CARD_SIZE, structureHeaderHeight, worldPosition, type CanvasNode } from '../layout/node.ts';
import { nodeIsVisible } from '../layout/visibility.ts';
import type { EdgeRouteSnapshot, EdgeRouteState, FrozenGroupSnapshot } from '../contracts/snapshot-types.ts';
import { boundaryWorldPoints, resolveFrozenBoundaryRoute } from './frozen-boundary.ts';

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

export function routeSnapshotForEdge(edge: DisplayEdge, route: CachedRoute, state: EdgeRouteState, nodes: readonly CanvasNode[], groups: readonly FrozenGroupSnapshot[], label?: EdgeLabelPlacement): EdgeRouteSnapshot | undefined {
  if (route.feasible === false) return undefined;
  const member = edge.members[0];
  if (!member || edge.aggregated || member.source.boundary || member.target.boundary) return undefined;
  const canonical = member.edge;
  const owner = groupContainingBoth(groups, canonical.source.nodeId, canonical.target.nodeId);
  const origin = owner ? worldPosition(nodes.find((node) => node.id === owner.rootId)!, nodes) : undefined;
  return {
    canonicalEdgeId: canonical.id,
    ...(route.policyKey ? { policyKey: route.policyKey } : {}),
    state,
    source: { nodeId: canonical.source.nodeId, ...(canonical.source.portId === undefined ? {} : { portId: canonical.source.portId }), ...(route.sourceHandle ? { handle: route.sourceHandle } : {}) },
    target: { nodeId: canonical.target.nodeId, ...(canonical.target.portId === undefined ? {} : { portId: canonical.target.portId }), ...(route.targetHandle ? { handle: route.targetHandle } : {}) },
    points: origin ? route.points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y })) : route.points.map((point) => ({ ...point })),
    space: owner ? { kind: 'owner', ownerId: owner.rootId } : { kind: 'world' },
    endpointFingerprint: endpointFingerprint(canonical),
    ...(label && label.width > 0 && label.height > 0 ? { label: origin ? { ...label, x: label.x - origin.x, y: label.y - origin.y } : { ...label } } : {}),
  };
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

/** 锁定路径始终是硬障碍；固定路径是有意保留的软约束。 */
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
    const boundaries=(route.frozenBoundaries??[]).filter(part=>!closed.has(part.ownerId)).map(part=>({edgeId:route.canonicalEdgeId,points:boundaryWorldPoints(part,nodes),frozenOwnerId:part.ownerId}));
    if (route.state !== 'locked') return boundaries;
    if (route.space.kind === 'owner' && closed.has(route.space.ownerId)) return boundaries;
    const points = worldRoutePoints(route, nodes);
    return points ? [{ edgeId: route.canonicalEdgeId, points, ...(route.space.kind === 'owner' ? { frozenOwnerId: route.space.ownerId } : {}) }, ...boundaries] : boundaries;
  })];
}

/** 报告使锁定路径脱离或节点压到路径上的移动。 */
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
      const bounds = { x: p.x, y: p.y, w: node.width ?? CARD_SIZE.width, h: node.type === 'card' ? node.height ?? CARD_SIZE.height : node.type === 'structure' ? structureHeaderHeight(node) : 54 };
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

/** 保存的端点必须仍与当前节点手柄重合。 */
export function storedRouteAttached(route: EdgeRouteSnapshot, nodes: readonly CanvasNode[], geometry: DiagramGeometry): boolean {
  const points = worldRoutePoints(route, nodes), source = geometry.bounds.get(route.source.nodeId), target = geometry.bounds.get(route.target.nodeId);
  if (!points || points.length < 2 || !source || !target) return false;
  const start = routeEndpoint(source, route.source.handle, 'source')?.anchor;
  const end = routeEndpoint(target, route.target.handle, 'target')?.anchor;
  if (!start || !end) return false;
  return Math.abs(points[0]!.x - start.x) < 0.001 && Math.abs(points[0]!.y - start.y) < 0.001
    && Math.abs(points.at(-1)!.x - end.x) < 0.001 && Math.abs(points.at(-1)!.y - end.y) < 0.001;
}

/** 永久规范几何在搜索自动路径前先注入缓存。 */
export function retainedCanonicalRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], stored: readonly EdgeRouteSnapshot[], retained: ReadonlyMap<string, CachedRoute>, groups: readonly FrozenGroupSnapshot[] = []): Map<string, CachedRoute> {
  const result = new Map(retained);
  const geometry = createDiagramGeometry(nodes, projection);
  const byId = new Map(stored.map(route => [route.canonicalEdgeId, route]));
  for (const edge of edges) {
    if (edge.aggregated || edge.members[0]!.source.boundary || edge.members[0]!.target.boundary) continue;
    const snapshot = byId.get(edge.id);
    if (!snapshot || (snapshot.state !== 'locked' && !snapshot.frozenBoundaries?.length) || snapshot.endpointFingerprint !== endpointFingerprint(edge.members[0]!.edge)) continue;
    if (snapshot.frozenBoundaries?.some(part => !nodes.find(node => node.id === part.ownerId)!.data.expanded)) continue;
    if (snapshot.frozenBoundaries?.length && retained.has(edge.id) && snapshot.state !== 'locked') continue;
    const attached = storedRouteAttached(snapshot, nodes, geometry);
    if (!attached && !snapshot.frozenBoundaries?.length) continue;
    let points = worldRoutePoints(snapshot, nodes)!;
    if (!attached || (snapshot.state !== 'locked' && snapshot.frozenBoundaries?.length && !retained.has(edge.id))) {
      const start = routeEndpoint(geometry.bounds.get(edge.source), snapshot.source.handle, 'source')?.anchor;
      const end = routeEndpoint(geometry.bounds.get(edge.target), snapshot.target.handle, 'target')?.anchor;
      if (!start || !end) continue;
      points = [start, { x: end.x, y: start.y }, end];
    }
    result.set(edge.id, { points, sourceHandle: snapshot.source.handle!, targetHandle: snapshot.target.handle!, text: edge.text });
  }
  return result;
}

/** 只把保留的规范路径应用到一对一的可见展示边。 */
export function applyStoredRoutes(
  routes: ReadonlyMap<string, CachedRoute>,
  edges: readonly DisplayEdge[],
  stored: readonly EdgeRouteSnapshot[],
  nodes: readonly CanvasNode[],
  projection: Projection,
  groups: readonly FrozenGroupSnapshot[] = [],
  boundaryFailures?: Map<string, string>,
  boundarySeeds?: ReadonlyMap<string, CachedRoute>,
  geometry = createDiagramGeometry(nodes, projection, reservedLockedRoutes(stored, nodes, groups)),
): Map<string, CachedRoute> {
  if (!stored.length) return routes as Map<string, CachedRoute>;
  const byId = new Map(stored.map((route) => [route.canonicalEdgeId, route]));
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
    if (retained.state === 'auto' && !retained.frozenBoundaries?.length && current.policyKey && retained.policyKey !== current.policyKey) continue;
    if(retained.frozenBoundaries?.length&&groups.length){
      const resolved=resolveFrozenBoundaryRoute(edge.id,retained,nodes,geometry,edge.source,edge.target,boundarySeeds?.get(edge.id) ?? current,groups);
      if(resolved.ok)next.set(edge.id,resolved.route);
      else {
        boundaryFailures?.set(edge.id, resolved.message);
        next.set(edge.id, { ...current, feasible: false, points: [] });
      }
      continue;
    }
    const points = worldRoutePoints(retained, nodes);
    const sourceHandle = retained.source.handle ?? current.sourceHandle;
    const targetHandle = retained.target.handle ?? current.targetHandle;
    if (!points || !routeIsLegal({ points, sourceHandle, targetHandle }, sharedFrozenGeometry(geometry, edge.id), edge.source, edge.target, retained.canonicalEdgeId)) {
      if (retained.state === 'locked') {
        boundaryFailures?.set(edge.id, '锁定路径无法满足当前端口或障碍约束');
        next.set(edge.id, { ...current, feasible: false, points: [] });
      }
      continue;
    }
    next.set(edge.id, {
      sourceHandle, targetHandle,
      ...(current.policyKey ? { policyKey: current.policyKey } : {}),
      points,
      text: current.text,
    });
  }
  return next;
}
