/** Three-way merging of a target stage draft against its last inherited base. */
import type { StageSnapshot } from '../../core/schema/types.ts';
import { endpointFingerprint } from './edge-routes.ts';
import type { StageConflict } from './stage-types.ts';
import type { CanvasBaselineContent, CanvasNodeView, DisplayRouteSnapshot, EdgeRouteSnapshot, FrozenGroupSnapshot } from './workspace.ts';

/** The parent and generated target used when the current target draft branched. */
export interface StageInheritanceBase {
  parentId: string;
  parentRevision: string;
  parentContent: CanvasBaselineContent;
  targetRevision: string;
  targetStage: StageSnapshot;
  targetContent: CanvasBaselineContent;
}

export interface StageInheritanceInput {
  parentId: string;
  parentRevision: string;
  parentContent: CanvasBaselineContent;
  targetStage: StageSnapshot;
}

export function captureStageInheritance(input: StageInheritanceInput & { targetContent: CanvasBaselineContent }): StageInheritanceBase {
  return structuredClone({ ...input, targetRevision: input.targetStage.graph.revision ?? input.targetStage.id });
}

/** Compare the actual confirmed parent and source, including when the parent keeps its revision. */
export function needsStageRebase(base: StageInheritanceBase, current: StageInheritanceInput): boolean {
  return base.parentId !== current.parentId || base.parentRevision !== current.parentRevision
    || !equal(base.parentContent, current.parentContent)
    || base.targetRevision !== (current.targetStage.graph.revision ?? current.targetStage.id)
    || !equal(base.targetStage, current.targetStage);
}

export type StageContentMerge = { ok: true; content: CanvasBaselineContent } | { ok: false; conflicts: StageConflict[] };

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => equal(left[key], right[key]));
}

function conflict(entityId: string, message: string): StageConflict {
  return { kind: 'merge-conflict', entityIds: [entityId], message, actions: ['cancel'] };
}

function choose<T>(base: T, local: T, incoming: T, id: string, field: string, conflicts: StageConflict[]): T {
  if (equal(local, incoming)) return local;
  if (equal(local, base)) return incoming;
  if (equal(incoming, base)) return local;
  conflicts.push(conflict(id, `${id} 的${field}在当前阶段和上游均有不同修改`));
  return local;
}

