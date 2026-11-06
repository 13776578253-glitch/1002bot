/** Capture canonical paths and hard boundary segments for a frozen subgraph. */
import { obstacleFromRect, rectIntersects, routeOrthogonal, type Point, type Rect } from '../../../core/layout/geometry.ts';
import { projectGraph } from '../../../core/projection/index.ts';
import type { StageSnapshot } from '../../../core/schema/types.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from '../layout/node.ts';
import { MAX_CONTAINER_EXTRA } from '../layout/spacing.ts';
import { createDiagramGeometry, pathIsClear, routeDiagramGeometry, routeEndpoint, segmentCrossesRect, withReservedRoutes, type DiagramGeometry } from '../routing/routing.ts';
import { endpointFingerprint, routeSnapshotForEdge, storedRouteAttached, worldRoutePoints, reservedLockedRoutes } from '../routing/edge-routes.ts';
import { hierarchyProjection } from '../layout/visibility.ts';
import { boundaryDirection, frozenBoundary, resolveFrozenBoundaryRoute } from '../routing/frozen-boundary.ts';
import { unfreezeGroup } from './frozen.ts';
import { aggregateProjectedEdges, type DisplayEdge } from '../routing/display-edges.ts';
import type { EdgeLabelPlacement } from '../contracts/label-types.ts';
import type { CachedRoute } from '../routing/route-cache.ts';
import type { EdgeRouteSnapshot, FrozenBoundarySegment, FrozenBoundarySide, FrozenGroupSnapshot } from '../contracts/snapshot-types.ts';
import type { StageConflict } from '../contracts/stage-types.ts';

interface CaptureInput {
  nodes: readonly CanvasNode[];
  stage: StageSnapshot;
  group: FrozenGroupSnapshot;
  groups: readonly FrozenGroupSnapshot[];
  displayEdges: readonly DisplayEdge[];
  displayRoutes: ReadonlyMap<string, CachedRoute>;
  displayLabels?: ReadonlyMap<string, EdgeLabelPlacement>;
  storedRoutes: readonly EdgeRouteSnapshot[];
}
export type FrozenCaptureResult =
  | { ok: true; nodes: CanvasNode[]; group: FrozenGroupSnapshot; routes: EdgeRouteSnapshot[] }
  | { ok: false; conflicts: StageConflict[] };

const EPSILON = 0.001;
const size = (n: CanvasNode) => ({ width: n.width ?? CARD_SIZE.width, height: n.height ?? CARD_SIZE.height });
const worldBounds = (node: CanvasNode, nodes: readonly CanvasNode[]): Rect => ({ ...worldPosition(node, nodes), w: size(node).width, h: size(node).height });

