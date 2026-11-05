/** Incremental placement preserves inherited content and follows the view's expansion policy. */
import type { Projection } from '../../core/projection/index.ts';
import type { StageSnapshot } from '../../core/schema/types.ts';
import type { Point, Rect } from '../../core/layout/geometry.ts';
import { CARD_SIZE, MIN_EDGE_GAP, isLayoutProtected, layoutProtectionConflict, worldPosition, type CanvasNode } from './grouping.ts';
import { hierarchyProjection, nodeIsVisible } from './hierarchy.ts';
import { toggleFrozenExpansion } from './frozen.ts';
import { containerInset, preferredContainerSize, MAX_CONTAINER_EXTRA } from './spacing.ts';
import type { EdgeRouteSnapshot, FrozenGroupSnapshot, StagePlacementRecord } from './workspace.ts';
import type { StageConflict } from './stage-types.ts';
import { fitAuthoredLayout } from './manual-layout.ts';

export interface PlacementInput {
  nodes: readonly CanvasNode[];
  stage: StageSnapshot;
  projection: Projection;
  addedNodeIds: readonly string[];
  preferredPositions?: Readonly<Record<string, Point>>;
  frozenGroups?: readonly FrozenGroupSnapshot[];
  routes?: readonly EdgeRouteSnapshot[];
  reservedPaths?: readonly { points: Point[]; source: string; target: string; label?:{x:number;y:number;width:number;height:number} }[];
  preserveExpansion?: boolean;
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

function routeBlocked(rect: Rect, routes: readonly EdgeRouteSnapshot[], reserved: NonNullable<PlacementInput['reservedPaths']>, nodes: readonly CanvasNode[], nodeId: string,clearance=10): boolean {
  const padded={x:rect.x-clearance,y:rect.y-clearance,w:rect.w+clearance*2,h:rect.h+clearance*2};
  if (reserved.some((route) => route.source !== nodeId && route.target !== nodeId && (route.points.slice(1).some((point, index) => intersectsSegment(padded, route.points[index]!, point))||route.label&&overlaps(padded,{x:route.label.x-route.label.width/2,y:route.label.y-route.label.height/2,w:route.label.width,h:route.label.height})))) return true;
  return routes.some((route) => {
    if (route.state === 'auto' || route.source.nodeId === nodeId || route.target.nodeId === nodeId) return false;
    const owner = route.space.kind === 'owner' ? nodes.find((node) => node.id === (route.space as { kind: 'owner'; ownerId: string }).ownerId) : undefined;
    if (route.space.kind === 'owner' && !owner) return false;
    const origin = owner ? worldPosition(owner, nodes) : { x: 0, y: 0 };
    const points = route.points.map((point) => ({ x: point.x + origin.x, y: point.y + origin.y }));
    return points.slice(1).some((point, index) => intersectsSegment(padded, points[index]!, point));
  });
}

/** 围绕已安置子节点扩展框；原点移动时补偿子节点坐标。 */
function fitFrame(input: readonly CanvasNode[], id: string, pending: ReadonlySet<string>, opening: boolean, bias: Point = { x: 0, y: 0 }): CanvasNode[] | undefined {
  const parent = byId(input, id);
  const inset = { x: 24, top: parent.type === 'cluster' ? 60 : 72, bottom: 24 };
  const children = input.filter((node) => node.parentId === id && !pending.has(node.id));
  const totalChildren = input.filter((node) => node.parentId === id).length;
  const width = parent.width ?? CARD_SIZE.width, height = parent.height ?? CARD_SIZE.height;
  let minX = Math.min(0, ...children.map((child) => child.position.x - inset.x));
  let minY = Math.min(0, ...children.map((child) => child.position.y - inset.top));
  const maxX = Math.max(opening ? 48 + CARD_SIZE.width : width, ...children.map((child) => child.position.x + size(child).w + inset.x));
  const minimumRows = Math.min(2, Math.max(1, totalChildren));
  const maxY = Math.max(opening ? inset.top + CARD_SIZE.height * minimumRows + MIN_EDGE_GAP * (minimumRows - 1) + inset.bottom : height, ...children.map((child) => child.position.y + size(child).h + inset.bottom));
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

/** 只拒绝新产生的重叠；已有源几何保持不变。 */
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

function fitChain(nodes: readonly CanvasNode[], ids: readonly string[], stage: StageSnapshot, pending: ReadonlySet<string>, opened: ReadonlySet<string>, bias: Point = { x: 0, y: 0 }, protection?: PlacementInput): CanvasNode[] | undefined {
  let next = [...nodes];
  for (const id of [...ids].reverse()) {
    const fitted = fitFrame(next, id, pending, opened.has(id), bias);
    if (!fitted || !collisionFree(next, fitted, stage, pending)) return undefined;
    if(protection){
      const frame=byId(fitted,id),old=byId(next,id);
      const header={...box(frame,fitted),h:frame.type==='cluster'?54:68};
      const oldHeader={...box(old,next),h:old.type==='card'?old.height!:old.type==='cluster'?54:68};
      if(routeBlocked(header,protection.routes??[],protection.reservedPaths??[],protection.nodes,id,0)&&!routeBlocked(oldHeader,protection.routes??[],protection.reservedPaths??[],protection.nodes,id,0))return undefined;
    }
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
      { x: r.x - own.w - gap, y: r.y }, { x: r.x, y: r.y - own.h - gap },
      { x:r.x+r.w-own.w,y:r.y+r.h+gap },{x:r.x+r.w-own.w,y:r.y-own.h-gap},
      { x:r.x-own.w-gap,y:r.y+r.h-own.h },{x:r.x+r.w+gap,y:r.y+r.h-own.h});
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
    const limitW=(parent.data.contentWidth??extent.w)+MAX_CONTAINER_EXTRA;
    const limitH=(parent.data.contentHeight??extent.h)+MAX_CONTAINER_EXTRA;
    const xs=[inset.x,extent.w-inset.x-own.w],ys=[inset.top,extent.h-inset.bottom-own.h];
    for(let x=extent.w-limitW+inset.x;x+own.w<=limitW-inset.x;x+=STEP)xs.push(x);
    for(let y=extent.h-limitH+inset.top;y+own.h<=limitH-inset.bottom;y+=STEP)ys.push(y);
    for(const x of xs)for(const y of ys)positions.push({x:parentWorld.x+x,y:parentWorld.y+y});
  } else {
    const settled = nodes.filter((item) => !item.parentId && !pending.has(item.id));
    const center = settled.length ? box(settled[0]!, nodes) : { x: 0, y: 0, w: 0, h: 0 };
    for (let radius = 1; radius <= 24; radius++) for (let i = -radius; i <= radius; i++) {
      for (const [x, y] of [[-radius, i], [radius, i], [i, -radius], [i, radius]]) positions.push({ x: center.x + x! * (own.w + MIN_EDGE_GAP), y: center.y + y! * (own.h + MIN_EDGE_GAP) });
    }
  }
  return positions;
}

function placeAuthoredAdditions(input: PlacementInput): PlacementResult {
  let working = [...input.nodes];
  const pending = new Set(input.addedNodeIds);
  const placements: StagePlacementRecord[] = [], conflicts: StageConflict[] = [];
  const ids = [...input.addedNodeIds].sort((a, b) => ancestorIds(working, b).length - ancestorIds(working, a).length);
  for (const id of ids) {
    const node = byId(working, id);
    const projection = hierarchyProjection(working, input.stage);
    if (!nodeIsVisible(node, working, projection)) {
      pending.delete(id); placements.push({ nodeId: id, mode: 'provided' }); continue;
    }
    const parent = node.parentId ? byId(working, node.parentId) : undefined;
    const origin = parent ? worldPosition(parent, working) : { x: 0, y: 0 };
    const preferred = worldPosition(node, working);
    const choices = candidates(node, working, input.stage, pending);
    choices.sort((a, b) => Math.abs(a.x - preferred.x) + Math.abs(a.y - preferred.y) - Math.abs(b.x - preferred.x) - Math.abs(b.y - preferred.y));
    let accepted: CanvasNode[] | undefined;
    let acceptedPoint: Point | undefined;
    let growthCandidate: { nodes: CanvasNode[]; point: Point } | undefined;
    const frames = ancestorIds(working, id).map((ancestor) => byId(working, ancestor));
    for (const point of choices) {
      const rect = { ...point, ...size(node) };
      if (routeBlocked(rect, input.routes ?? [], [], working, id)) continue;
      const trialPending = new Set(pending); trialPending.delete(id);
      const trial = replace(working, { ...node, position: { x: point.x - origin.x, y: point.y - origin.y } });
      const fitted = fitAuthoredLayout(input.nodes, trial, [id], input.stage, new Set(), trialPending);
      if (fitted.conflict) continue;
      const projection = hierarchyProjection(fitted.nodes, input.stage);
      const visible = fitted.nodes.filter((item) => !trialPending.has(item.id) && nodeIsVisible(item, fitted.nodes, projection));
      const actual = box(byId(fitted.nodes, id), fitted.nodes);
      if (visible.some((peer) => peer.id !== id && peer.parentId === node.parentId && overlaps(actual, box(peer, fitted.nodes), GAP))) continue;
      const grows = frames.some((frame) => {
        const next = byId(fitted.nodes, frame.id);
        return next.width! > frame.width! || next.height! > frame.height!;
      });
      if (grows) { growthCandidate ??= { nodes: fitted.nodes, point }; continue; }
      accepted = fitted.nodes; acceptedPoint = point;
      break;
    }
    if (!accepted && growthCandidate) { accepted = growthCandidate.nodes; acceptedPoint = growthCandidate.point; }
    if (!accepted) return { nodes: working, placements, expanded: [], conflicts: [{ kind: 'no-space', entityIds: [id], ...(parent ? { containerId: parent.id } : {}), message: `新增节点没有合法空位：${node.data.title}`, actions: ['cancel'] }] };
    placements.push({ nodeId: id, mode: acceptedPoint!.x === preferred.x && acceptedPoint!.y === preferred.y ? 'provided' : 'gap' });
    working = accepted; pending.delete(id);
  }
  return { nodes: working, placements, expanded: [], conflicts };
}

export function placeAddedNodes(input: PlacementInput): PlacementResult {
  if (input.preserveExpansion) return placeAuthoredAdditions(input);
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
      for (let repairAuto = 0; repairAuto < 2 && !fitted; repairAuto++) for (const bias of [{ x: 0, y: 0 }, { x: -0.5, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: -0.5, y: -1 }, { x: -1, y: -1 }]) {
        fitted = fitChain(next, [...ancestorIds(next, ancestor), ancestor], input.stage, pending, node.data.frozen ? new Set() : new Set([ancestor]), bias, repairAuto ? { ...input, reservedPaths: [] } : input);
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
    const height = 72 + Math.max(2,rows) * CARD_SIZE.height + (Math.max(2,rows)-1) * MIN_EDGE_GAP + 24;
    const current = children.length && original.data.expandable && !original.data.expanded
      ? { ...original, type: 'structure', dragHandle: '.structure-header', width, height, measured: { width, height }, style: { ...original.style, width, height }, data: { ...original.data, expanded: true, contentWidth: width, contentHeight: height } }
      : original;
    const variants=[current];
    if(children.length&&current!==original)for(const count of [1,2]){
      const rows=Math.ceil(children.length/count),width=48+count*CARD_SIZE.width+(count-1)*MIN_EDGE_GAP,height=96+rows*CARD_SIZE.height+(rows-1)*MIN_EDGE_GAP;
      if(width!==current.width)variants.push({...current,width,height,measured:{width,height},style:{...current.style,width,height},data:{...current.data,contentWidth:width,contentHeight:height}});
    }
    let accepted: CanvasNode[] | undefined, acceptedMode: StagePlacementRecord['mode'] = 'gap';
    const parent = current.parentId ? byId(working, current.parentId) : undefined;
    for(let repairAuto=0;repairAuto<2&&!accepted;repairAuto++)for(const current of variants){
    const parentWorld = parent ? worldPosition(parent, working) : { x: 0, y: 0 };
    const choices = candidates(current, working, input.stage, pending, input.preferredPositions?.[id]);
    if (parent) {
      const frame = box(parent, working), inset = containerInset(parent), own = size(current);
      const inside = (point: Point) => point.x >= frame.x + inset.x && point.y >= frame.y + inset.top && point.x + own.w <= frame.x + frame.w - inset.x && point.y + own.h <= frame.y + frame.h - inset.bottom;
      const growth=(p:Point)=>Math.max(0,frame.x+inset.x-p.x)+Math.max(0,frame.y+inset.top-p.y)+Math.max(0,p.x+own.w+inset.x-frame.x-frame.w)+Math.max(0,p.y+own.h+inset.bottom-frame.y-frame.h);
      choices.sort((a, b) => Number(!inside(a)) - Number(!inside(b))||growth(a)-growth(b));
    }
    for (const [index, point] of choices.entries()) {
      const candidate = { ...current, position: { x: point.x - parentWorld.x, y: point.y - parentWorld.y } };
      const candidateBox = { ...point, ...size(candidate) };
      const projection = hierarchyProjection(working, input.stage);
      const siblings = working.filter((item) => item.id !== id && item.parentId === current.parentId && !pending.has(item.id) && nodeIsVisible(item, working, projection));
      const frame=parent&&box(parent,working),inset=parent&&containerInset(parent);
      const grows=frame&&inset&&(candidateBox.x<frame.x+inset.x||candidateBox.y<frame.y+inset.top||candidateBox.x+candidateBox.w>frame.x+frame.w-inset.x||candidateBox.y+candidateBox.h>frame.y+frame.h-inset.bottom);
      const protectedPaths=(repairAuto?[]:input.reservedPaths??[]).filter(route=>!grows||route.source!==parent!.id&&route.target!==parent!.id);
      if (siblings.some((sibling) => overlaps(candidateBox, box(sibling, working), candidate.type === 'card' && sibling.type === 'card' ? MIN_EDGE_GAP : GAP)) || routeBlocked(candidateBox, routes, protectedPaths, input.nodes, id)) continue;
      const trialPending = new Set(pending); trialPending.delete(id);
      const trial = replace(working, candidate);
      const fitted = fitChain(trial, ancestors, input.stage, trialPending, new Set(),{x:0,y:0},repairAuto?{...input,reservedPaths:[]}:input);
      if (!fitted || !collisionFree(working, fitted, input.stage, trialPending)) continue;
      accepted = fitted;
      acceptedMode = input.preferredPositions?.[id] && index === 0 ? 'provided' : parent && (point.x < parentWorld.x || point.y < parentWorld.y || point.x + size(current).w > parentWorld.x + size(parent).w || point.y + size(current).h > parentWorld.y + size(parent).h) ? 'expanded' : 'gap';
      break;
    }
    if(accepted)break;
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

function resizeExpansionCandidate(nodes: CanvasNode[], id: string, width: number, height: number, content?: { contentWidth: number; contentHeight: number }): void {
  const index = nodes.findIndex((node) => node.id === id);
  const node = nodes[index]!;
  const oldWidth = node.width ?? CARD_SIZE.width, oldHeight = node.height ?? CARD_SIZE.height;
  const dx = width - oldWidth, dy = height - oldHeight;
  const key = nodes.filter((item) => item.data.expanded).map((item) => item.id).sort().join('|');
  const baseline = node.data.expansionSizes?.[key] ?? (content ? { width: content.contentWidth, height: content.contentHeight } : undefined);
  nodes[index] = { ...node, width, height, measured: { width, height }, style: { ...node.style, width, height }, ...(baseline ? { data: { ...node.data, contentWidth: baseline.width, contentHeight: baseline.height, expansionSizes: { ...node.data.expansionSizes, [key]: baseline } } } : {}) };
  for (let i = 0; i < nodes.length; i++) {
    const sibling = nodes[i]!;
    if (sibling.id === id || sibling.parentId !== node.parentId || isLayoutProtected(sibling)) continue;
    const w = sibling.width ?? CARD_SIZE.width, h = sibling.height ?? CARD_SIZE.height;
    let x = sibling.position.x, y = sibling.position.y;
    if (dx && x >= node.position.x + oldWidth && y + h > node.position.y && y < node.position.y + oldHeight) x += dx;
    if (dy && y >= node.position.y + oldHeight && x + w > node.position.x && x < node.position.x + Math.max(width, oldWidth)) y += dy;
    if (x !== sibling.position.x || y !== sibling.position.y) nodes[i] = { ...sibling, position: { x, y } };
  }
}

/**
 * 原位切换节点展开/收起状态：
 * 1. 在 card 与 structure 类型之间原位切换；
 * 2. 展开时自动按推荐尺寸撑开并向上级联重算父容器尺寸；
 * 3. 沿 X/Y 轴推开受波及的同级兄弟节点；
 * 4. 重新计算投影并更新内部节点的选中与可见性。
 */
function localExpansionCandidate(input: readonly CanvasNode[], id: string, stage: StageSnapshot): CanvasNode[] {
  let nodes = [...input];
  const index = nodes.findIndex((node) => node.id === id);
  const node = nodes[index];
  if (!node?.data.expandable) return input as CanvasNode[];
  const expanded = !node.data.expanded;
  const { dragHandle: _handle, ...base } = node;
  nodes[index] = {
    ...base, type: expanded ? 'structure' : 'card',
    ...(expanded ? { dragHandle: '.structure-header' } : {}),
    data: { ...node.data, expanded },
  };
  if (expanded) {
    const size = preferredContainerSize(nodes[index]!, nodes);
    resizeExpansionCandidate(nodes, id, size.width, size.height, size);
  } else resizeExpansionCandidate(nodes, id, CARD_SIZE.width, CARD_SIZE.height);
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodes.find((item) => item.id === parentId)!;
    if (parent.data.expandable && !parent.data.expanded) break;
    const bounds = preferredContainerSize(parent, nodes);
    resizeExpansionCandidate(nodes, parentId, bounds.width, bounds.height, bounds);
    parentId = parent.parentId;
  }
  const projection = hierarchyProjection(nodes, stage);
  nodes = nodes.map((item) => nodeIsVisible(item, nodes, projection) || !item.selected ? item : { ...item, selected: false });
  return nodes;
}

/** 用户展开先提出局部自由节点调整，再走共享框求解。 */
export function solveHierarchyExpansion(input: readonly CanvasNode[], id: string, stage: StageSnapshot): CanvasNode[] {
  const original = input.find((node) => node.id === id)!;
  const verify = (candidate: CanvasNode[]) => {
    if (candidate === input || !candidate.find(node => node.id === id)!.data.expanded) return candidate;
    let chain = [id], parent = original.parentId;
    while (parent) {
      const owner = byId(candidate, parent);
      if (!owner.data.expanded) break;
      chain.unshift(parent); parent = owner.parentId;
    }
    return fitChain(candidate, chain, stage, new Set(), new Set()) ?? input as CanvasNode[];
  };
  const candidate = verify(localExpansionCandidate(input, id, stage));
  if (candidate === input || !layoutProtectionConflict(input, candidate)) return candidate;
  if (original.data.expanded) return input as CanvasNode[];
  let top = 72;
  const column = input.map((node) => {
    if (node.parentId !== id) return node;
    if (isLayoutProtected(node)) {
      top = Math.max(top, node.position.y + (node.height ?? CARD_SIZE.height) + 64);
      return node;
    }
    const next = { ...node, position: { x: 24, y: top } };
    top += (node.height ?? CARD_SIZE.height) + 64;
    return next;
  });
  const local = verify(localExpansionCandidate(column, id, stage));
  return layoutProtectionConflict(input, local) ? input as CanvasNode[] : local;
}
