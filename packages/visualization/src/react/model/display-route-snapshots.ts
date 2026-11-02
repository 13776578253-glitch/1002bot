/** Saved projection geometry seeds routing without assigning display IDs to canonical edges. */
import type { Projection } from '../../core/projection/index.ts';
import { routePolicyKey, type PortPolicy } from '../../core/layout/port-policy.ts';
import type { CanvasNode } from './grouping.ts';
import type { DisplayEdge } from './display-edges.ts';
import type { CachedRoute } from './route-cache.ts';
import type { DisplayRouteSnapshot } from './workspace.ts';
import { createDiagramGeometry, pathIsClear, withReservedRoutes, type ReservedRoute } from './routing.ts';

export function routeBarrierKey(reserved: readonly ReservedRoute[]): string {
  let hash = 2166136261;
  const text = JSON.stringify(reserved.map(route => [route.edgeId, route.points, route.obstacle]));
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

export function captureDisplayRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], routes: ReadonlyMap<string, CachedRoute>, reserved: readonly ReservedRoute[] = [], policy: PortPolicy = {}): DisplayRouteSnapshot[] {
  const geometry = createDiagramGeometry(nodes, projection);
  const barrierKey = routeBarrierKey(reserved);
  return edges.filter(edge => routes.get(edge.id)!.feasible !== false).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target,
    memberIds: edge.members.map((member) => member.canonicalEdgeId),
    ...(({ sourceHandle, targetHandle, points, label, text }) => structuredClone({ sourceHandle, targetHandle, points, label, text }))(routes.get(edge.id)!),
    policyKey: routePolicyKey(policy),
    sourceBounds: { ...geometry.bounds.get(edge.source)! }, targetBounds: { ...geometry.bounds.get(edge.target)! },
    barrierKey,
  }));
}

export function retainedDisplayRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], snapshots: readonly DisplayRouteSnapshot[] = [], reserved: readonly ReservedRoute[] = [], policy: PortPolicy = {}): Map<string, CachedRoute> {
  const geometry = createDiagramGeometry(nodes, projection, reserved);
  const barrierKey = routeBarrierKey(reserved);
  const stored = new Map(snapshots.map((route) => [route.id, route]));
  const result = new Map<string, CachedRoute>();
  const sameBounds = (a: DisplayRouteSnapshot['sourceBounds'], b: DisplayRouteSnapshot['sourceBounds']) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  for (const edge of edges) {
    const route = stored.get(edge.id);
    if (!route || route.policyKey !== routePolicyKey(policy) || route.source !== edge.source || route.target !== edge.target) continue;
    if (!sameBounds(route.sourceBounds, geometry.bounds.get(edge.source)!) || !sameBounds(route.targetBounds, geometry.bounds.get(edge.target)!)) continue;
    // Shared frozen fragments may coincide; external locked segments remain hard obstacles.
    const protectedParts = route.barrierKey === barrierKey ? geometry.reserved.filter(part => part.edgeId === edge.id) : [];
    const obstacles = protectedParts.length ? geometry.reserved.filter(part => !protectedParts.some(own =>
      part.rect.x >= own.rect.x && part.rect.y >= own.rect.y
      && part.rect.x + part.rect.w <= own.rect.x + own.rect.w && part.rect.y + part.rect.h <= own.rect.y + own.rect.h)) : geometry.reserved;
    if (!pathIsClear(route.points, withReservedRoutes(geometry, obstacles), edge.source, edge.target, edge.id)) continue;
    result.set(edge.id, { policyKey: route.policyKey, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle, points: route.points, label: route.label, text: route.text });
  }
  return result;
}
