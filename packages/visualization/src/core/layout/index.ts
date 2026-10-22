/**
 * Layout contracts shared by the layered provider, pin constraints and
 * final edge router. Coordinates produced here are always world coordinates.
 */

import type { CanonicalPort, GraphNodeId } from '../schema/types.ts';
import type { PortSide, Point, Rect } from './geometry.ts';

export interface Size { w: number; h: number; }

export interface LayoutNodeInput {
  id: GraphNodeId;
  parentId?: GraphNodeId;
  kind: string;
  expanded: boolean;
  minSize?: Size;
  measuredSize?: Size;
  headerSize?: number;
  order: number;
  ports: readonly CanonicalPort[];
}

export interface LayoutEndpointInput {
  nodeId: GraphNodeId;
  portId?: string;
  side?: PortSide;
  fraction?: number;
}

export interface LayoutEdgeInput {
  id: string;
  source: LayoutEndpointInput;
  target: LayoutEndpointInput;
  label?: string;
}

export interface LayoutConstraints {
  pinned?: ReadonlyMap<GraphNodeId, Point>;
  expandedBefore?: ReadonlyMap<GraphNodeId, Point>;
  keepWithinParent?: boolean;
}

export interface LayoutInput {
  nodes: readonly LayoutNodeInput[];
  edges: readonly LayoutEdgeInput[];
  constraints?: LayoutConstraints;
  previous?: LayoutResult;
}

export interface NodeLayout {
  id: GraphNodeId;
  parentId?: GraphNodeId;
  worldRect: Rect;
  contentRect?: Rect;
  headerRect?: Rect;
  anchors: ReadonlyMap<string, Point>;
  expanded: boolean;
}

export interface EdgeRoute {
  id: string;
  points: readonly Point[];
  sourceAnchor: Point;
  targetAnchor: Point;
  labelPoint: Point;
  label?: string;
}

export interface LayoutResult {
  nodes: readonly NodeLayout[];
  edges: readonly EdgeRoute[];
  bounds: Rect;
}

export interface LayoutEngine { layout(input: LayoutInput): LayoutResult; }
export interface LayoutProvider extends LayoutEngine { layoutAsync(input: LayoutInput): Promise<LayoutResult>; }

export { createLayeredLayout, createElkLayout } from './layered.ts';
export { createPinnedLayout, applyPinnedConstraints } from './pinned.ts';
export { LAYOUT_METRICS, cssVariables, nodeSize, aggregateSize, type LayoutMetrics, type NodeMeasurement } from './metrics.ts';
export { routeVisibleEdges, validateOrthogonalPath, type RouteEndpoint, type RouteRequest, type RoutedPath } from './router.ts';
export {
  midpointOfPoints,
  obstacleFromRect,
  portAnchor,
  rectContains,
  rectFromPointSize,
  rectIntersects,
  simplifyPoints,
  svgPathFromPoints,
  toLocalPoint,
  toWorldPoint,
  type Obstacle,
  type Point,
  type PortSide,
  type Rect,
} from './geometry.ts';
