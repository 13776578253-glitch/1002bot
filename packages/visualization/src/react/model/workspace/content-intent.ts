/** Compares editable and protected snapshot content independently of derived display geometry. */
import type { CanvasBaselineContent, CanvasNodeView, EdgeRouteSnapshot, FrozenGroupSnapshot } from '../contracts/snapshot-types.ts';
import { legacyLayoutEdits } from '../layout/layout-intent.ts';

function withoutOrigin<T extends { origin: string }>(edit: T | undefined) {
  if (!edit) return undefined;
  const { origin: _origin, ...geometry } = edit;
  return geometry;
}

export function nodeIntent(node: CanvasNodeView, nodes: readonly CanvasNodeView[]) {
  const { id, type, parentId, data } = node;
  const expanded = !!data.expanded || type === 'cluster';
  const saved = data.layoutEdits;
  const natural = data.reflowOrigin ? { ...node, position: data.reflowOrigin } : node;
  const fallback = legacyLayoutEdits(expanded && data.contentWidth !== undefined && data.contentHeight !== undefined
    ? { ...natural, width: data.contentWidth, height: data.contentHeight } : natural, nodes);
  const position = saved?.position?.origin === 'user' ? saved.position : fallback.position;
  const collapsed = saved?.sizes?.collapsed?.origin === 'user' || expanded ? saved?.sizes?.collapsed : fallback.sizes?.collapsed;
  const expandedSize = saved?.sizes?.expanded?.origin === 'user' || !expanded ? saved?.sizes?.expanded : fallback.sizes?.expanded;
  return {
    id, type, parentId,
    title: data.title, expanded: !!data.expanded, layoutMode: data.layoutMode ?? 'free', frozen: !!data.frozen,
    groupOrigins: data.groupOrigins,
    position: withoutOrigin(position),
    collapsed: withoutOrigin(collapsed),
    expandedSize: withoutOrigin(expandedSize),
    ...(data.frozen ? { frozenSize: { width: node.width, height: node.height } } : {}),
  };
}

/** 保护锚点使用实际保存的位置，并去掉贴合计算产生的原点补偿。 */
export function protectedNodeAnchors(nodes: readonly CanvasNodeView[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const world = new Map<string, { x: number; y: number }>();
  function position(node: CanvasNodeView): { x: number; y: number } {
    const saved = world.get(node.id);
    if (saved) return saved;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const origin = parent ? position(parent) : { x: 0, y: 0 };
    const point = { x: origin.x + node.position.x, y: origin.y + node.position.y };
    world.set(node.id, point);
    return point;
  }
  return new Map(nodes.filter((node) => node.data.frozen || node.data.layoutMode === 'fixed' || node.data.layoutMode === 'locked').map((node) => {
    const { x, y } = position(node), offset = node.data.fitOffset;
    return [node.id, { x: x - (offset?.x ?? 0), y: y - (offset?.y ?? 0) }] as const;
  }));
}

export function routeIntent({ label: _label, policyKey: _policy, ...route }: EdgeRouteSnapshot) {
  return route;
}

export function hasRouteIntent(route: EdgeRouteSnapshot): boolean {
  return route.state !== 'auto' || !!route.frozenBoundaries?.length;
}

export function frozenIntent(group: FrozenGroupSnapshot) {
  return {
    ...group,
    worldBounds: { w: group.worldBounds.w, h: group.worldBounds.h },
    ...(group.previousRoutes ? { previousRoutes: group.previousRoutes.filter(hasRouteIntent).map(routeIntent) } : {}),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
}

export function sameCanvasIntent(a: CanvasBaselineContent, b: CanvasBaselineContent): boolean {
  return JSON.stringify(comparableCanvasIntent(a)) === JSON.stringify(comparableCanvasIntent(b));
}

function comparableCanvasIntent({ nodes, edgeRoutes, frozenGroups, overlay, labelPins }: CanvasBaselineContent): unknown {
  const anchors = protectedNodeAnchors(nodes);
  const nodeState = nodes.map((node) => ({ ...nodeIntent(node, nodes), anchor: anchors.get(node.id) })).sort((a, b) => a.id.localeCompare(b.id));
  const routes = edgeRoutes.filter(hasRouteIntent)
    .map(routeIntent).sort((a, b) => a.canonicalEdgeId.localeCompare(b.canonicalEdgeId));
  const frozen = frozenGroups.map(frozenIntent).sort((a, b) => a.id.localeCompare(b.id));
  const pins = (labelPins ?? []).map(({ memberFingerprints: _fingerprints, ...pin }) => ({ ...pin, memberIds: [...pin.memberIds].sort() }))
    .sort((a, b) => JSON.stringify([a.id, a.source, a.target, a.memberIds]).localeCompare(JSON.stringify([b.id, b.source, b.target, b.memberIds])));
  return canonical({ nodes: nodeState, edgeRoutes: routes, frozenGroups: frozen, overlay, labelPins: pins });
}
