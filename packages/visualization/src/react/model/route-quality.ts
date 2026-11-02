/** Unified group quality: path composition, port pressure, channels and labels. */
import { rectIntersects, type Point, type PortSide } from '../../core/layout/geometry.ts';
import type { PortSlot } from '../../core/layout/node-port-allocator.ts';

export interface QualityLabel {
  x: number;
  y: number;
  width: number;
  height: number;
  score?: number;
  segmentKind?: 'branch' | 'trunk';
  distanceToTarget?: number;
}

export interface QualityRoute {
  edgeId: string;
  points: readonly Point[];
  sourceSlot?: PortSlot;
  targetSlot?: PortSlot;
  trunkId?: string;
  trunkSegment?: { from: Point; to: Point };
  label?: QualityLabel;
  labelRequired?: boolean;
  labelState?: 'normal' | 'adjusted' | 'space-exhausted';
}

export interface RouteQualityMetrics {
  length: number;
  bends: number;
  crossings: number;
  intentionalTrunkLength: number;
  unintendedOverlap: number;
  portCrowding: number;
  channelStability: number;
  labelScore: number;
  labelOverlaps: number;
  labelHidden: number;
  labelOwnerMisses: number;
}

export interface QualityWeights {
  length: number;
  bends: number;
  crossings: number;
  overlap: number;
  port: number;
  channel: number;
  label: number;
  hidden: number;
  owner: number;
}

export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  length: 1, bends: 8, crossings: 30, overlap: 2, port: 4, channel: 2, label: 1, hidden: 40, owner: 20,
};

const key = (slot: PortSlot): string => `${slot.nodeId}::${slot.physicalId}`;
const distance = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function crossings(a: readonly Point[], b: readonly Point[]): number {
  let count = 0;
  for (let i = 1; i < a.length; i += 1) for (let j = 1; j < b.length; j += 1) {
    const p = a[i - 1]!, q = a[i]!, r = b[j - 1]!, s = b[j]!;
    const horizontal = p.y === q.y, other = r.y === s.y;
    if (horizontal === other) continue;
    const [h0, h1] = horizontal ? [p, q] : [r, s];
    const [v0, v1] = horizontal ? [r, s] : [p, q];
    const minX = Math.min(h0.x, h1.x), maxX = Math.max(h0.x, h1.x);
    const minY = Math.min(v0.y, v1.y), maxY = Math.max(v0.y, v1.y);
    if (v0.x > minX && v0.x < maxX && h0.y > minY && h0.y < maxY) count += 1;
  }
  return count;
}

function overlap(a: readonly Point[], b: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < a.length; i += 1) for (let j = 1; j < b.length; j += 1) {
    const p = a[i - 1]!, q = a[i]!, r = b[j - 1]!, s = b[j]!;
    if (p.y === q.y && r.y === s.y && p.y === r.y) total += Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)));
    if (p.x === q.x && r.x === s.x && p.x === r.x) total += Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)));
  }
  return total;
}

function bends(points: readonly Point[]): number {
  let count = 0;
  let previous: number | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!, to = points[index]!;
    if (from.x === to.x && from.y === to.y) continue;
    const axis = from.y === to.y ? 0 : 1;
    if (previous !== undefined && axis !== previous) count += 1;
    previous = axis;
  }
  return count;
}

function distanceToPath(point: Point, points: readonly Point[]): number {
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!, to = points[index]!;
    const horizontal = from.y === to.y;
    const x = Math.max(Math.min(from.x, to.x), Math.min(Math.max(from.x, to.x), point.x));
    const y = Math.max(Math.min(from.y, to.y), Math.min(Math.max(from.y, to.y), point.y));
    best = Math.min(best, horizontal ? Math.abs(point.y - from.y) + Math.abs(point.x - x) : Math.abs(point.x - from.x) + Math.abs(point.y - y));
  }
  return best;
}