/** 生成展开框，但不平移任何已有节点。 */
function materializeFrames(input: CaptureInput): { nodes: CanvasNode[]; virtual: CanvasNode[]; frames: Record<string, {width: number; height: number}> } | StageConflict {
  const groupIds = new Set([input.group.rootId, ...input.group.memberIds]);
  const nodes = input.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depth = (node: CanvasNode): number => { let d = 0, p = node.parentId; while (p) { d++; p = byId.get(p)?.parentId; } return d; };
  const frames: Record<string, {width: number; height: number}> = {};
  const ordered = [...nodes].sort((a, b) => depth(b) - depth(a));
  for (const node of ordered) {
    if (!node.data.expandable || node.type === 'cluster') continue;
    const children = nodes.filter((child) => child.parentId === node.id);
    let width = Math.max(288, node.data.expanded ? size(node).width : CARD_SIZE.width);
    let height = Math.max(72 + CARD_SIZE.height + 24, node.data.expanded ? size(node).height : CARD_SIZE.height);
    for (const child of children) {
      const extent = frames[child.id] ?? size(child);
      if (groupIds.has(node.id) && (child.position.x < 24 - EPSILON || child.position.y < 72 - EPSILON)) {
        return { kind: 'frozen-violation', entityIds: [child.id], containerId: node.id, message: '隐藏节点超出容器左侧或标题区域，请先调整后再冻结', actions: ['cancel'] };
      }
      width = Math.max(width, child.position.x + extent.width + 24);
      height = Math.max(height, child.position.y + extent.height + 24);
    }
    if (groupIds.has(node.id)) {
      for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
        const a = children[i]!, b = children[j]!, as = a.data.expanded ? frames[a.id] ?? size(a) : size(a), bs = b.data.expanded ? frames[b.id] ?? size(b) : size(b);
        if (rectIntersects({ x: a.position.x, y: a.position.y, w: as.width, h: as.height }, { x: b.position.x, y: b.position.y, w: bs.width, h: bs.height })) {
          return { kind: 'frozen-violation', entityIds: [a.id, b.id], containerId: node.id, message: '隐藏子节点的展开范围重叠，请先调整后再冻结', actions: ['cancel'] };
        }
      }
      const ceiling = { width: (node.data.contentWidth ?? size(node).width) + MAX_CONTAINER_EXTRA, height: (node.data.contentHeight ?? size(node).height) + MAX_CONTAINER_EXTRA };
      if (node.data.expanded && (width > ceiling.width + EPSILON || height > ceiling.height + EPSILON)) {
        return { kind: 'growth-ceiling', entityIds: [node.id], containerId: node.id, message: '冻结所需容器尺寸超过扩容上限', actions: ['cancel'] };
      }
    }
    frames[node.id] = { width, height };
  }
  for (const node of nodes) {
    const frame = frames[node.id];
    if (groupIds.has(node.id) && frame && node.data.expanded) {
      Object.assign(node, frame, { measured: { ...frame }, style: { ...node.style, ...frame } });
    }
  }
  const root = byId.get(input.group.rootId)!;
  const rootRect = worldBounds(root, nodes);
  const previousRoot = input.nodes.find((node) => node.id === root.id)!;
  const oldRect = worldBounds(previousRoot, input.nodes);
  for (const sibling of nodes) {
    if (sibling.id === root.id || sibling.parentId !== root.parentId) continue;
    const current = worldBounds(sibling, nodes), old = worldBounds(input.nodes.find((item) => item.id === sibling.id)!, input.nodes);
    if (rectIntersects(rootRect, current) && !rectIntersects(oldRect, old)) return { kind: 'frozen-violation', entityIds: [root.id, sibling.id], ...(root.parentId ? { containerId: root.parentId } : {}), message: '冻结容器扩容会覆盖现有节点', actions: ['cancel'] };
  }
  const virtual = nodes.map((node) => {
    const frame = frames[node.id];
    return frame ? { ...node, ...frame, type: 'structure', data: { ...node.data, expanded: true } } : node;
  });
  return { nodes, virtual, frames };
}

/** 在布线外部自由段之前，先找到通往真实边框的有效内部路径。 */
function captureCrossing(edge: DisplayEdge, sourceIn: boolean, geometry: DiagramGeometry, projectionNodes: readonly CanvasNode[], projection: ReturnType<typeof projectGraph>, nodes: readonly CanvasNode[], group: FrozenGroupSnapshot, groups: readonly FrozenGroupSnapshot[], existing: EdgeRouteSnapshot | undefined): { route: CachedRoute; segment: FrozenBoundarySegment } | undefined {
  const root = nodes.find((node) => node.id === group.rootId)!, rect = worldBounds(root, nodes);
  const generated = routeDiagramGeometry(geometry, edge.source, edge.target, edge.id);
  if (!generated.feasible) return undefined;
  const normal: CachedRoute = { ...generated, text: edge.text };
  const innerId = sourceIn ? edge.source : edge.target;
  const innerRect = geometry.bounds.get(innerId)!;
  const center = { x: innerRect.x + innerRect.w / 2, y: innerRect.y + innerRect.h / 2 };
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const candidates: { side: FrozenBoundarySide; point: Point }[] = [
    { side:'right', point:{ x:rect.x+rect.w, y:clamp(center.y,rect.y+24,rect.y+rect.h-24) } },
    { side:'left', point:{ x:rect.x, y:clamp(center.y,rect.y+24,rect.y+rect.h-24) } },
    { side:'bottom', point:{ x:clamp(center.x,rect.x+24,rect.x+rect.w-24), y:rect.y+rect.h } },
    { side:'top', point:{ x:clamp(center.x,rect.x+24,rect.x+rect.w-24), y:rect.y } },
  ];
  const other = geometry.bounds.get(sourceIn ? edge.target : edge.source)!;
  candidates.sort((a,b) => Math.hypot(a.point.x-other.x-other.w/2,a.point.y-other.y-other.h/2) - Math.hypot(b.point.x-other.x-other.w/2,b.point.y-other.y-other.h/2));
  for (const candidate of candidates) {
    const localGeometry = createDiagramGeometry(projectionNodes, projection);
    const ghost = `__frozen_port:${edge.id}`;
    const bounds = { x:candidate.point.x,y:candidate.point.y,w:0,h:0 };
    localGeometry.bounds.set(ghost,bounds);
    localGeometry.obstacles.set(ghost,{id:ghost,bounds,padded:bounds,card:true});
    const partial = sourceIn ? routeDiagramGeometry(localGeometry,innerId,ghost,edge.id) : routeDiagramGeometry(localGeometry,ghost,innerId,edge.id);
    if (!pathIsClear(partial.points,localGeometry,sourceIn?innerId:ghost,sourceIn?ghost:innerId,edge.id)) continue;
    const direction = boundaryDirection(candidate.side);
    const exterior = { x:candidate.point.x+direction.x*2, y:candidate.point.y+direction.y*2 };
    const whole = sourceIn ? [...partial.points, exterior] : [exterior, ...partial.points];
    const segment = frozenBoundary(whole,rect,group.rootId,sourceIn?'source':'target');
    if (!segment) continue;
    const fallback = { ...normal, ...(sourceIn?{sourceHandle:partial.sourceHandle}:{targetHandle:partial.targetHandle}) };
    const snapshot = routeSnapshotForEdge(edge,fallback,'pinned',nodes,groups)!;
    snapshot.frozenBoundaries = [...(existing?.frozenBoundaries ?? []).filter((item) => item.ownerId !== group.rootId), segment];
    const result = resolveFrozenBoundaryRoute(edge.id,snapshot,projectionNodes,geometry,edge.source,edge.target,fallback,groups);
    if (result.ok) return { route:result.route, segment };
  }
  return undefined;
}

