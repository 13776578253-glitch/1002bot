/** Capture canonical paths and hard boundary segments for a frozen subgraph. */
import { obstacleFromRect, portAnchor, rectIntersects, routeOrthogonal, simplifyPoints, type Point, type Rect } from '../../core/layout/geometry.ts';
import { projectGraph } from '../../core/projection/index.ts';
import type { StageSnapshot } from '../../core/schema/types.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from './grouping.ts';
import { MAX_CONTAINER_EXTRA } from './spacing.ts';
import { createDiagramGeometry, pathIsClear, routeDiagramGeometry, segmentCrossesRect, type DiagramGeometry } from './routing.ts';
import { placeEdgeLabel } from './labels.ts';
import { endpointFingerprint, routeSnapshotForEdge, storedRouteAttached, worldRoutePoints, reservedLockedRoutes } from './edge-routes.ts';
import { hierarchyProjection } from './hierarchy.ts';
import { unfreezeGroup } from './frozen.ts';
import { aggregateProjectedEdges, type DisplayEdge } from './display-edges.ts';
import type { CachedRoute } from './route-cache.ts';
import type { EdgeRouteSnapshot, FrozenBoundarySegment, FrozenBoundarySide, FrozenGroupSnapshot } from './workspace.ts';
import type { StageConflict } from './stage-types.ts';

interface CaptureInput {
  nodes: readonly CanvasNode[];
  stage: StageSnapshot;
  group: FrozenGroupSnapshot;
  groups: readonly FrozenGroupSnapshot[];
  displayEdges: readonly DisplayEdge[];
  displayRoutes: ReadonlyMap<string, CachedRoute>;
  storedRoutes: readonly EdgeRouteSnapshot[];
}
export type FrozenCaptureResult =
  | { ok: true; nodes: CanvasNode[]; group: FrozenGroupSnapshot; routes: EdgeRouteSnapshot[] }
  | { ok: false; conflicts: StageConflict[] };

const EPSILON = 0.001;
const size = (n: CanvasNode) => ({ width: n.width ?? CARD_SIZE.width, height: n.height ?? CARD_SIZE.height });
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const hasPoint = (rect: Rect, point: Point) => point.x >= rect.x - EPSILON && point.x <= rect.x + rect.w + EPSILON && point.y >= rect.y - EPSILON && point.y <= rect.y + rect.h + EPSILON;
const worldBounds = (node: CanvasNode, nodes: readonly CanvasNode[]): Rect => ({ ...worldPosition(node, nodes), w: size(node).width, h: size(node).height });

/** Materialize expanded frames without translating any existing node. */
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

/** Extract the actual first exit, including the exact port on the frame. */
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

const vector = (side: FrozenBoundarySide) => ({ x: side === 'right' ? 1 : side === 'left' ? -1 : 0, y: side === 'bottom' ? 1 : side === 'top' ? -1 : 0 });
const handles: Record<string, FrozenBoundarySide> = { out: 'bottom', 'top-out': 'top', 'return-out': 'right', 'left-out': 'left', in: 'top', 'bottom-in': 'bottom', return: 'right', 'left-in': 'left' };
const boundaryCache=new WeakMap<EdgeRouteSnapshot,{points:Point[];boundaryKey:string;route:CachedRoute;connector:Point[]}>();

