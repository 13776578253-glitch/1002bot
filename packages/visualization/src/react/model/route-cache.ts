/** Incremental orthogonal paths and labels, invalidated by endpoint and obstacle geometry. */
import { routePolicyKey, type PortPolicy } from '../../core/layout/port-policy.ts';
import type { Projection } from '../../core/projection/index.ts';
import type { Point, Rect } from '../../core/layout/geometry.ts';
import type { CanvasNode } from './grouping.ts';
import { placeEdgeLabel, type EdgeLabelPlacement } from './labels.ts';
import { createDiagramGeometry, pathIsClear, routeDiagramGeometry, segmentBounds, segmentCrossesRect, type DiagramGeometry, type ReservedRoute } from './routing.ts';
import { SpatialIndex, expandBounds } from './spatial-index.ts';

export interface RouteInput {
  id: string;
  source: string;
  target: string;
  text: string;
}

export interface CachedRoute {
  feasible?: boolean;
  policyKey?: string;
  sourceHandle: string;
  targetHandle: string;
  points: Point[];
  label: EdgeLabelPlacement;
  labelFallback?: EdgeLabelPlacement | undefined;
  labelState?: 'normal' | 'adjusted' | 'space-exhausted';
  text: string;
}

export interface RouteCacheStats {
  routedEdges: number;
  placedLabels: number;
  translatedEdges: number;
  durationMs: number;
  totalEdges: number;
  routingMs: number;
  labelMs: number;
  geometryMs: number;
}

type IndexedPart = { edgeId: string; kind: 'segment'; from: Point; to: Point } | { edgeId: string; kind: 'label' };
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const labelRect = (label: EdgeLabelPlacement): Rect => ({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.000001 && a.x + a.w > b.x + 0.000001 && a.y < b.y + b.h - 0.000001 && a.y + a.h > b.y + 0.000001;
const inside = (a: Rect, b: Rect) => b.x >= a.x - 0.000001 && b.y >= a.y - 0.000001 && b.x + b.w <= a.x + a.w + 0.000001 && b.y + b.h <= a.y + a.h + 0.000001;

function labelIsClear(label: EdgeLabelPlacement, geometry: DiagramGeometry, occupied: readonly Rect[], end: Point, edgeId?: string): boolean {
  const rect = labelRect(label);
  return ![...geometry.blockers, ...geometry.reserved.filter((entry) => entry.edgeId !== edgeId).map((entry) => entry.rect), ...occupied, { x: end.x - 8, y: end.y - 8, w: 16, h: 16 }].some((other) => intersects(rect, expandBounds(other, 8)))
    && geometry.frames.every((frame) => inside(expandBounds(frame, -8), rect) || !intersects(expandBounds(frame, 8), rect));
}

/** Retained capsules must still fit a straight segment with the same bend clearance as placement. */
function labelFitsPath(label: EdgeLabelPlacement, points: readonly Point[]): boolean {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!;
    const horizontal = from.y === to.y;
    const start = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
    const end = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
    const along = horizontal ? label.x : label.y;
    const halfAlong = (horizontal ? label.width : label.height) / 2;
    const across = Math.abs(horizontal ? label.y - from.y : label.x - from.x);
    const halfAcross = (horizontal ? label.height : label.width) / 2;
    if (along >= start + halfAlong + 12 && along <= end - halfAlong - 12 && across <= halfAcross + 4) return true;
  }
  return false;
}

/** Carry a capsule with its nearest segment while preserving the established relative offset. */
function transportLabel(previous: CachedRoute, points: readonly Point[]): EdgeLabelPlacement | undefined {
  if (previous.points.length !== points.length) return undefined;
  let nearest: { distance: number; from: Point; to: Point } | undefined;
  for (let index = 1; index < points.length; index++) {
    const from = previous.points[index - 1]!, to = previous.points[index]!;
    const nextFrom = points[index - 1]!, nextTo = points[index]!;
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.sign(dx) !== Math.sign(nextTo.x - nextFrom.x) || Math.sign(dy) !== Math.sign(nextTo.y - nextFrom.y)) return undefined;
    const fraction = Math.max(0, Math.min(1, ((previous.label.x - from.x) * dx + (previous.label.y - from.y) * dy) / (dx * dx + dy * dy)));
    const anchor = { x: from.x + dx * fraction, y: from.y + dy * fraction };
    const distance = (previous.label.x - anchor.x) ** 2 + (previous.label.y - anchor.y) ** 2;
    if (!nearest || distance < nearest.distance) nearest = { distance, from: anchor, to: { x: nextFrom.x + (nextTo.x - nextFrom.x) * fraction, y: nextFrom.y + (nextTo.y - nextFrom.y) * fraction } };
  }
  const candidate = { ...previous.label, x: previous.label.x + nearest!.to.x - nearest!.from.x, y: previous.label.y + nearest!.to.y - nearest!.from.y };
  return labelFitsPath(previous.label, previous.points) && !labelFitsPath(candidate, points) ? undefined : candidate;
}

