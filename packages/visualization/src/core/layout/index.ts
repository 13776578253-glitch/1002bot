/**
 * Layout contracts. The core defines the data shapes the render layer
 * consumes; concrete algorithms (manual coordinates, grid tidy, ELK.js)
 * implement these interfaces.
 */

import type { NodePath } from '../schema/types.ts';

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode {
  path: NodePath;
  /** Absolute canvas position. */
  at: Point;
  size: Size;
  expanded: boolean;
}

export interface RoutedEdge {
  /** Projected endpoints (already resolved by the projection engine). */
  from: NodePath;
  to: NodePath;
  /** Orthogonal waypoints in canvas coordinates. */
  points: Point[];
  label?: string;
}

export interface LayoutResult {
  nodes: PlacedNode[];
  edges: RoutedEdge[];
  bounds: { x: number; y: number; w: number; h: number };
}

export interface LayoutEngine {
  /** Compute positions for the visible projection. */
  layout(
    nodes: { path: NodePath; expanded: boolean }[],
    edges: { from: NodePath; to: NodePath; label?: string }[],
  ): LayoutResult;
}

export { createElkLayout } from './elk.ts';
export { createTidyLayout, LAYOUT_METRICS } from './tidy.ts';
export {
  routeOrthogonal,
  svgPathFromPoints,
  midpointOfPoints,
  simplifyPoints,
  type Obstacle,
  type Rect,
} from './geometry.ts';
