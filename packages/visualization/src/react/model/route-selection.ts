/** Route engine selection; group routes replace legacy only when every expected edge is legal. */
import type { CachedRoute } from './route-cache.ts';
import type { GroupSolveOutcome } from './route-groups.ts';

export interface CanvasRouteSelection {
  routes: Map<string, CachedRoute>;
  engine: 'legacy' | 'group';
}

export function selectCanvasRoutes(legacy: Map<string, CachedRoute>, group: GroupSolveOutcome | undefined, expected: readonly string[]): CanvasRouteSelection {
  if (group?.ok && expected.every((id) => group.routes.has(id))) return { routes: group.routes, engine: 'group' };
  return { routes: legacy, engine: 'legacy' };
}
