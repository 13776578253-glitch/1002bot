/** Three-way merging of a target stage draft against its last inherited base. */
import type { StageSnapshot } from '../../core/schema/types.ts';
import { endpointFingerprint } from './edge-routes.ts';
import type { StageConflict } from './stage-types.ts';
import type { CanvasBaselineContent, CanvasNodeView, DisplayRouteSnapshot, EdgeRouteSnapshot, FrozenGroupSnapshot } from './workspace.ts';
import { legacyLayoutEdits, type NodeLayoutEdits } from './layout-intent.ts';
import { labelPinKey, retainLabelPins } from './label-pins.ts';
import type { EdgeLabelPin } from './workspace.ts';

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
    || !equal(authoredContent(base.parentContent), authoredContent(current.parentContent))
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

function routeIntent(route: EdgeRouteSnapshot): Omit<EdgeRouteSnapshot, 'label'> {
  const { label: _label, ...intent } = route;
  return intent;
}

/** Auto-projected paths and label rectangles are caches, not changes to the parent view. */
function authoredContent(content: CanvasBaselineContent) {
  const { displayRoutes: _displayRoutes, edgeRoutes, frozenGroups, labelPins, ...rest } = content;
  return { ...rest, edgeRoutes: edgeRoutes.map(routeIntent), frozenGroups: frozenGroups.map((group) => ({
    ...group, ...(group.previousRoutes ? { previousRoutes: group.previousRoutes.map(routeIntent) } : {}),
  })), ...(labelPins?.length ? { labelPins: labelPins.map(({ memberFingerprints: _fingerprints, ...pin }) => pin) } : {}) };
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

function chooseGeometry<T>(base: T, local: T, incoming: T, userLocal: boolean, userIncoming: boolean, id: string, field: string, conflicts: StageConflict[], retainLegacy = false): T {
  if (equal(local, incoming)) return local;
  if (equal(local, base)) return incoming;
  if (equal(incoming, base)) return local;
  if (userLocal && userIncoming) conflicts.push(conflict(id, `${id} 的${field}存在互斥的人工修改`));
  if (userIncoming && !userLocal && !retainLegacy) return incoming;
  return local;
}

function mergeEdits(a: NodeLayoutEdits, b: NodeLayoutEdits, c: NodeLayoutEdits, id: string, conflicts: StageConflict[]): NodeLayoutEdits {
  const field = <T extends { origin: 'user' | 'legacy' }>(old: T | undefined, local: T | undefined, incoming: T | undefined, name: string): T | undefined => {
    const value = (edit: T | undefined) => { if (!edit) return undefined; const { origin: _origin, ...geometry } = edit; return geometry; };
    if (equal(value(local), value(incoming))) return local?.origin === 'user' ? local : incoming;
    if (equal(value(local), value(old))) return incoming;
    if (equal(value(incoming), value(old))) return local;
    return chooseGeometry(old, local, incoming, local?.origin === 'user', incoming?.origin === 'user', id, name, conflicts, local?.origin === 'legacy');
  };
  const position = field(a.position, b.position, c.position, '位置');
  const collapsed = field(a.sizes?.collapsed, b.sizes?.collapsed, c.sizes?.collapsed, '收起尺寸');
  const expanded = field(a.sizes?.expanded, b.sizes?.expanded, c.sizes?.expanded, '展开尺寸');
  return { version: 1, ...(position ? { position } : {}), ...((collapsed || expanded) ? { sizes: { ...(collapsed ? { collapsed } : {}), ...(expanded ? { expanded } : {}) } } : {}) };
}

function worldPositions(nodes: readonly CanvasNodeView[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const anchors = new Map<string, { x: number; y: number }>();
  const anchor = (node: CanvasNodeView): { x: number; y: number } => {
    const existing = anchors.get(node.id); if (existing) return existing;
    const edit = node.data.layoutEdits?.position;
    const parent = node.parentId ? anchor(byId.get(node.parentId)!) : { x: 0, y: 0 };
    const parentFrame = node.parentId ? byId.get(node.parentId) : undefined;
    const point = edit && edit.parentId === node.parentId ? { x: parent.x + edit.x, y: parent.y + edit.y } : { x: parent.x + node.position.x + (parentFrame?.data.fitOffset?.x ?? 0) - (node.data.fitOffset?.x ?? 0), y: parent.y + node.position.y + (parentFrame?.data.fitOffset?.y ?? 0) - (node.data.fitOffset?.y ?? 0) };
    anchors.set(node.id, point); return point;
  };
  for (const node of nodes) anchor(node);
  return anchors;
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

function mergeEdgeRoutes(base: readonly EdgeRouteSnapshot[], local: readonly EdgeRouteSnapshot[], incoming: readonly EdgeRouteSnapshot[], conflicts: StageConflict[]): EdgeRouteSnapshot[] {
  const old = maps(base, (route) => route.canonicalEdgeId), here = maps(local, (route) => route.canonicalEdgeId), there = maps(incoming, (route) => route.canonicalEdgeId);
  const ids = new Set([...old.keys(), ...here.keys(), ...there.keys()]);
  return [...ids].flatMap((id) => {
    const a = old.get(id), b = here.get(id), c = there.get(id);
    const selected = mergeEntity(a && routeIntent(a), b && routeIntent(b), c && routeIntent(c), id, conflicts);
    if (!selected) return [];
    const source = c && equal(routeIntent(c), selected) ? c : b && equal(routeIntent(b), selected) ? b : a!;
    return [structuredClone(source)];
  });
}

/** Text and canonical members belong to the current stage, while route geometry is editable. */
function mergeDisplayRoutes(base: readonly DisplayRouteSnapshot[], local: readonly DisplayRouteSnapshot[], incoming: readonly DisplayRouteSnapshot[], targetStage: StageSnapshot): DisplayRouteSnapshot[] {
  const geometry = (route: DisplayRouteSnapshot) => { const { text: _text, memberIds: _members, barrierKey: _barriers, label: _label, labelAttachment: _attachment, labelIdentity: _identity, labelPolicyKey: _policy, labelRouteKey: _routeKey, ...value } = route; return value; };
  const discardLabelCache = (route: DisplayRouteSnapshot): DisplayRouteSnapshot => {
    const { labelAttachment: _attachment, labelIdentity: _identity, labelPolicyKey: _policy, labelRouteKey: _routeKey, ...path } = route;
    return { ...structuredClone(path), label: { x: 0, y: 0, width: 0, height: 0 } };
  };
  const a = maps(base.map(geometry), (route) => route.id), b = maps(local.map(geometry), (route) => route.id), c = maps(incoming.map(geometry), (route) => route.id);
  const currentText = maps(incoming, (route) => route.id), localText = maps(local, (route) => route.id);
  const edgeIds = new Set(targetStage.graph.edges.map((edge) => edge.id));
  const order = [...new Set([...local.map((route) => route.id), ...incoming.map((route) => route.id), ...base.map((route) => route.id)])];
  return order.flatMap((id) => {
    const hidden = localText.get(id);
    const metadata = currentText.get(id) ?? hidden;
    if (!metadata?.memberIds.length || !metadata.memberIds.every(member => edgeIds.has(member))) return [];
    if (a.has(id) && hidden && !c.has(id)) {
      if (hidden.memberIds.every((member) => edgeIds.has(member))) return [discardLabelCache(hidden)];
    }
    const newest = currentText.get(id);
    const sameMembers = !hidden || !newest || equal([...hidden.memberIds].sort(), [...newest.memberIds].sort());
    const useLocal = sameMembers && b.has(id) && !equal(a.get(id), b.get(id));
    const value = useLocal ? hidden : newest ?? hidden;
    if (!value || !sameMembers && !newest) return [];
    return [discardLabelCache({ ...value, text: newest?.text ?? value.text })];
  });
}

/** Legacy worldBounds positions describe capture time; current geometry is owner-relative. */
function frozenInvariant(group: FrozenGroupSnapshot) {
  return { ...group, ...(group.previousRoutes ? { previousRoutes: group.previousRoutes.map(routeIntent) } : {}), worldBounds: { w: group.worldBounds.w, h: group.worldBounds.h } };
}

function mergeFrozenGroups(base: readonly FrozenGroupSnapshot[], local: readonly FrozenGroupSnapshot[], incoming: readonly FrozenGroupSnapshot[], conflicts: StageConflict[]): FrozenGroupSnapshot[] {
  const a = maps(base.map(frozenInvariant), (group) => group.id), b = maps(local.map(frozenInvariant), (group) => group.id), c = maps(incoming.map(frozenInvariant), (group) => group.id);
  const latest = maps(incoming, (group) => group.id), edited = maps(local, (group) => group.id);
  const order = [...new Set([...local.map((group) => group.id), ...incoming.map((group) => group.id), ...base.map((group) => group.id)])];
  return order.flatMap((id) => {
    const value = mergeEntity(a.get(id), b.get(id), c.get(id), id, conflicts);
    if (!value) return [];
    const newest = latest.get(id), local = edited.get(id);
    const selected = newest && equal(frozenInvariant(newest), value) ? newest : local!;
    const source = newest ?? local!;
    return [{ ...structuredClone(selected), worldBounds: { ...value.worldBounds, x: source.worldBounds.x, y: source.worldBounds.y } }];
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
    const oldEdits = a.data.layoutEdits ?? legacyLayoutEdits(a, base), localEdits = b.data.layoutEdits ?? legacyLayoutEdits(b, local), incomingEdits = c.data.layoutEdits ?? legacyLayoutEdits(c, incoming);
    const edits = mergeEdits(oldEdits, localEdits, incomingEdits, id, conflicts);
    const originalWorld = oldWorld.get(id)!, localWorld = editedWorld.get(id)!, incomingWorld = latestWorld.get(id)!;
    const baseParent = a.parentId && oldWorld.get(a.parentId), localParent = a.parentId && editedWorld.get(a.parentId), incomingParent = a.parentId && latestWorld.get(a.parentId);
    const sameParent = !!a.parentId && parentId === a.parentId && b.parentId === a.parentId && c.parentId === a.parentId && baseParent && localParent && incomingParent;
    const localShift = sameParent ? { x: localParent.x - baseParent.x, y: localParent.y - baseParent.y } : { x: 0, y: 0 };
    const incomingShift = sameParent ? { x: incomingParent.x - baseParent.x, y: incomingParent.y - baseParent.y } : { x: 0, y: 0 };
    const anchored = sameParent && ((!equal(localShift, { x: 0, y: 0 }) && equal(localWorld, originalWorld) && !equal(a.position, b.position))
      || (!equal(incomingShift, { x: 0, y: 0 }) && equal(incomingWorld, originalWorld) && !equal(a.position, c.position)));
    const normal = (point: { x: number; y: number }, shift: { x: number; y: number }) => ({ x: point.x - shift.x, y: point.y - shift.y });
    let position = chooseGeometry(originalWorld, sameParent && !anchored ? normal(localWorld, localShift) : localWorld, sameParent && !anchored ? normal(incomingWorld, incomingShift) : incomingWorld, false, false, id, '世界位置', conflicts);
    if (edits.position && edits.position.parentId === parentId && (!anchored || edits.position.origin === 'user')) {
      const branch = edits.position === incomingEdits.position ? latestWorld : editedWorld;
      const origin = sameParent && !anchored ? baseParent : parentId ? branch.get(parentId)! : { x: 0, y: 0 };
      position = { x: origin.x + edits.position.x, y: origin.y + edits.position.y };
      if (!sameParent && parentId) addedParentOrigin.set(id, origin);
    }
    if (sameParent && !anchored) followParent.set(id, a.parentId!);
    const localAnchor = sameParent && !anchored ? normal(localWorld, localShift) : localWorld;
    if ((b.data.frozen || b.data.layoutMode === 'fixed' || b.data.layoutMode === 'locked')
      && (!equal(b.parentId, parentId) || !equal(localAnchor, position))) {
      conflicts.push(conflict(id, `${id} 的固定锚点受到上游变化影响`));
    }
    if (b.data.frozen && Object.entries(incomingEdits.sizes ?? {}).some(([state, size]) => { const oldSize = oldEdits.sizes?.[state as 'collapsed' | 'expanded'] ?? a; return size.origin === 'user' && (size.width !== oldSize.width || size.height !== oldSize.height); })) conflicts.push(conflict(id, `${id} 的冻结尺寸受到上游变化影响`));
    const shape = choose({ type: a.type, expanded: a.data.expanded }, { type: b.type, expanded: b.data.expanded }, { type: c.type, expanded: c.data.expanded }, id, '展开状态', conflicts);
    const preference = edits.sizes?.[shape.expanded || shape.type === 'cluster' ? 'expanded' : 'collapsed'];
    const frame = shape.expanded === b.data.expanded ? b : c;
    const size = preference ? { width: preference.width, height: preference.height } : { width: frame.width, height: frame.height };
    const keys = new Set([...Object.keys(a.data), ...Object.keys(b.data), ...Object.keys(c.data)]);
    for (const key of ['expanded', 'layoutEdits', 'contentWidth', 'contentHeight', 'fitOffset', 'reflowOrigin', 'expansionSizes']) keys.delete(key);
    const data: Record<string, unknown> = { ...Object.fromEntries(['contentWidth', 'contentHeight', 'fitOffset', 'reflowOrigin', 'expansionSizes'].flatMap((key) => {
      const value = (frame.data as Record<string, unknown>)[key]; return value === undefined ? [] : [[key, structuredClone(value)]];
    })), layoutEdits: edits };
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
    node.position = { x: point.x - origin.x - (parent?.data.fitOffset?.x ?? 0) + (node.data.fitOffset?.x ?? 0), y: point.y - origin.y - (parent?.data.fitOffset?.y ?? 0) + (node.data.fitOffset?.y ?? 0) };
    if (node.data.layoutEdits?.position?.origin === 'legacy') node.data.layoutEdits = { ...node.data.layoutEdits, position: { x: point.x - origin.x, y: point.y - origin.y, ...(node.parentId ? { parentId: node.parentId } : {}), origin: 'legacy' } };
    visiting.delete(node.id); visited.add(node.id); result.push(node);
  };
  for (const node of merged.values()) append(node);
  return result;
}

export function mergeStageContent(input: { base: CanvasBaselineContent; local: CanvasBaselineContent; incoming: CanvasBaselineContent; targetStage: StageSnapshot; baseStage?: StageSnapshot; localStage?: StageSnapshot; incomingStage?: StageSnapshot }): StageContentMerge {
  const { base, local, incoming, targetStage, baseStage, localStage, incomingStage } = input;
  const conflicts: StageConflict[] = [];
  const nodes = mergeNodes(base.nodes, local.nodes, incoming.nodes, conflicts);
  const oldPins = maps(retainLabelPins(base.labelPins ?? [], targetStage, nodes, baseStage), labelPinKey);
  const localPins = maps(retainLabelPins(local.labelPins ?? [], targetStage, nodes, localStage), labelPinKey);
  const incomingPins = maps(retainLabelPins(incoming.labelPins ?? [], targetStage, nodes, incomingStage), labelPinKey);
  const labelPins: EdgeLabelPin[] = [];
  for (const key of new Set([...oldPins.keys(), ...localPins.keys(), ...incomingPins.keys()])) {
    const old = oldPins.get(key), here = localPins.get(key), there = incomingPins.get(key);
    const withoutIdentity = (pin: EdgeLabelPin | undefined) => { if (!pin) return pin; const { memberFingerprints: _fingerprints, ...intent } = pin; return intent; };
    const selected = equal(withoutIdentity(here), withoutIdentity(old)) ? there : here;
    if (selected) labelPins.push(structuredClone(selected));
  }
  const retainedPins = retainLabelPins(labelPins, targetStage, nodes);
  const edgeRoutes = mergeEdgeRoutes(base.edgeRoutes, local.edgeRoutes, incoming.edgeRoutes, conflicts);
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
    if (!edge || !retained || !equal(routeIntent(route), routeIntent(retained)) || endpointFingerprint(edge) !== route.endpointFingerprint) conflicts.push(conflict(route.canonicalEdgeId, '上游变化影响了固定或锁定路径，请先处理路径冲突'));
  }
  if (conflicts.length) return { ok: false, conflicts };
  return { ok: true, content: { nodes, edgeRoutes, frozenGroups, ...(overlay ? { overlay: structuredClone(overlay) } : {}), ...((base.displayRoutes || local.displayRoutes || incoming.displayRoutes) ? { displayRoutes } : {}), ...(retainedPins.length ? { labelPins: retainedPins } : {}) } };
}