/** Each update preserves untouched route objects; selection and viewport have no geometric dependencies. */
export class DiagramRouteCache {
  private geometry: DiagramGeometry | undefined;
  private reservedKey = '';
  private policyKey = '';
  private inputs = new Map<string, RouteInput>();
  private routes = new Map<string, CachedRoute>();
  private parts = new SpatialIndex<IndexedPart>();
  private partKeys = new Map<string, string[]>();
  private adjacent = new Map<string, Set<string>>();
  lastStats: RouteCacheStats = { routedEdges: 0, placedLabels: 0, translatedEdges: 0, durationMs: 0, totalEdges: 0, routingMs: 0, labelMs: 0, geometryMs: 0 };

  private unindex(id: string): void {
    for (const key of this.partKeys.get(id) ?? []) this.parts.delete(key);
    this.partKeys.delete(id);
  }

  private index(id: string, route: CachedRoute): void {
    this.unindex(id);
    if (route.feasible === false) return;
    const keys: string[] = [];
    for (let index = 1; index < route.points.length; index++) {
      const from = route.points[index - 1]!, to = route.points[index]!;
      const key = JSON.stringify([id, index]);
      keys.push(key);
      this.parts.set(key, segmentBounds(from, to), { edgeId: id, kind: 'segment', from, to });
    }
    const key = JSON.stringify([id, 'label']);
    keys.push(key);
    this.parts.set(key, labelRect(route.label), { edgeId: id, kind: 'label' });
    this.partKeys.set(id, keys);
  }