/** 捕获所有规范关联边；折叠展示边不能替代成员。 */
export function captureFrozenSubgraph(input: CaptureInput): FrozenCaptureResult {
  const prepared = materializeFrames(input);
  if ('kind' in prepared) return { ok: false, conflicts: [prepared] };
  const { nodes, frames } = prepared;
  const ids = new Set([input.group.rootId, ...input.group.memberIds]);
  const allIds = new Set(input.stage.graph.nodes.filter((node) => input.stage.graph.nodes.some((child) => child.parentId === node.id)).map((node) => node.id));
  const fullProjection = projectGraph(input.stage, allIds);
  const changes = Object.fromEntries(input.stage.graph.edges.map((edge) => [edge.id, { kind: 'baseline' as const, label: '基线' }]));
  const canonical = aggregateProjectedEdges(fullProjection, changes);
  const graph = new Map(input.stage.graph.nodes.map((node) => [node.id, node]));
  const root = nodes.find((node) => node.id === input.group.rootId)!;
  const rootRect = worldBounds(root, nodes);
  const previousRoutes=(input.group.previousRoutes??input.storedRoutes.filter(route=>ids.has(route.source.nodeId)||ids.has(route.target.nodeId))).map(route=>{
    if(!ids.has(route.source.nodeId)||!ids.has(route.target.nodeId))return structuredClone(route);
    const points=worldRoutePoints(route,nodes)!;
    const origin=route.space.kind==='owner'?worldPosition(nodes.find(n=>n.id===(route.space as {ownerId:string}).ownerId)!,nodes):{x:0,y:0};
    return {...structuredClone(route),points:points.map(p=>({x:p.x-rootRect.x,y:p.y-rootRect.y})),space:{kind:'owner' as const,ownerId:root.id},...(route.label?{label:{...route.label,x:route.label.x+origin.x-rootRect.x,y:route.label.y+origin.y-rootRect.y}}:{})};
  });
  const group: FrozenGroupSnapshot = { ...input.group, previousRoutes, frozenFrames: Object.fromEntries(Object.entries(frames).filter(([id]) => ids.has(id))), worldBounds: rootRect, protectedFrame: { x: 0, y: 0, width: rootRect.w, height: rootRect.h }, boundaryPorts: [] };
  const groups = [...input.groups.filter((item) => item.id !== group.id), group];
  const captured: EdgeRouteSnapshot[] = [];
  for (const edge of canonical) {
    const member = edge.members[0]!, sourceIn = ids.has(member.edge.source.nodeId), targetIn = ids.has(member.edge.target.nodeId);
    if (!sourceIn && !targetIn) continue;
    const expanded = new Set(nodes.filter((node) => node.data.expanded).map((node) => node.id));
    for (const endpoint of [member.edge.source.nodeId, member.edge.target.nodeId]) {
      let parent = graph.get(endpoint)?.parentId;
      while (parent && parent !== input.stage.graph.rootId) { expanded.add(parent); parent = graph.get(parent)?.parentId; }
    }
    const projection = projectGraph(input.stage, expanded);
    const virtual = nodes.map((node) => {
      const frame = frames[node.id];
      return frame && expanded.has(node.id) ? { ...node, ...frame, type: 'structure', data: { ...node.data, expanded: true } } : node;
    });
    const geometry = createDiagramGeometry(virtual, projection);
    const old = input.storedRoutes.find((route) => route.canonicalEdgeId === edge.id);
    const currentEdge = input.displayEdges.find((item) => item.id === edge.id && !item.aggregated && !item.members[0]!.source.boundary && !item.members[0]!.target.boundary);
    const rendered = currentEdge && input.displayRoutes.get(currentEdge.id);
    let route: CachedRoute | undefined;
    let label: EdgeLabelPlacement | undefined;
    if (old && old.endpointFingerprint === endpointFingerprint(member.edge) && storedRouteAttached(old, virtual, geometry)) {
      const points = worldRoutePoints(old, virtual)!;
      const origin=old.space.kind==='owner'?worldPosition(virtual.find(node=>node.id===(old.space as {ownerId:string}).ownerId)!,virtual):{x:0,y:0};
      route = { points, sourceHandle: old.source.handle!, targetHandle: old.target.handle!, text: edge.text };
      if (old.label) label = { ...old.label, x: old.label.x + origin.x, y: old.label.y + origin.y };
    } else if (rendered) {
      const snapshot = routeSnapshotForEdge(edge, rendered, 'pinned', virtual, []);
      if (snapshot && storedRouteAttached(snapshot, virtual, geometry)) {
        route = rendered;
        label = input.displayLabels?.get(edge.id);
      }
    }
    if (!route) {
      if (old?.state === 'locked' || old?.frozenBoundaries?.length) return { ok: false, conflicts: [{ kind: 'locked-route', entityIds: [edge.id], message: '既有锁定路径与冻结几何不一致', actions: ['cancel'] }] };
      const generated = routeDiagramGeometry(geometry, edge.source, edge.target, edge.id);
      if (!pathIsClear(generated.points, geometry, edge.source, edge.target, edge.id)) {
        if (sourceIn !== targetIn) {
          const crossing = captureCrossing(edge, sourceIn, geometry, virtual, projection, nodes, group, groups, old);
          if (crossing) {
            const snapshot = routeSnapshotForEdge(edge, crossing.route, 'pinned', nodes, groups)!;
            snapshot.frozenBoundaries = [...(old?.frozenBoundaries ?? []).filter((item) => item.ownerId !== root.id), crossing.segment];
            group.boundaryPorts.push({ edgeId: edge.id, nodeId: sourceIn ? member.edge.source.nodeId : member.edge.target.nodeId, side: crossing.segment.side, handle: sourceIn ? crossing.route.sourceHandle : crossing.route.targetHandle });
            captured.push(snapshot);
            continue;
          }
        }
        return { ok: false, conflicts: [{ kind: 'locked-route', entityIds: [edge.id], message: '冻结子图的连接无法避开节点', actions: ['cancel'] }] };
      }
      route = { ...generated, text: edge.text };
    }
    const snapshot = routeSnapshotForEdge(edge, route, sourceIn && targetIn ||old?.state==='locked' ? 'locked' : 'pinned', nodes, groups, label)!;
    if (sourceIn !== targetIn) {
      const endpoint = sourceIn ? 'source' as const : 'target' as const;
      const segment = frozenBoundary(route.points, rootRect, root.id, endpoint);
      if (!segment) return { ok: false, conflicts: [{ kind: 'frozen-violation', entityIds: [edge.id], containerId: root.id, message: '无法确定跨边界连接的实际出口', actions: ['cancel'] }] };
      snapshot.frozenBoundaries = [...(old?.frozenBoundaries ?? []).filter((item) => item.ownerId !== root.id), segment];
      group.boundaryPorts.push({ edgeId: edge.id, nodeId: sourceIn ? member.edge.source.nodeId : member.edge.target.nodeId, side: segment.side, handle: sourceIn ? route.sourceHandle : route.targetHandle });
    }
    captured.push(snapshot);
  }
  return { ok: true, nodes, group, routes: captured };
}