function worldPositions(nodes: readonly CanvasNodeView[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = new Map<string, { x: number; y: number }>();
  const get = (node: CanvasNodeView): { x: number; y: number } => {
    const existing = result.get(node.id);
    if (existing) return existing;
    const parent = node.parentId ? get(byId.get(node.parentId)!) : { x: 0, y: 0 };
    const world = { x: parent.x + node.position.x, y: parent.y + node.position.y };
    result.set(node.id, world);
    return world;
  };
  for (const node of nodes) get(node);
  return result;
}

function maps<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

function mergeEntity<T>(base: T | undefined, local: T | undefined, incoming: T | undefined, id: string, conflicts: StageConflict[]): T | undefined {
  if (base === undefined) {
    if (local === undefined) return incoming;
    if (incoming === undefined || equal(local, incoming)) return local;
    conflicts.push(conflict(id, `${id} 在当前阶段和上游同时新增且内容不同`));
    return local;
  }
  if (local === undefined && incoming === undefined) return undefined;
  if (local === undefined) {
    if (!equal(base, incoming)) conflicts.push(conflict(id, `${id} 已在当前阶段删除，但上游修改了它`));
    return undefined;
  }
  if (incoming === undefined) {
    if (!equal(base, local)) conflicts.push(conflict(id, `${id} 已在上游删除，但当前阶段修改了它`));
    return undefined;
  }
  return choose(base, local, incoming, id, '内容', conflicts);
}

function mergeAtomicList<T>(base: readonly T[], local: readonly T[], incoming: readonly T[], key: (item: T) => string, conflicts: StageConflict[]): T[] {
  const a = maps(base, key), b = maps(local, key), c = maps(incoming, key);
  const order = [...new Set([...local.map(key), ...incoming.map(key), ...base.map(key)])];
  return order.flatMap((id) => {
    const merged = mergeEntity(a.get(id), b.get(id), c.get(id), id, conflicts);
    return merged === undefined ? [] : [structuredClone(merged)];
  });
}

/** Text and canonical members belong to the current stage, while route geometry is editable. */
function mergeDisplayRoutes(base: readonly DisplayRouteSnapshot[], local: readonly DisplayRouteSnapshot[], incoming: readonly DisplayRouteSnapshot[], targetStage: StageSnapshot): DisplayRouteSnapshot[] {
  const geometry = (route: DisplayRouteSnapshot) => { const { text: _text, memberIds: _members, barrierKey: _barriers, ...value } = route; return value; };
  const a = maps(base.map(geometry), (route) => route.id), b = maps(local.map(geometry), (route) => route.id), c = maps(incoming.map(geometry), (route) => route.id);
  const currentText = maps(incoming, (route) => route.id), localText = maps(local, (route) => route.id);
  const edgeIds = new Set(targetStage.graph.edges.map((edge) => edge.id));
  const order = [...new Set([...local.map((route) => route.id), ...incoming.map((route) => route.id), ...base.map((route) => route.id)])];
  return order.flatMap((id) => {
    const hidden = localText.get(id);
    const metadata = currentText.get(id) ?? hidden;
    if (!metadata?.memberIds.some(member => edgeIds.has(member))) return [];
    if (a.has(id) && hidden && !c.has(id)) {
      const members = hidden.memberIds.filter((member) => edgeIds.has(member));
      if (members.length) return [{ ...structuredClone(hidden), memberIds: members }];
    }
    const useLocal = b.has(id) && !equal(a.get(id), b.get(id));
    const value = useLocal ? b.get(id) : c.get(id) ?? b.get(id);
    if (!value) return [];
    const source = currentText.get(id) ?? localText.get(id)!;
    const geometrySource = useLocal ? hidden : currentText.get(id) ?? hidden;
    return [{ ...structuredClone(value), text: source.text, memberIds: [...source.memberIds], ...(geometrySource?.barrierKey ? { barrierKey: geometrySource.barrierKey } : {}) }];
  });
}

/** Legacy worldBounds positions describe capture time; current geometry is owner-relative. */
function frozenInvariant(group: FrozenGroupSnapshot) {
  return { ...group, worldBounds: { w: group.worldBounds.w, h: group.worldBounds.h } };
}

function mergeFrozenGroups(base: readonly FrozenGroupSnapshot[], local: readonly FrozenGroupSnapshot[], incoming: readonly FrozenGroupSnapshot[], conflicts: StageConflict[]): FrozenGroupSnapshot[] {
  const a = maps(base.map(frozenInvariant), (group) => group.id), b = maps(local.map(frozenInvariant), (group) => group.id), c = maps(incoming.map(frozenInvariant), (group) => group.id);
  const latest = maps(incoming, (group) => group.id), edited = maps(local, (group) => group.id);
  const order = [...new Set([...local.map((group) => group.id), ...incoming.map((group) => group.id), ...base.map((group) => group.id)])];
  return order.flatMap((id) => {
    const value = mergeEntity(a.get(id), b.get(id), c.get(id), id, conflicts);
    if (!value) return [];
    const source = latest.get(id) ?? edited.get(id)!;
    return [{ ...structuredClone(value), worldBounds: { ...value.worldBounds, x: source.worldBounds.x, y: source.worldBounds.y } }];
  });
}

function mergeNodes(base: readonly CanvasNodeView[], local: readonly CanvasNodeView[], incoming: readonly CanvasNodeView[], conflicts: StageConflict[]): CanvasNodeView[] {
  const old = maps(base, (node) => node.id), edited = maps(local, (node) => node.id), latest = maps(incoming, (node) => node.id);
  const oldWorld = worldPositions(base), editedWorld = worldPositions(local), latestWorld = worldPositions(incoming);
  const order = [...new Set([...local.map((node) => node.id), ...incoming.map((node) => node.id), ...base.map((node) => node.id)])];
  const merged = new Map<string, CanvasNodeView>();
  const world = new Map<string, { x: number; y: number }>();
  const followParent = new Map<string, string>();
  const addedParentOrigin = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    const a = old.get(id), b = edited.get(id), c = latest.get(id);
    if (!a || !b || !c) {
      const selected = mergeEntity(a, b, c, id, conflicts);
      if (a && b && !c && (b.data.frozen || b.data.layoutMode === 'locked' || b.data.layoutMode === 'fixed')) conflicts.push(conflict(id, `${id} 已被固定或冻结，但上游删除了它`));
      if (selected) {
        merged.set(id, structuredClone(selected));
        const selectedWorld = selected === b ? editedWorld : latestWorld;
        world.set(id, selectedWorld.get(id)!);
        if (!a && selected.parentId) addedParentOrigin.set(id, selectedWorld.get(selected.parentId)!);
      }
      continue;
    }
    const parentId = choose(a.parentId, b.parentId, c.parentId, id, '归属', conflicts);
    const originalWorld = oldWorld.get(id)!, localWorld = editedWorld.get(id)!, incomingWorld = latestWorld.get(id)!;
    const baseParent = a.parentId && oldWorld.get(a.parentId), localParent = a.parentId && editedWorld.get(a.parentId), incomingParent = a.parentId && latestWorld.get(a.parentId);
    const sameParent = !!a.parentId && parentId === a.parentId && b.parentId === a.parentId && c.parentId === a.parentId && baseParent && localParent && incomingParent;
    const localShift = sameParent ? { x: localParent.x - baseParent.x, y: localParent.y - baseParent.y } : { x: 0, y: 0 };
    const incomingShift = sameParent ? { x: incomingParent.x - baseParent.x, y: incomingParent.y - baseParent.y } : { x: 0, y: 0 };
    const anchored = sameParent && ((!equal(localShift, { x: 0, y: 0 }) && equal(localWorld, originalWorld) && !equal(a.position, b.position))
      || (!equal(incomingShift, { x: 0, y: 0 }) && equal(incomingWorld, originalWorld) && !equal(a.position, c.position)));
    const normal = (point: { x: number; y: number }, shift: { x: number; y: number }) => ({ x: point.x - shift.x, y: point.y - shift.y });
    const position = choose(originalWorld, sameParent && !anchored ? normal(localWorld, localShift) : localWorld, sameParent && !anchored ? normal(incomingWorld, incomingShift) : incomingWorld, id, '世界位置', conflicts);
    if (sameParent && !anchored) followParent.set(id, a.parentId!);
    if ((b.data.frozen || b.data.layoutMode === 'fixed' || b.data.layoutMode === 'locked')
      && (!equal(a.parentId, c.parentId) || (!equal(originalWorld, incomingWorld) && (!sameParent || !equal(a.position, c.position))))) {
      conflicts.push(conflict(id, `${id} 的固定锚点受到上游变化影响`));
    }
    if (b.data.frozen && (a.width !== c.width || a.height !== c.height)) conflicts.push(conflict(id, `${id} 的冻结尺寸受到上游变化影响`));
    const size = choose({ width: a.width, height: a.height }, { width: b.width, height: b.height }, { width: c.width, height: c.height }, id, '尺寸', conflicts);
    const shape = choose({ type: a.type, expanded: a.data.expanded }, { type: b.type, expanded: b.data.expanded }, { type: c.type, expanded: c.data.expanded }, id, '展开状态', conflicts);
    const keys = new Set([...Object.keys(a.data), ...Object.keys(b.data), ...Object.keys(c.data)]);
    keys.delete('expanded');
    const data: Record<string, unknown> = {};
    for (const key of keys) {
      const before = (a.data as Record<string, unknown>)[key], here = (b.data as Record<string, unknown>)[key], there = (c.data as Record<string, unknown>)[key];
      const value = choose(before, here, there, id, key, conflicts);
      if (value !== undefined) data[key] = structuredClone(value);
    }
    if (shape.expanded !== undefined) data.expanded = shape.expanded;
    merged.set(id, { id, type: shape.type, ...(parentId ? { parentId } : {}), position: { x: 0, y: 0 }, ...size, data: data as CanvasNodeView['data'] });
    world.set(id, position);
  }

  const result: CanvasNodeView[] = [], visited = new Set<string>(), visiting = new Set<string>();
  const append = (node: CanvasNodeView): void => {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) { conflicts.push(conflict(node.id, `${node.id} 的合并归属形成循环`)); return; }
    visiting.add(node.id);
    const parent = node.parentId ? merged.get(node.parentId) : undefined;
    if (node.parentId && !parent) conflicts.push(conflict(node.id, `${node.id} 的合并归属不存在`));
    if (parent) append(parent);
    let point = world.get(node.id)!;
    const follow = followParent.get(node.id);
    if (follow && parent) {
      const oldParent = oldWorld.get(follow)!, newParent = world.get(parent.id)!;
      point = { x: point.x + newParent.x - oldParent.x, y: point.y + newParent.y - oldParent.y };
      world.set(node.id, point);
    }
    const addedOrigin = addedParentOrigin.get(node.id);
    if (addedOrigin && parent) {
      const newParent = world.get(parent.id)!;
      point = { x: point.x + newParent.x - addedOrigin.x, y: point.y + newParent.y - addedOrigin.y };
      world.set(node.id, point);
    }
    const origin = parent ? world.get(parent.id)! : { x: 0, y: 0 };
    node.position = { x: point.x - origin.x, y: point.y - origin.y };
    visiting.delete(node.id); visited.add(node.id); result.push(node);
  };
  for (const node of merged.values()) append(node);
  return result;
}