export function measureRoutes(routes: readonly QualityRoute[]): RouteQualityMetrics {
  const metrics: RouteQualityMetrics = {
    length: 0, bends: 0, crossings: 0, intentionalTrunkLength: 0, unintendedOverlap: 0, portCrowding: 0, channelStability: 0,
    labelScore: 0, labelOverlaps: 0, labelHidden: 0, labelOwnerMisses: 0,
  };
  for (const route of routes) {
    metrics.length += route.points.slice(1).reduce((sum, point, index) => sum + distance(route.points[index]!, point), 0);
    metrics.bends += bends(route.points);
    if (route.labelRequired !== false && (route.labelState === 'space-exhausted' || !route.label)) metrics.labelHidden += 1;
    if (route.label) {
      metrics.labelScore += route.label.score ?? (route.label.segmentKind === 'trunk' ? 30 : 0) + (route.label.distanceToTarget ?? 0) * 0.25;
      if (distanceToPath({ x: route.label.x, y: route.label.y }, route.points) > 24) metrics.labelOwnerMisses += 1;
    }
  }
  for (let i = 0; i < routes.length; i += 1) for (let j = i + 1; j < routes.length; j += 1) {
    const a = routes[i]!, b = routes[j]!;
    const sharedTrunk = a.trunkId && a.trunkId === b.trunkId;
    metrics.crossings += crossings(a.points, b.points);
    const totalOverlap = overlap(a.points, b.points);
    const trunkOverlap = sharedTrunk && a.trunkSegment && b.trunkSegment
      ? overlap([a.trunkSegment.from, a.trunkSegment.to], [b.trunkSegment.from, b.trunkSegment.to])
      : 0;
    metrics.intentionalTrunkLength += trunkOverlap;
    metrics.unintendedOverlap += Math.max(0, totalOverlap - trunkOverlap);
    if ((a.sourceSlot && b.sourceSlot && key(a.sourceSlot) === key(b.sourceSlot))
      || (a.sourceSlot && b.targetSlot && key(a.sourceSlot) === key(b.targetSlot))
      || (a.targetSlot && b.sourceSlot && key(a.targetSlot) === key(b.sourceSlot))
      || (a.targetSlot && b.targetSlot && key(a.targetSlot) === key(b.targetSlot))) metrics.portCrowding += sharedTrunk ? 0 : 1;
    if (a.label && b.label && rectIntersects(
      { x: a.label.x - a.label.width / 2, y: a.label.y - a.label.height / 2, w: a.label.width, h: a.label.height },
      { x: b.label.x - b.label.width / 2, y: b.label.y - b.label.height / 2, w: b.label.width, h: b.label.height },
    )) metrics.labelOverlaps += 1;
  }
  const channels = new Map<string, QualityRoute[]>();
  for (const route of routes) {
    if (!route.sourceSlot || !route.targetSlot) continue;
    const channel = `${route.sourceSlot.nodeId}:${route.sourceSlot.side}`;
    channels.set(channel, [...(channels.get(channel) ?? []), route]);
  }
  for (const list of channels.values()) {
    const side = list[0]!.sourceSlot!.side;
    const axis = side === 'top' || side === 'bottom' ? 'x' : 'y';
    const targetProjection = (route: QualityRoute): number => {
      const end = route.points.at(-1);
      return end ? (axis === 'x' ? end.x : end.y) : 0;
    };
    const ordered = [...list].sort((a, b) => targetProjection(a) - targetProjection(b) || a.sourceSlot!.fraction - b.sourceSlot!.fraction);
    for (let i = 0; i < ordered.length; i += 1) for (let j = i + 1; j < ordered.length; j += 1) {
      if (ordered[i]!.sourceSlot!.fraction > ordered[j]!.sourceSlot!.fraction) metrics.channelStability += 1;
    }
  }
  return metrics;
}

export function scoreRoutes(
  routes: readonly QualityRoute[],
  options: {
    preferred?: ReadonlyMap<string, { source: PortSide; target: PortSide }>;
    weights?: Partial<QualityWeights>;
    hiddenPenalty?: number;
  } = {},
): { metrics: RouteQualityMetrics; score: number } {
  const weights = { ...DEFAULT_QUALITY_WEIGHTS, ...options.weights };
  const metrics = measureRoutes(routes);
  let score = metrics.length * weights.length + metrics.bends * weights.bends + metrics.crossings * weights.crossings
    + metrics.unintendedOverlap * weights.overlap + metrics.portCrowding * weights.port + metrics.channelStability * weights.channel
    + metrics.labelScore * weights.label + metrics.labelOverlaps * 10
    + (options.hiddenPenalty ?? weights.hidden) * metrics.labelHidden + metrics.labelOwnerMisses * weights.owner;
  for (const route of routes) {
    const sides = options.preferred?.get(route.edgeId);
    if (!sides) continue;
    if (route.sourceSlot && route.sourceSlot.side !== sides.source) score += 10;
    if (route.targetSlot && route.targetSlot.side !== sides.target) score += 10;
  }
  return { metrics, score };
}