  update(nodes: readonly CanvasNode[], projection: Projection, edges: readonly RouteInput[], reserved: readonly ReservedRoute[] = [], retained: ReadonlyMap<string, CachedRoute> = new Map(), policy: PortPolicy = {}): Map<string, CachedRoute> {
    const start = performance.now();
    const geometryStarted = performance.now();
    const geometry = createDiagramGeometry(nodes, projection, reserved);
    const geometryMs = performance.now() - geometryStarted;
    const reservedKey = JSON.stringify(reserved.map((route) => [route.edgeId, route.points.map((point) => [point.x, point.y])]));
    const reservedChanged = reservedKey !== this.reservedKey;
    this.reservedKey = reservedKey;
    const policyKey = routePolicyKey(policy);
    const policyChanged = policyKey !== this.policyKey;
    this.policyKey = policyKey;
    const inputs = new Map(edges.map((edge) => [edge.id, edge]));
    const routeDirty = new Set<string>(), labelDirty = new Set<string>();
    const changed = new Set<string>();
    const stats: RouteCacheStats = { routedEdges: 0, placedLabels: 0, translatedEdges: 0, durationMs: 0, totalEdges: edges.length, routingMs: 0, labelMs: 0, geometryMs };

    for (const [id, obstacle] of geometry.obstacles) {
      const old = this.geometry?.obstacles.get(id);
      if (!old || !sameRect(old.padded, obstacle.padded) || !sameRect(this.geometry!.bounds.get(id)!, geometry.bounds.get(id)!)) changed.add(id);
    }
    for (const id of this.geometry?.obstacles.keys() ?? []) if (!geometry.obstacles.has(id)) changed.add(id);

    let topologyChanged = inputs.size !== this.inputs.size;
    if (reservedChanged) {
      const key = (item: { edgeId: string; rect: Rect }) => JSON.stringify([item.edgeId, item.rect.x, item.rect.y, item.rect.w, item.rect.h]);
      const old = this.geometry?.reserved ?? [];
      const oldKeys = new Set(old.map(key)), nextKeys = new Set(geometry.reserved.map(key));
      for (const item of [...old.filter((entry) => !nextKeys.has(key(entry))), ...geometry.reserved.filter((entry) => !oldKeys.has(key(entry)))]) {
        for (const part of this.parts.query(expandBounds(item.rect, 8))) {
          if (!inputs.has(part.edgeId) || part.edgeId === item.edgeId) continue;
          if (part.kind === 'label') labelDirty.add(part.edgeId);
          else if (segmentCrossesRect(part.from, part.to, item.rect)) routeDirty.add(part.edgeId);
        }
      }
    }
    for (const edge of edges) {
      const old = this.inputs.get(edge.id);
      if (policyChanged || !old || old.source !== edge.source || old.target !== edge.target) {
        routeDirty.add(edge.id);
        topologyChanged = true;
      }
      if (!old || old.text !== edge.text) labelDirty.add(edge.id);
    }
    if (topologyChanged) {
      this.adjacent.clear();
      for (const edge of edges) for (const id of [edge.source, edge.target]) {
        let ids = this.adjacent.get(id);
        if (!ids) this.adjacent.set(id, ids = new Set());
        ids.add(edge.id);
      }
    }
    for (const id of this.routes.keys()) if (!inputs.has(id)) this.unindex(id);

    for (const id of changed) {
      for (const edgeId of this.adjacent.get(id) ?? []) routeDirty.add(edgeId);
      const old = this.geometry?.obstacles.get(id), next = geometry.obstacles.get(id);
      for (const obstacle of [old, next]) {
        if (!obstacle) continue;
        for (const part of this.parts.query(expandBounds(obstacle.padded, 8))) {
          if (!inputs.has(part.edgeId)) continue;
          if (part.kind === 'label') labelDirty.add(part.edgeId);
          else if (segmentCrossesRect(part.from, part.to, obstacle.padded)) routeDirty.add(part.edgeId);
        }
      }
      // Container size changes affect capsules at its boundary, not every path inside the frame.
      for (const state of [this.geometry, geometry]) {
        if (!state || state.obstacles.get(id)?.card !== false) continue;
        const bounds = state.bounds.get(id)!;
        for (const part of this.parts.query(expandBounds(bounds, 8))) if (part.kind === 'label' && inputs.has(part.edgeId)) {
          const route = this.routes.get(part.edgeId)!;
          if (!labelIsClear(route.label, geometry, [], route.points.at(-1)!, part.edgeId)) labelDirty.add(part.edgeId);
        }
      }
    }
    if (changed.size || reservedChanged) for (const [id, route] of this.routes) if (route.feasible === false && inputs.has(id)) routeDirty.add(id);
    for (const id of routeDirty) labelDirty.add(id);

    const routingStarted = performance.now();
    const nextRoutes = new Map<string, CachedRoute>();
    const translated = new Set<string>();
    const occupancy = new Map(edges.flatMap(edge => {
      const route = retained.get(edge.id) ?? (!routeDirty.has(edge.id) ? this.routes.get(edge.id) : undefined);
      return route && route.feasible !== false ? [[edge.id, { ...route, id: edge.id, source: edge.source, target: edge.target }] as const] : [];
    }));
    for (const edge of edges) {
      const previous = this.routes.get(edge.id);
      const saved = retained.get(edge.id);
      if (saved && (!previous || routeDirty.has(edge.id))) {
        nextRoutes.set(edge.id, saved);
        if (saved.text === edge.text) labelDirty.delete(edge.id);
        continue;
      }
      if (!routeDirty.has(edge.id)) {
        nextRoutes.set(edge.id, previous!);
        continue;
      }
      const old = this.inputs.get(edge.id);
      const a = this.geometry?.bounds.get(edge.source), b = this.geometry?.bounds.get(edge.target);
      const source = geometry.bounds.get(edge.source)!, target = geometry.bounds.get(edge.target)!;
      if (!policyChanged && previous && previous.feasible !== false && old?.source === edge.source && old.target === edge.target && a && b
        && source.w === a.w && source.h === a.h && target.w === b.w && target.h === b.h
        && source.x - a.x === target.x - b.x && source.y - a.y === target.y - b.y) {
        const dx = source.x - a.x, dy = source.y - a.y;
        const points = previous.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
        if (pathIsClear(points, geometry, edge.source, edge.target, edge.id)) {
          nextRoutes.set(edge.id, { ...previous, points, label: { ...previous.label, x: previous.label.x + dx, y: previous.label.y + dy }, text: edge.text });
          occupancy.set(edge.id, { ...previous, points, id: edge.id, source: edge.source, target: edge.target });
          translated.add(edge.id);
          if (dx || dy) stats.translatedEdges++;
          continue;
        }
      }
      const route = routeDiagramGeometry(geometry, edge.source, edge.target, edge.id, policy, [...occupancy.values()]);
      if (route.feasible) occupancy.set(edge.id, { ...route, label: previous?.label ?? { x: 0, y: 0, width: 0, height: 0 }, text: edge.text, id: edge.id, source: edge.source, target: edge.target });
      nextRoutes.set(edge.id, { ...route, policyKey, label: previous?.label ?? { x: 0, y: 0, width: 0, height: 0 }, text: edge.text });
      stats.routedEdges++;
    }

    stats.routingMs = performance.now() - routingStarted;
    const labelStarted = performance.now();
    const occupied: Rect[] = [];
    for (const [id, route] of nextRoutes) if (!labelDirty.has(id) && route.feasible !== false) occupied.push(labelRect(route.label));
    for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!labelDirty.has(edge.id)) continue;
      const route = nextRoutes.get(edge.id)!;
      if (route.feasible === false) continue;
      const previous = this.routes.get(edge.id);
      const candidate = translated.has(edge.id) ? route.label : previous ? transportLabel(previous, route.points) : undefined;
      if (candidate && edge.text === this.inputs.get(edge.id)?.text && labelIsClear(candidate, geometry, occupied, route.points.at(-1)!, edge.id)) {
        if (candidate !== route.label) nextRoutes.set(edge.id, { ...route, label: candidate });
      } else {
        const label = placeEdgeLabel(route.points, edge.text, [...geometry.blockers, ...geometry.reserved.filter((item) => item.edgeId !== edge.id).map((item) => item.rect)], geometry.frames, occupied);
        nextRoutes.set(edge.id, { ...route, label, text: edge.text });
        stats.placedLabels++;
      }
      occupied.push(labelRect(nextRoutes.get(edge.id)!.label));
    }
    stats.labelMs = performance.now() - labelStarted;
    for (const edge of edges) if (routeDirty.has(edge.id) || labelDirty.has(edge.id)) this.index(edge.id, nextRoutes.get(edge.id)!);

    this.geometry = geometry;
    this.inputs = inputs;
    if (routeDirty.size || labelDirty.size || inputs.size !== this.routes.size) this.routes = nextRoutes;
    stats.durationMs = performance.now() - start;
    this.lastStats = stats;
    return this.routes;
  }
}
