/** Unified hard-legality checks shared by routing, storage and frozen connectors. */
import { segmentBounds, segmentCrossesRect, type Point, type PortSide, type Rect } from './geometry.ts';

export type LegalityIssueKind = 'collision' | 'protected' | 'attachment' | 'anchor' | 'degenerate' | 'orthogonal';

export interface LegalityIssue {
  kind: LegalityIssueKind;
  message: string;
  segmentIndex?: number;
}

export interface RouteObstacle {
  id: string;
  bounds: Rect;
  padded: Rect;
  card: boolean;
  endpointBounds?: Rect;
}

export interface RouteProtection {
  edgeId: string;
  rect: Rect;
}

export interface ValidateRouteInput {
  points: readonly Point[];
  sourceId: string;
  targetId: string;
  obstacles?: readonly RouteObstacle[];
  obstaclesAt?: (rect: Rect) => Iterable<RouteObstacle>;
  reserved?: readonly RouteProtection[];
  reservedAt?: (rect: Rect) => Iterable<RouteProtection>;
  ignoreEdgeId?: string;
  sourceSide?: PortSide;
  targetSide?: PortSide;
  sourceAnchor?: Point;
  targetAnchor?: Point;
  requireAttachment?: boolean;
  requireOrthogonal?: boolean;
}

const TOLERANCE = 0.001;

function outside(anchor: Point, next: Point, side: PortSide): boolean {
  if (side === 'left') return next.x < anchor.x && next.y === anchor.y;
  if (side === 'right') return next.x > anchor.x && next.y === anchor.y;
  if (side === 'top') return next.y < anchor.y && next.x === anchor.x;
  return next.y > anchor.y && next.x === anchor.x;
}

export function validateRoute(input: ValidateRouteInput): LegalityIssue[] {
  const issues: LegalityIssue[] = [];
  if (input.points.length < 2) {
    issues.push({ kind: 'degenerate', message: 'route needs at least two points' });
    return issues;
  }
  if (input.requireOrthogonal ?? true) {
    for (let index = 1; index < input.points.length; index += 1) {
      const from = input.points[index - 1]!, to = input.points[index]!;
      if (from.x !== to.x && from.y !== to.y) issues.push({ kind: 'orthogonal', message: 'segment is not orthogonal', segmentIndex: index });
    }
  }
  for (let index = 1; index < input.points.length; index += 1) {
    const from = input.points[index - 1]!, to = input.points[index]!;
    if (from.x === to.x && from.y === to.y) issues.push({ kind: 'degenerate', message: 'zero-length segment', segmentIndex: index });
    const bounds = segmentBounds(from, to);
    const nearby = input.obstaclesAt ? input.obstaclesAt(bounds) : input.obstacles ?? [];
    for (const obstacle of nearby) {
      const rect = obstacle.id === input.sourceId || obstacle.id === input.targetId ? obstacle.endpointBounds ?? obstacle.bounds : obstacle.padded;
      if (segmentCrossesRect(from, to, rect)) issues.push({ kind: 'collision', message: `segment crosses ${obstacle.id}`, segmentIndex: index });
    }
    const reserved = input.reservedAt ? input.reservedAt(bounds) : input.reserved ?? [];
    for (const blocked of reserved) {
      if (blocked.edgeId === input.ignoreEdgeId) continue;
      if (segmentCrossesRect(from, to, blocked.rect)) issues.push({ kind: 'protected', message: `segment crosses protected ${blocked.edgeId}`, segmentIndex: index });
    }
  }
  if (input.requireAttachment) {
    const { sourceAnchor, targetAnchor, sourceSide, targetSide } = input;
    if (sourceAnchor && targetAnchor) {
      if (Math.abs(input.points[0]!.x - sourceAnchor.x) > TOLERANCE || Math.abs(input.points[0]!.y - sourceAnchor.y) > TOLERANCE) {
        issues.push({ kind: 'anchor', message: 'source does not start on its anchor' });
      }
      const last = input.points.at(-1)!;
      if (Math.abs(last.x - targetAnchor.x) > TOLERANCE || Math.abs(last.y - targetAnchor.y) > TOLERANCE) {
        issues.push({ kind: 'anchor', message: 'target does not end on its anchor' });
      }
      if (sourceSide && !outside(input.points[0]!, input.points[1]!, sourceSide)) issues.push({ kind: 'attachment', message: 'source departs inward' });
      if (targetSide && !outside(last, input.points.at(-2)!, targetSide)) issues.push({ kind: 'attachment', message: 'target arrives inward' });
    }
  }
  return issues;
}

export function assertLegalRoute(input: ValidateRouteInput): void {
  const issues = validateRoute(input);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join('; '));
}
