/**
 * Public API for the architecture evolution visualization package.
 *
 * core/ is UI-independent: schema, graph indexing, projection, evolution,
 * and layout contracts. react/ adapts the projection to React Flow.
 */

export type {
  EvolutionEvent,
  EvolutionStep,
  GraphEdge,
  GraphNode,
  GraphPort,
  NodeKey,
  NodePath,
  StageSnapshot,
  TrackSeries,
} from './core/schema/types.ts';
export { validateSnapshot, assertValidSnapshot } from './core/schema/validate.ts';
export { validateTrackSeries, assertValidTrackSeries } from './core/schema/validate.ts';
export type { ValidationIssue } from './core/schema/validate.ts';
export { normalizeTrackSeries, normalizeTracks, stageAt } from './core/schema/normalize.ts';

export { indexGraph, edgesTouching, splitEndpoint } from './core/graph/index.ts';
export type { IndexedGraph } from './core/graph/index.ts';

export { projectGraph, resolveVisibleEndpoint } from './core/projection/index.ts';
export type { Projection, ProjectedEdge, VisibleNode } from './core/projection/index.ts';

export { diffSnapshots, applyEvolutionEvents } from './core/evolution/index.ts';
export { edgeDeltaIdentity } from './core/evolution/index.ts';
export type { EdgeDelta, NodeDelta, NodeDeltaKind, StageDelta } from './core/evolution/index.ts';

export { createCanvasModel } from './core/engine/index.ts';
export type { CanvasEdgeModel, CanvasModel, CanvasNodeModel } from './core/engine/index.ts';

export { createElkLayout, createTidyLayout, LAYOUT_METRICS, routeOrthogonal, svgPathFromPoints } from './core/layout/index.ts';
export type { LayoutEngine, LayoutResult, PlacedNode, RoutedEdge, Point, Size, Obstacle, Rect } from './core/layout/index.ts';
