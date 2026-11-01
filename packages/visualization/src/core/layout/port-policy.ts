/** Port preferences and comparable route costs, independent of the renderer. */
export type RouteCostMetric = 'length' | 'bends' | 'overlap' | 'portCrowding' | 'direction';

export interface PortPolicy {
  direction?: 'auto' | 'top-down';
  /** Lexicographic priorities allow fixture-driven tuning without numerical weights. */
  priority?: readonly RouteCostMetric[];
}

export type RouteCost = Record<RouteCostMetric, number>;

export const DEFAULT_ROUTE_PRIORITY: readonly RouteCostMetric[] = ['direction', 'length', 'bends', 'portCrowding', 'overlap'];

export function routePolicyKey(policy: PortPolicy = {}): string {
  return JSON.stringify(['port-candidates-v1', policy.direction ?? 'auto', policy.priority ?? DEFAULT_ROUTE_PRIORITY]);
}

export function compareRouteCost(a: RouteCost, b: RouteCost, policy: PortPolicy): number {
  for (const metric of [...new Set([...(policy.priority ?? []), ...DEFAULT_ROUTE_PRIORITY])]) {
    if (a[metric] !== b[metric]) return a[metric] - b[metric];
  }
  return 0;
}
