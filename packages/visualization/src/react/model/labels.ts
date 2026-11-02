/** Edge label placement avoiding cards, frame boundaries and path bends. */
import type { Point, Rect } from '../../core/layout/geometry.ts';

export interface EdgeLabelPlacement extends Point {
  width: number;
  height: number;
}

const CLEARANCE = 8;
const BEND_CLEARANCE = 12;
const SIDE_GAP = 4;
const EPSILON = 0.000001;

interface Segment {
  from: Point;
  to: Point;
  length: number;
  start: number;
  ux: number;
  uy: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPSILON && a.x + a.w > b.x + EPSILON
    && a.y < b.y + b.h - EPSILON && a.y + a.h > b.y + EPSILON;
}

function expand(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

function inside(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON
    && inner.x + inner.w <= outer.x + outer.w + EPSILON
    && inner.y + inner.h <= outer.y + outer.h + EPSILON;
}

/**
 * 计算连线胶囊标签的无碰撞放置坐标。
 * 1. 优先沿自身折线路径居中吸附，保持 8px 内容避障余量与 12px 折角避让；
 * 2. 发生重叠时尝试侧向平移（±4px / ±8px）；
 * 3. 仍重叠时向外投影查找离路径最近的无遮挡可行点；
 * 4. 保底放置于内容区域最右侧开阔平面。
 */
export function measureLabel(text: string): { width: number; height: number } {
  return { width: Math.max(44, Array.from(text).reduce((sum, character) => sum + (/[^\u0000-\u007f]/.test(character) ? 12 : 7), 0) + 16), height: 24 };
}

export function placeEdgeLabel(
  points: readonly Point[],
  text: string,
  blockers: readonly Rect[],
  frames: readonly Rect[],
  occupied: readonly Rect[] = [],
): EdgeLabelPlacement {
  const { width, height } = measureLabel(text);
  const end = points[points.length - 1];
  const content = [...blockers, ...occupied, ...(end ? [{ x: end.x - 8, y: end.y - 8, w: 16, h: 16 }] : [])].map((rect) => expand(rect, CLEARANCE));
  const valid = (point: Point): boolean => {
    const rect = { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height };
    return content.every((blocker) => !intersects(rect, blocker)) && frames.every((frame) =>
      inside(expand(frame, -CLEARANCE), rect) || !intersects(expand(frame, CLEARANCE), rect));
  };
  const segments: Segment[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index]!;
    const from = points[index - 1]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    segments.push({ from, to, length, start: total, ux: (to.x - from.x) / length, uy: (to.y - from.y) / length });
    total += length;
  }

  // 沿障碍物边缘提取可能产生无交集可行区域的候选中心线
  const boundaryX = new Set<number>();
  const boundaryY = new Set<number>();
  for (const rect of content) {
    boundaryX.add(rect.x - width / 2).add(rect.x + rect.w + width / 2);
    boundaryY.add(rect.y - height / 2).add(rect.y + rect.h + height / 2);
  }
  for (const frame of frames) {
    boundaryX.add(frame.x - CLEARANCE - width / 2).add(frame.x + CLEARANCE + width / 2)
      .add(frame.x + frame.w - CLEARANCE - width / 2).add(frame.x + frame.w + CLEARANCE + width / 2);
    boundaryY.add(frame.y - CLEARANCE - height / 2).add(frame.y + CLEARANCE + height / 2)
      .add(frame.y + frame.h - CLEARANCE - height / 2).add(frame.y + frame.h + CLEARANCE + height / 2);
  }
  const candidates = (offsets: (halfAcross: number) => readonly number[]) => {
    const output: Array<Point & { score: number }> = [];
    for (const segment of segments) {
      const { from, length, start, ux, uy } = segment;
      const halfAlong = (Math.abs(ux) * width + Math.abs(uy) * height) / 2;
      const halfAcross = (Math.abs(uy) * width + Math.abs(ux) * height) / 2;
      const low = halfAlong + BEND_CLEARANCE;
      const high = length - halfAlong - BEND_CLEARANCE;
      if (low > high) continue;
      const clamp = (value: number) => Math.max(low, Math.min(high, value));
      for (const offset of offsets(halfAcross)) {
        const origin = { x: from.x - uy * offset, y: from.y + ux * offset };
        const along = new Set<number>([low, high, (low + high) / 2, clamp(total / 2 - start)]);
        for (const [axis, unit, boundaries] of [[origin.x, ux, boundaryX], [origin.y, uy, boundaryY]] as const) {
          if (Math.abs(unit) < EPSILON) continue;
          for (const position of boundaries) {
            const at = (position - axis) / unit;
            if (at >= low - EPSILON && at <= high + EPSILON) along.add(clamp(at));
          }
        }
        for (const at of along) {
          output.push({ x: origin.x + ux * at, y: origin.y + uy * at, score: Math.abs(start + at - total / 2) + Math.abs(offset) * 2 });
        }
      }
    }
    return output.sort((a, b) => a.score - b.score || a.x - b.x || a.y - b.y);
  };
  const inline = candidates(() => [0]).find(valid);
  if (inline) return { x: inline.x, y: inline.y, width, height };

  const offset = candidates((halfAcross) => [-4, 4, -8, 8, -halfAcross - SIDE_GAP, halfAcross + SIDE_GAP]).find(valid);
  if (offset) return { x: offset.x, y: offset.y, width, height };

  const anchor = points[0] ?? { x: 0, y: 0 };
  const allX = new Set<number>(boundaryX);
  const allY = new Set<number>(boundaryY);
  allX.add(anchor.x);
  allY.add(anchor.y);
  for (const { from, to, start, length, ux, uy } of segments) {
    const along = Math.max(0, Math.min(length, total / 2 - start));
    allX.add(from.x).add(to.x).add(from.x + ux * along);
    allY.add(from.y).add(to.y).add(from.y + uy * along);
  }
  const distanceToRoute = (point: Point): { distance: number; midpoint: number } => {
    let nearest = { distance: Math.hypot(point.x - anchor.x, point.y - anchor.y), midpoint: total / 2 };
    for (const { from, start, length, ux, uy } of segments) {
      const at = Math.max(0, Math.min(length, (point.x - from.x) * ux + (point.y - from.y) * uy));
      const distance = Math.hypot(point.x - from.x - ux * at, point.y - from.y - uy * at);
      const midpoint = Math.abs(start + at - total / 2);
      if (distance < nearest.distance - EPSILON || (Math.abs(distance - nearest.distance) <= EPSILON && midpoint < nearest.midpoint)) {
        nearest = { distance, midpoint };
      }
    }
    return nearest;
  };
  let nearest: (Point & { distance: number; midpoint: number }) | undefined;
  for (const x of [...allX].sort((a, b) => a - b)) for (const y of [...allY].sort((a, b) => a - b)) {
    const point = { x, y };
    const rank = distanceToRoute(point);
    if (nearest && (rank.distance > nearest.distance + EPSILON
      || (Math.abs(rank.distance - nearest.distance) <= EPSILON && rank.midpoint >= nearest.midpoint))) continue;
    if (valid(point)) nearest = { ...point, ...rank };
  }
  if (nearest) return { x: nearest.x, y: nearest.y, width, height };

  const farthestRight = Math.max(anchor.x, ...content.map((rect) => rect.x + rect.w), ...frames.map((rect) => rect.x + rect.w + CLEARANCE));
  return { x: farthestRight + width / 2, y: anchor.y, width, height };
}
