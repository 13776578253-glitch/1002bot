/**
 * Final visible-edge router.
 *
 * The router consumes already placed rectangles. It never decides node
 * order or hierarchy; those decisions belong to the layered provider.
 */

import type { Point, Rect, Obstacle, PortSide } from './geometry.ts';
import { obstacleFromRect, portAnchor, routeOrthogonal, simplifyPoints } from './geometry.ts';
import type { LayoutMetrics } from './metrics.ts';
import { LAYOUT_METRICS } from './metrics.ts';

export interface RouteEndpoint {
  rect: Rect;
  side?: PortSide;
  fraction?: number;
}

export interface RouteRequest {
  id: string;
  source: RouteEndpoint;
  target: RouteEndpoint;
  obstacles?: readonly Obstacle[];
  label?: string;
}

export interface RoutedPath {
  id: string;
  points: Point[];
  sourceAnchor: Point;
  targetAnchor: Point;
  labelPoint: Point;
  label?: string;
}

function defaultSide(source: Rect, target: Rect): { source: PortSide; target: PortSide } {
  const sourceCenter = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
  const targetCenter = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  if (Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y)) {
    return targetCenter.x >= sourceCenter.x
      ? { source: 'right', target: 'left' }
      : { source: 'left', target: 'right' };
  }
  return targetCenter.y >= sourceCenter.y
    ? { source: 'bottom', target: 'top' }
    : { source: 'top', target: 'bottom' };
}

function endpointRect(endpoint: RouteEndpoint): Rect {
  return endpoint.rect;
}

export function routeVisibleEdges(
  requests: readonly RouteRequest[],
  metrics: LayoutMetrics = LAYOUT_METRICS,
): RoutedPath[] {
  const output: RoutedPath[] = [];
  for (const request of requests) {
    const sourceRect = endpointRect(request.source);
    const targetRect = endpointRect(request.target);
    const defaults = defaultSide(sourceRect, targetRect);
    const sourceSide = request.source.side && request.source.side !== 'auto' ? request.source.side : defaults.source;
    const targetSide = request.target.side && request.target.side !== 'auto' ? request.target.side : defaults.target;
    const sourceAnchor = portAnchor(sourceRect, sourceSide, request.source.fraction);
    const targetAnchor = portAnchor(targetRect, targetSide, request.target.fraction);
    const obstacles = request.obstacles ?? [];
    const route = routeOrthogonal(
      sourceRect,
      targetRect,
      obstacles.filter((obstacle) => {
        const sourceObstacle = obstacleFromRect(sourceRect, 0);
        const targetObstacle = obstacleFromRect(targetRect, 0);
        const touchesSource = obstacle.left <= sourceObstacle.right
          && obstacle.right >= sourceObstacle.left
          && obstacle.top <= sourceObstacle.bottom
          && obstacle.bottom >= sourceObstacle.top;
        const touchesTarget = obstacle.left <= targetObstacle.right
          && obstacle.right >= targetObstacle.left
          && obstacle.top <= targetObstacle.bottom
          && obstacle.bottom >= targetObstacle.top;
        return !touchesSource && !touchesTarget;
      }),
      { padding: metrics.routePadding, offset: metrics.routeStub },
    );
    // Existing routeOrthogonal uses horizontal ports as a safe fallback. If
    // an explicit top/bottom port was requested, preserve those anchors at
    // the ends while keeping its obstacle-free interior.
    const points = simplifyPoints([
      sourceAnchor,
      ...route.slice(1, -1),
      targetAnchor,
    ]);
    output.push({
      id: request.id,
      points,
      sourceAnchor,
      targetAnchor,
      labelPoint: midpoint(points),
      ...(request.label === undefined ? {} : { label: request.label }),
    });
  }
  return output;
}

function midpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0]! };
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const length = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    lengths.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]!;
    if (remaining <= length) {
      const from = points[i]!;
      const to = points[i + 1]!;
      const ratio = length === 0 ? 0 : remaining / length;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    remaining -= length;
  }
  return { ...points[points.length - 1]! };
}

export function validateOrthogonalPath(points: readonly Point[], obstacles: readonly Obstacle[]): boolean {
  if (points.length < 2) return false;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (from.x !== to.x && from.y !== to.y) return false;
    for (const obstacle of obstacles) {
      if (from.y === to.y) {
        const minX = Math.min(from.x, to.x);
        const maxX = Math.max(from.x, to.x);
        if (from.y > obstacle.top && from.y < obstacle.bottom && maxX > obstacle.left && minX < obstacle.right) return false;
      } else {
        const minY = Math.min(from.y, to.y);
        const maxY = Math.max(from.y, to.y);
        if (from.x > obstacle.left && from.x < obstacle.right && maxY > obstacle.top && minY < obstacle.bottom) return false;
      }
    }
  }
  return true;
}
