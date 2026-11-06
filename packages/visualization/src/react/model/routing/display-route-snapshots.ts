/** Saved projection geometry seeds routing without assigning display IDs to canonical edges. */
import type { Projection } from '../../../core/projection/index.ts';
import { routePolicyKey, type PortPolicy } from '../../../core/layout/port-policy.ts';
import type { CanvasNode } from '../layout/node.ts';
import type { EdgeLabelPlacement } from '../contracts/label-types.ts';
import type { DisplayEdge } from './display-edges.ts';
import type { CachedRoute } from './route-cache.ts';
import type { DisplayRouteSnapshot } from '../contracts/snapshot-types.ts';
import { createDiagramGeometry, routeIsLegal, sharedFrozenGeometry, type ReservedRoute } from './routing.ts';

export function routeBarrierKey(reserved: readonly ReservedRoute[]): string {
  let hash = 2166136261;
  const text = JSON.stringify(reserved.map(route => [route.edgeId, route.points, route.obstacle, route.frozenOwnerId]));
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

export function captureDisplayRoutes(nodes: readonly CanvasNode[], projection: Projection, edges: readonly DisplayEdge[], routes: ReadonlyMap<string, CachedRoute>, reserved: readonly ReservedRoute[] = [], policy: PortPolicy = {}, labelFor?: (id: string) => EdgeLabelPlacement | undefined): DisplayRouteSnapshot[] {
  const geometry = createDiagramGeometry(nodes, projection);
  const barrierKey = routeBarrierKey(reserved);
  return edges.filter(edge => routes.get(edge.id)!.feasible !== false).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target,
    memberIds: edge.members.map((member) => member.canonicalEdgeId),
    ...(({ sourceHandle, targetHandle, points, text }) => structuredClone({ sourceHandle, targetHandle, points, text }))(routes.get(edge.id)!),
    label: { ...(labelFor?.(edge.id) ?? { x: 0, y: 0, width: 0, height: 0 }) },
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
    // 共享的冻结片段可以重合；外部的锁定线段仍是硬障碍。
    const current = route.barrierKey === barrierKey ? sharedFrozenGeometry(geometry, edge.id) : geometry;
    if (!routeIsLegal(route, current, edge.source, edge.target, edge.id)) continue;
    result.set(edge.id, { policyKey: route.policyKey, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle, points: route.points, text: route.text });
  }
  return result;
}
