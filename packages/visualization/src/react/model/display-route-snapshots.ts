/** Saved projection geometry seeds routing without assigning display IDs to canonical edges. */
import type { Projection } from '../../core/projection/index.ts';
import type { CanvasNode } from './grouping.ts';
import type { DisplayEdge } from './display-edges.ts';
import type { CachedRoute } from './route-cache.ts';
import type { DisplayRouteSnapshot } from './workspace.ts';
import { createDiagramGeometry, pathIsClear, type ReservedRoute } from './routing.ts';

export function captureDisplayRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], routes: ReadonlyMap<string, CachedRoute>): DisplayRouteSnapshot[] {
  const geometry = createDiagramGeometry(nodes, projection);
  return edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target,
    memberIds: edge.members.map((member) => member.canonicalEdgeId),
    ...structuredClone(routes.get(edge.id)!),
    sourceBounds: { ...geometry.bounds.get(edge.source)! }, targetBounds: { ...geometry.bounds.get(edge.target)! },
  }));
}

export function retainedDisplayRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], snapshots: readonly DisplayRouteSnapshot[] = [], reserved: readonly ReservedRoute[] = []): Map<string, CachedRoute> {
  const geometry = createDiagramGeometry(nodes, projection, reserved);
  const stored = new Map(snapshots.map((route) => [route.id, route]));
  const result = new Map<string, CachedRoute>();
  const sameBounds = (a: DisplayRouteSnapshot['sourceBounds'], b: DisplayRouteSnapshot['sourceBounds']) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  for (const edge of edges) {
    const route = stored.get(edge.id);
    if (!route || route.source !== edge.source || route.target !== edge.target) continue;
    if (!sameBounds(route.sourceBounds, geometry.bounds.get(edge.source)!) || !sameBounds(route.targetBounds, geometry.bounds.get(edge.target)!)) continue;
    if (!pathIsClear(route.points, geometry, edge.source, edge.target, edge.id)) continue;
    result.set(edge.id, { sourceHandle: route.sourceHandle, targetHandle: route.targetHandle, points: route.points, label: route.label, text: route.text });
  }
  return result;
}
