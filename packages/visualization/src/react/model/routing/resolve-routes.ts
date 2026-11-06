/** Resolves one scene's routes with caller-owned engines and current protection geometry. */
import type { PortPolicy } from '../../../core/layout/port-policy.ts';
import type { Projection } from '../../../core/projection/index.ts';
import type { CanvasNode } from '../layout/node.ts';
import type { DisplayRouteSnapshot, EdgeRouteSnapshot, FrozenGroupSnapshot } from '../contracts/snapshot-types.ts';
import type { DisplayEdge } from './display-edges.ts';
import { retainedDisplayRoutes } from './display-route-snapshots.ts';
import { applyStoredRoutes, reservedLockedRoutes, retainedCanonicalRoutes } from './edge-routes.ts';
import type { GroupRouteCache } from './group-route-cache.ts';
import type { CachedRoute, DiagramRouteCache } from './route-cache.ts';
import { createDiagramGeometry, routeIsLegal, sharedFrozenGeometry } from './routing.ts';
import { routingFallback, type RoutingStatus } from './routing-status.ts';

interface RouteScene {
  nodes: readonly CanvasNode[];
  projection: Projection;
  edges: readonly DisplayEdge[];
  policy?: PortPolicy | undefined;
  stored?: readonly EdgeRouteSnapshot[];
  displaySnapshots?: readonly DisplayRouteSnapshot[] | undefined;
  frozen?: readonly FrozenGroupSnapshot[];
  readOnly?: boolean;
  seed?: ReadonlyMap<string, CachedRoute> | undefined;
}

export function resolveRoutes(scene: RouteScene, legacy: DiagramRouteCache, group?: GroupRouteCache) {
  const { nodes, projection, edges, policy, stored = [], displaySnapshots, frozen = [], readOnly, seed } = scene;
  const inputs = edges.map(({ id, source, target, text }) => ({ id, source, target, text }));
  const reserved = reservedLockedRoutes(stored, nodes, frozen);
  const geometry = createDiagramGeometry(nodes, projection, reserved);
  const failures = new Map<string, string>();
  let status: RoutingStatus = { requested: !!group, engine: 'legacy' };
  if (group) {
    const reason = readOnly ? 'preview' : stored.length ? 'protected-routes' : frozen.length ? 'frozen-groups'
      : edges.some((edge) => edge.aggregated) ? 'aggregated-edges' : undefined;
    if (reason) status.fallback = routingFallback(reason);
    else {
      try {
        const attempt = group.update({ nodes, projection, edges: inputs, ...(policy ? { policy } : {}) });
        status.cache = attempt.stats;
        const outcome = attempt.outcome;
        if (outcome?.ok && inputs.every((edge) => {
          const route = outcome.routes.get(edge.id);
          return route && route.feasible !== false && routeIsLegal(route, geometry, edge.source, edge.target, edge.id);
        })) {
          status = { ...status, engine: 'group' };
          return { routes: outcome.routes, reserved, failures, status, reusedPaths: 0, resolvedMs: 0 };
        }
        status.fallback = routingFallback(outcome?.ok ? 'incomplete' : 'error', outcome?.failures);
      } catch {
        status.fallback = routingFallback('error');
      }
    }
  }
  const display = retainedDisplayRoutes(nodes, projection, edges, displaySnapshots, reserved, policy);
  const retained = retainedCanonicalRoutes(nodes, projection, edges, stored, display, frozen);
  const automatic = legacy.update(nodes, projection, inputs, reserved, retained, policy, seed);
  const started = performance.now();
  let routes = applyStoredRoutes(automatic, edges, stored, nodes, projection, frozen, failures, retained, geometry);
  for (const edge of inputs) {
    const route = routes.get(edge.id);
    if (route?.feasible !== false && route && routeIsLegal(route, sharedFrozenGeometry(geometry, edge.id), edge.source, edge.target, edge.id)) continue;
    if (!failures.has(edge.id)) failures.set(edge.id, '连接无法满足当前端口或障碍约束');
    if (route && route.feasible !== false) {
      // 输出保护失败独立于增量缓存的上一次求解结果。
      if (routes === automatic) routes = new Map(routes);
      routes.set(edge.id, { ...route, points: [], feasible: false });
    }
  }
  return { routes, reserved, failures, status, reusedPaths: retained.size, resolvedMs: performance.now() - started };
}
