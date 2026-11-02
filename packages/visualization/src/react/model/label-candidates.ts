/** Multiple label candidates per route; group selection decides the final one. */
import { rectIntersects, type Point, type Rect } from '../../core/layout/geometry.ts';
import { measureLabel } from './labels.ts';
import type { DiagramGeometry } from './routing.ts';

export interface LabelCandidate {
  state: 'normal' | 'adjusted';
  anchor: Point;
  rect: Rect;
  segmentIndex: number;
  segmentKind: 'branch' | 'trunk';
  distanceToTarget: number;
  score: number;
}

const CLEARANCE = 8;
const BEND_CLEARANCE = 12;

const expand = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 });
const inside = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x - 0.000001 && inner.y >= outer.y - 0.000001
  && inner.x + inner.w <= outer.x + outer.w + 0.000001 && inner.y + inner.h <= outer.y + outer.h + 0.000001;

function valid(rect: Rect, geometry: DiagramGeometry): boolean {
  if (geometry.blockers.some((blocker) => rectIntersects(rect, expand(blocker, CLEARANCE)))) return false;
  if (geometry.reserved.some((entry) => rectIntersects(rect, expand(entry.rect, CLEARANCE)))) return false;
  return geometry.frames.every((frame) => inside(expand(frame, -CLEARANCE), rect) || !rectIntersects(expand(frame, CLEARANCE), rect));
}

export function labelCandidatesForRoute(
  points: readonly Point[],
  text: string,
  geometry: DiagramGeometry,
  trunkSegments = 0,
  max = 6,
): LabelCandidate[] {
  const { width, height } = measureLabel(text);
  const output: LabelCandidate[] = [];
  let total = 0;
  const segments: { from: Point; to: Point; length: number; start: number; ux: number; uy: number }[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!, to = points[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) continue;
    segments.push({ from, to, length, start: total, ux: (to.x - from.x) / length, uy: (to.y - from.y) / length });
    total += length;
  }
  for (const [index, segment] of segments.entries()) {
    const alongHalf = (Math.abs(segment.ux) * width + Math.abs(segment.uy) * height) / 2;
    const acrossHalf = (Math.abs(segment.uy) * width + Math.abs(segment.ux) * height) / 2;
    const low = alongHalf + BEND_CLEARANCE;
    const high = segment.length - alongHalf - BEND_CLEARANCE;
    if (low > high) continue;
    const kind: 'branch' | 'trunk' = index < trunkSegments ? 'trunk' : 'branch';
    const offsets = [0, -(acrossHalf + 4), acrossHalf + 4, -(acrossHalf + 8), acrossHalf + 8];
    for (const fraction of [0.7, 0.5, 0.3]) {
      const along = Math.max(low, Math.min(high, segment.length * fraction));
      for (const offset of offsets) {
        const anchor = {
          x: segment.from.x + segment.ux * along - segment.uy * offset,
          y: segment.from.y + segment.uy * along + segment.ux * offset,
        };
        const rect = { x: anchor.x - width / 2, y: anchor.y - height / 2, w: width, h: height };
        if (!valid(rect, geometry)) continue;
        const distanceToTarget = total - (segment.start + along);
        const adjusted = Math.abs(offset) > 0.000001;
        output.push({
          state: adjusted ? 'adjusted' : 'normal',
          anchor,
          rect,
          segmentIndex: index + 1,
          segmentKind: kind,
          distanceToTarget,
          score: distanceToTarget * 0.25 + (kind === 'trunk' ? 30 : 0) + (adjusted ? 12 + Math.abs(offset) : 0),
        });
      }
    }
  }
  return output.sort((a, b) => a.score - b.score || a.anchor.x - b.anchor.x || a.anchor.y - b.anchor.y).slice(0, max);
}