/** Connect rigid internal segments through free space; an invalid result is a conflict. */
export function resolveFrozenBoundaryRoute(edgeId: string, snapshot: EdgeRouteSnapshot, nodes: readonly CanvasNode[], geometry: DiagramGeometry, sourceId: string, targetId: string, fallback: CachedRoute, groups: readonly FrozenGroupSnapshot[], preserveConnector = false): { ok: true; route: CachedRoute } | { ok: false; message: string } {
  const source = snapshot.frozenBoundaries?.find((part) => part.endpoint === 'source');
  const target = snapshot.frozenBoundaries?.find((part) => part.endpoint === 'target');
  if (!source && !target) return { ok: true, route: fallback };
  const sourceFragment = source ? boundaryWorldPoints(source, nodes) : [fallback.points[0]!];
  const targetFragment = target ? boundaryWorldPoints(target, nodes) : [fallback.points.at(-1)!];
  const boundaryKey=JSON.stringify([sourceFragment,targetFragment]);
  const cached=boundaryCache.get(snapshot);
  const start = sourceFragment.at(-1)!, end = targetFragment.at(-1)!;
  const startSide = source?.side ?? handles[fallback.sourceHandle]!;
  const endSide = target?.side ?? handles[fallback.targetHandle]!;
  const a = vector(startSide), b = vector(endSide);
  const ownerIds = new Set([source?.ownerId, target?.ownerId].filter((id): id is string => !!id));
  const ownerRects = [...ownerIds].map((id) => {
    const owner = nodes.find((node) => node.id === id)!, group = groups.find((item) => item.rootId === id)!;
    const origin = worldPosition(owner, nodes), frame = group.protectedFrame ?? { x: 0, y: 0, ...(group.frozenFrames?.[id] ?? size(owner)) };
    return { x: origin.x + frame.x, y: origin.y + frame.y, w: frame.width, h: frame.height };
  });
  const internal = (rect: Rect) => ownerRects.some(owner => rect.x >= owner.x - 4 && rect.y >= owner.y - 4 && rect.x + rect.w <= owner.x + owner.w + 4 && rect.y + rect.h <= owner.y + owner.h + 4);
  const externalReserved = geometry.reserved.filter(item => !internal(item.rect));
  const connectorGeometry = { ...geometry, reserved: externalReserved };
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
  if (matches(source) && matches(target) && pathIsClear(fallback.points, preserveConnector ? { ...geometry, reserved: [] } : geometry, sourceId, targetId, edgeId)) {
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
  if(cached&&cached.boundaryKey===boundaryKey&&cached.route.text===fallback.text&&pathIsClear(cached.connector,connectorGeometry,sourceId,targetId,edgeId))return{ok:true,route:cached.route};
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
  const route={...fallback,points,label:placeEdgeLabel(connector,fallback.text,geometry.blockers,geometry.frames)};
  boundaryCache.set(snapshot,{points:fallback.points,boundaryKey,route,connector});
  return { ok: true, route };
}

/** Find a valid internal path to a real frame boundary before routing the free exterior. */
function captureCrossing(edge: DisplayEdge, sourceIn: boolean, geometry: DiagramGeometry, projectionNodes: readonly CanvasNode[], projection: ReturnType<typeof projectGraph>, nodes: readonly CanvasNode[], group: FrozenGroupSnapshot, groups: readonly FrozenGroupSnapshot[], existing: EdgeRouteSnapshot | undefined): { route: CachedRoute; segment: FrozenBoundarySegment } | undefined {
  const root = nodes.find((node) => node.id === group.rootId)!, rect = worldBounds(root, nodes);
  const generated = routeDiagramGeometry(geometry, edge.source, edge.target, edge.id);
  const normal: CachedRoute = { ...generated, text: edge.text, label: placeEdgeLabel(generated.points, edge.text, geometry.blockers, geometry.frames) };
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
    const direction = vector(candidate.side);
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

/** Capture every canonical incident edge; folded display edges never stand in for a member. */
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
    if (old && old.endpointFingerprint === endpointFingerprint(member.edge) && storedRouteAttached(old, virtual, geometry)) {
      const points = worldRoutePoints(old, virtual)!;
      const origin=old.space.kind==='owner'?worldPosition(virtual.find(node=>node.id===(old.space as {ownerId:string}).ownerId)!,virtual):{x:0,y:0};
      route = { points, sourceHandle: old.source.handle!, targetHandle: old.target.handle!, text: edge.text, label: old.label ? {...old.label,x:old.label.x+origin.x,y:old.label.y+origin.y} : placeEdgeLabel(points, edge.text, geometry.blockers, geometry.frames) };
    } else if (rendered) {
      const snapshot = routeSnapshotForEdge(edge, rendered, 'pinned', virtual, []);
      if (snapshot && storedRouteAttached(snapshot, virtual, geometry)) route = rendered;
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
      route = { ...generated, text: edge.text, label: placeEdgeLabel(generated.points, edge.text, geometry.blockers, geometry.frames) };
    }
    const snapshot = routeSnapshotForEdge(edge, route, sourceIn && targetIn ||old?.state==='locked' ? 'locked' : 'pinned', nodes, groups)!;
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

/** Only boundary connections touched by endpoint motion or new obstacles need preflight routing. */
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
    const start=portAnchor(geometry.bounds.get(edge.source)!,handles[snapshot.source.handle!]!);
    const end=portAnchor(geometry.bounds.get(edge.target)!,handles[snapshot.target.handle!]!);
    const fallback={sourceHandle:snapshot.source.handle!,targetHandle:snapshot.target.handle!,points:[start,{x:end.x,y:start.y},end],text:edge.text,label:old?.label??{x:0,y:0,width:0,height:0}};
    const result=resolveFrozenBoundaryRoute(edge.id,snapshot,after,geometry,edge.source,edge.target,fallback,groups);
    if(!result.ok)issues.push({kind:'locked-route',entityIds:[edge.id],message:`${edge.text || edge.id}：${result.message}`,actions:['cancel']});
  }
  return issues;
}