export function mergeStageContent(input: { base: CanvasBaselineContent; local: CanvasBaselineContent; incoming: CanvasBaselineContent; targetStage: StageSnapshot }): StageContentMerge {
  const { base, local, incoming, targetStage } = input;
  const conflicts: StageConflict[] = [];
  const nodes = mergeNodes(base.nodes, local.nodes, incoming.nodes, conflicts);
  const edgeRoutes = mergeAtomicList(base.edgeRoutes, local.edgeRoutes, incoming.edgeRoutes, (route: EdgeRouteSnapshot) => route.canonicalEdgeId, conflicts);
  const displayRoutes = mergeDisplayRoutes(base.displayRoutes ?? [], local.displayRoutes ?? [], incoming.displayRoutes ?? [], targetStage);
  const frozenGroups = mergeFrozenGroups(base.frozenGroups, local.frozenGroups, incoming.frozenGroups, conflicts);
  const overlay = choose(base.overlay, local.overlay, incoming.overlay, 'overlay', '用户覆盖层', conflicts);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const frozenOwners = new Map<string, string>();
  for (const group of frozenGroups) {
    for (const id of [group.rootId, ...group.memberIds]) {
      const previous = frozenOwners.get(id);
      if (previous && previous !== group.id) conflicts.push(conflict(id, `冻结子图 ${previous} 和 ${group.id} 的成员重叠`));
      frozenOwners.set(id, group.id);
    }
  }
  for (const group of local.frozenGroups) {
    const remaining = frozenGroups.find((item) => item.id === group.id);
    if (!remaining || !equal(frozenInvariant(group), frozenInvariant(remaining)) || [group.rootId, ...group.memberIds].some((id) => !nodeIds.has(id))) conflicts.push(conflict(group.id, '上游变化影响了冻结子图或其成员，请先处理冻结状态'));
  }
  const edges = new Map(targetStage.graph.edges.map((edge) => [edge.id, edge]));
  for (const route of local.edgeRoutes) {
    if (route.state === 'auto') continue;
    const edge = edges.get(route.canonicalEdgeId);
    const retained = edgeRoutes.find((item) => item.canonicalEdgeId === route.canonicalEdgeId);
    if (!edge || !retained || !equal(route, retained) || endpointFingerprint(edge) !== route.endpointFingerprint) conflicts.push(conflict(route.canonicalEdgeId, '上游变化影响了固定或锁定路径，请先处理路径冲突'));
  }
  if (conflicts.length) return { ok: false, conflicts };
  return { ok: true, content: { nodes, edgeRoutes, frozenGroups, ...(overlay ? { overlay: structuredClone(overlay) } : {}), ...((base.displayRoutes || local.displayRoutes || incoming.displayRoutes) ? { displayRoutes } : {}) } };
}