export function releaseFrozenSubgraph(nodes:readonly CanvasNode[],routes:readonly EdgeRouteSnapshot[],groups:readonly FrozenGroupSnapshot[],group:FrozenGroupSnapshot){
  const members=new Set([group.rootId,...group.memberIds]),previous=new Map((group.previousRoutes??[]).map(route=>[route.canonicalEdgeId,route]));
  const retained=routes.flatMap(route=>{
    if(!members.has(route.source.nodeId)&&!members.has(route.target.nodeId))return[route];
    const other=(route.frozenBoundaries??[]).filter(part=>part.ownerId!==group.rootId);
    const original=previous.get(route.canonicalEdgeId);
    if(original){previous.delete(route.canonicalEdgeId);return[{...original,...(other.length?{frozenBoundaries:other}:{})}];}
    return other.length?[{...route,state:'pinned' as const,frozenBoundaries:other}]:[];
  });
  return{nodes:unfreezeGroup(nodes,group),edgeRoutes:[...retained,...previous.values()],frozenGroups:groups.filter(item=>item.id!==group.id)};
}

/** 只有端点移动或新障碍触及的边界连接才需要预检布线。 */
export function validateFrozenConnections(before:readonly CanvasNode[],after:readonly CanvasNode[],stage:StageSnapshot,stored:readonly EdgeRouteSnapshot[],groups:readonly FrozenGroupSnapshot[],rendered?:ReadonlyMap<string,CachedRoute>): StageConflict[] {
  if(!stored.some(route=>route.frozenBoundaries?.length))return [];
  const closedMoved = groups.filter(group => {
    const a = before.find(node => node.id === group.rootId)!, b = after.find(node => node.id === group.rootId)!;
    if (!b.data.expandable || b.data.expanded) return false;
    const x = worldPosition(a, before), y = worldPosition(b, after);
    return x.x !== y.x || x.y !== y.y;
  });
  if (closedMoved.length) {
    const frames = new Map(closedMoved.flatMap(group => Object.entries(group.frozenFrames ?? {})));
    for (const group of closedMoved) if (!frames.has(group.rootId)) frames.set(group.rootId, { width: group.worldBounds.w, height: group.worldBounds.h });
    const expose = (nodes: readonly CanvasNode[]) => nodes.map(node => {
      const frame = frames.get(node.id);
      return frame ? { ...node, ...frame, type: 'structure', data: { ...node.data, expanded: true } } : node;
    });
    return validateFrozenConnections(expose(before), expose(after), stage, stored, groups, rendered);
  }
  const projection=hierarchyProjection(after,stage),edges=aggregateProjectedEdges(projection,Object.fromEntries(stage.graph.edges.map(e=>[e.id,{kind:'inherited' as const,label:'沿用'}])));
  const geometry=createDiagramGeometry(after,projection,reservedLockedRoutes(stored,after,groups));
  const changed=after.filter(node=>{const old=before.find(n=>n.id===node.id);return !old||JSON.stringify(worldBounds(old,before))!==JSON.stringify(worldBounds(node,after));});
  const changedIds=new Set(changed.map(n=>n.id)),issues:StageConflict[]=[];
  for(const edge of edges){
    if(edge.aggregated||edge.members[0]!.source.boundary||edge.members[0]!.target.boundary)continue;
    const snapshot=stored.find(route=>route.canonicalEdgeId===edge.id);
    if(!snapshot?.frozenBoundaries?.length)continue;
    if(snapshot.frozenBoundaries.some(part=>!after.find(node=>node.id===part.ownerId)!.data.expanded))continue;
    const old=rendered?.get(edge.id),points=old?.points??worldRoutePoints(snapshot,before)??[];
    const affected=[edge.source,edge.target,...snapshot.frozenBoundaries.map(p=>p.ownerId)].some(id=>changedIds.has(id))||changed.some(node=>points.slice(1).some((p,i)=>segmentCrossesRect(points[i]!,p,worldBounds(node,after))));
    if(!affected)continue;
    const start = routeEndpoint(geometry.bounds.get(edge.source), snapshot.source.handle, 'source')?.anchor;
    const end = routeEndpoint(geometry.bounds.get(edge.target), snapshot.target.handle, 'target')?.anchor;
    if (!start || !end) {
      issues.push({ kind: 'locked-route', entityIds: [edge.id], message: '冻结连接的端口不存在', actions: ['cancel'] });
      continue;
    }
    const fallback={sourceHandle:snapshot.source.handle!,targetHandle:snapshot.target.handle!,points:[start,{x:end.x,y:start.y},end],text:edge.text};
    const result=resolveFrozenBoundaryRoute(edge.id,snapshot,after,geometry,edge.source,edge.target,fallback,groups);
    if(!result.ok)issues.push({kind:'locked-route',entityIds:[edge.id],message:`${edge.text || edge.id}：${result.message}`,actions:['cancel']});
  }
  return issues;
}
