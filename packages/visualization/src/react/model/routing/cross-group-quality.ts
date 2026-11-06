/** Cross-group crossing hotspots; local review can target the highest contributors. */
import { crossingsBetween, type QualityRoute } from './route-quality.ts';

export interface CrossingPair {
  a: string;
  b: string;
  groupA?: string;
  groupB?: string;
  count: number;
}

export interface CrossingHotspots {
  total: number;
  pairs: CrossingPair[];
  byEdge: Array<{ edgeId: string; count: number }>;
  byGroup: Array<{ groupId: string; count: number }>;
}

export function crossGroupCrossingHotspots(
  routes: readonly QualityRoute[],
  groupByEdge: ReadonlyMap<string, string>,
  limit = 8,
): CrossingHotspots {
  const pairs: CrossingPair[] = [];
  const byEdge = new Map<string, number>();
  const byGroup = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < routes.length; i += 1) for (let j = i + 1; j < routes.length; j += 1) {
    const a = routes[i]!, b = routes[j]!;
    const count = crossingsBetween(a.points, b.points);
    if (!count) continue;
    total += count;
    byEdge.set(a.edgeId, (byEdge.get(a.edgeId) ?? 0) + count);
    byEdge.set(b.edgeId, (byEdge.get(b.edgeId) ?? 0) + count);
    const groupA = groupByEdge.get(a.edgeId), groupB = groupByEdge.get(b.edgeId);
    if (groupA) byGroup.set(groupA, (byGroup.get(groupA) ?? 0) + count);
    if (groupB) byGroup.set(groupB, (byGroup.get(groupB) ?? 0) + count);
    pairs.push({ a: a.edgeId, b: b.edgeId, ...(groupA ? { groupA } : {}), ...(groupB ? { groupB } : {}), count });
  }
  const order = (value: { count: number }): number => value.count;
  return {
    total,
    pairs: pairs.sort((a, b) => order(b) - order(a) || a.a.localeCompare(b.a) || a.b.localeCompare(b.b)).slice(0, limit),
    byEdge: [...byEdge].map(([edgeId, count]) => ({ edgeId, count })).sort((a, b) => order(b) - order(a) || a.edgeId.localeCompare(b.edgeId)).slice(0, limit),
    byGroup: [...byGroup].map(([groupId, count]) => ({ groupId, count })).sort((a, b) => order(b) - order(a) || a.groupId.localeCompare(b.groupId)).slice(0, limit),
  };
}
