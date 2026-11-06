/** Incremental orthogonal paths, invalidated by endpoint and obstacle geometry. */
import { routePolicyKey, type PortPolicy } from '../../../core/layout/port-policy.ts';
import type { Projection } from '../../../core/projection/index.ts';
import type { Point, Rect } from '../../../core/layout/geometry.ts';
import type { CanvasNode } from '../layout/node.ts';
import { createDiagramGeometry, routeIsLegal, routeDiagramGeometry, sharedFrozenGeometry, segmentBounds, segmentCrossesRect, type DiagramGeometry, type ReservedRoute } from './routing.ts';
import { SpatialIndex, expandBounds } from '../layout/spatial-index.ts';

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
  trunkId?: string;
  trunkSegment?: { from: Point; to: Point };
  text: string;
}

export interface RouteCacheStats {
  routedEdges: number;
  translatedEdges: number;
  durationMs: number;
  totalEdges: number;
  routingMs: number;
  geometryMs: number;
}

type IndexedPart = { edgeId: string; kind: 'segment'; from: Point; to: Point };
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
function withText(route: CachedRoute, text: string): CachedRoute {
  return route.text === text ? route : { ...route, text };
}
/** 每次更新保留未触碰的路径对象；选择和视口没有几何依赖。 */
export class DiagramRouteCache {
  private geometry: DiagramGeometry | undefined;
  private reservedKey = '';
  private policyKey = '';
  private inputs = new Map<string, RouteInput>();
  private routes = new Map<string, CachedRoute>();
  private parts = new SpatialIndex<IndexedPart>();
  private partKeys = new Map<string, string[]>();
  private adjacent = new Map<string, Set<string>>();
  lastStats: RouteCacheStats = { routedEdges: 0, translatedEdges: 0, durationMs: 0, totalEdges: 0, routingMs: 0, geometryMs: 0 };

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
    this.partKeys.set(id, keys);
  }

  update(nodes: readonly CanvasNode[], projection: Projection, edges: readonly RouteInput[], reserved: readonly ReservedRoute[] = [], retained: ReadonlyMap<string, CachedRoute> = new Map(), policy: PortPolicy = {}, seed?: ReadonlyMap<string, CachedRoute>): Map<string, CachedRoute> {
    const start = performance.now();
    const geometryStarted = performance.now();
    const geometry = createDiagramGeometry(nodes, projection, reserved);
    const geometryMs = performance.now() - geometryStarted;
    const reservedKey = JSON.stringify(reserved.map((route) => [route.edgeId, route.points, route.obstacle, route.frozenOwnerId]));
    const reservedChanged = reservedKey !== this.reservedKey;
    this.reservedKey = reservedKey;
    const policyKey = routePolicyKey(policy);
    const policyChanged = policyKey !== this.policyKey;
    this.policyKey = policyKey;
    const inputs = new Map(edges.map((edge) => [edge.id, edge]));
    const routeDirty = new Set<string>();
    const changed = new Set<string>();
    const stats: RouteCacheStats = { routedEdges: 0, translatedEdges: 0, durationMs: 0, totalEdges: edges.length, routingMs: 0, geometryMs };

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
          if (segmentCrossesRect(part.from, part.to, item.rect)) routeDirty.add(part.edgeId);
        }
      }
    }
    for (const edge of edges) {
      const old = this.inputs.get(edge.id);
      if (policyChanged || !old || old.source !== edge.source || old.target !== edge.target) {
        routeDirty.add(edge.id);
        topologyChanged = true;
      }

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
          if (segmentCrossesRect(part.from, part.to, obstacle.padded)) routeDirty.add(part.edgeId);
        }
      }
    }
    if (changed.size || reservedChanged) for (const [id, route] of this.routes) if (route.feasible === false && inputs.has(id)) routeDirty.add(id);


    const routingStarted = performance.now();
    const nextRoutes = new Map<string, CachedRoute>();

    const incoming = new Map(edges.flatMap((edge) => {
      const route = seed?.get(edge.id) ?? retained.get(edge.id);
      return route && route.feasible !== false && routeIsLegal(route, sharedFrozenGeometry(geometry, edge.id), edge.source, edge.target, edge.id)
        ? [[edge.id, route] as const] : [];
    }));
    const occupancy = new Map(edges.flatMap(edge => {
      const route = incoming.get(edge.id) ?? (!routeDirty.has(edge.id) ? this.routes.get(edge.id) : undefined);
      return route && route.feasible !== false ? [[edge.id, { ...route, id: edge.id, source: edge.source, target: edge.target }] as const] : [];
    }));
    for (const edge of edges) {
      const seeded = seed?.has(edge.id) ? incoming.get(edge.id) : undefined;
      const previous = seeded ?? this.routes.get(edge.id);
      const saved = seed ? undefined : incoming.get(edge.id);
      if (saved && (!previous || routeDirty.has(edge.id))) {
        nextRoutes.set(edge.id, withText(saved, edge.text));

        continue;
      }
      if (!routeDirty.has(edge.id)) {
        nextRoutes.set(edge.id, withText(previous!, edge.text));
        continue;
      }
      const old = this.inputs.get(edge.id) ?? inputs.get(edge.id);
      const a = this.geometry?.bounds.get(edge.source) ?? geometry.bounds.get(edge.source);
      const b = this.geometry?.bounds.get(edge.target) ?? geometry.bounds.get(edge.target);
      const source = geometry.bounds.get(edge.source)!, target = geometry.bounds.get(edge.target)!;
      if ((!policyChanged || seeded) && previous && previous.feasible !== false && old?.source === edge.source && old.target === edge.target && a && b
        && source.w === a.w && source.h === a.h && target.w === b.w && target.h === b.h
        && source.x - a.x === target.x - b.x && source.y - a.y === target.y - b.y) {
        const dx = source.x - a.x, dy = source.y - a.y;
        const points = previous.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
        if (routeIsLegal({ ...previous, points }, geometry, edge.source, edge.target, edge.id)) {
          nextRoutes.set(edge.id, { ...withText(previous, edge.text), points,
            ...(previous.trunkSegment ? { trunkSegment: { from: { x: previous.trunkSegment.from.x + dx, y: previous.trunkSegment.from.y + dy }, to: { x: previous.trunkSegment.to.x + dx, y: previous.trunkSegment.to.y + dy } } } : {}) });
          occupancy.set(edge.id, { ...previous, points, id: edge.id, source: edge.source, target: edge.target });

          if (dx || dy) stats.translatedEdges++;
          continue;
        }
      }
      const route = routeDiagramGeometry(geometry, edge.source, edge.target, edge.id, policy, [...occupancy.values()]);
      if (route.feasible) occupancy.set(edge.id, { ...route, text: edge.text, id: edge.id, source: edge.source, target: edge.target });
      nextRoutes.set(edge.id, { ...route, policyKey, text: edge.text });
      stats.routedEdges++;
    }

    stats.routingMs = performance.now() - routingStarted;
    for (const edge of edges) {
      const next = nextRoutes.get(edge.id)!;
      if (seed ? next !== this.routes.get(edge.id) : routeDirty.has(edge.id)) this.index(edge.id, next);
    }

    this.geometry = geometry;
    this.inputs = inputs;
    if (seed || routeDirty.size || inputs.size !== this.routes.size || edges.some((edge) => this.routes.get(edge.id)?.text !== edge.text)) this.routes = nextRoutes;
    stats.durationMs = performance.now() - start;
    this.lastStats = stats;
    return this.routes;
  }
}
