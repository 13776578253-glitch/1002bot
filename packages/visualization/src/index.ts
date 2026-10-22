/** Public UI-independent Core API. */
export type {
  CanonicalEdge,
  CanonicalEndpoint,
  CanonicalGraph,
  CanonicalNode,
  CanonicalPort,
  EvolutionEvent,
  EvolutionStep,
  GraphEdgeId,
  GraphNodeId,
  GraphPatch,
  GraphPatchOperation,
  GraphPortId,
  StageSnapshot,
  TrackSeries,
} from './core/schema/types.ts';
export { validateSnapshot, assertValidSnapshot, validateTrackSeries, assertValidTrackSeries } from './core/schema/validate.ts';
export type { ValidationIssue } from './core/schema/validate.ts';
export { normalizeTrackSeries, normalizeTracks, stageAt } from './core/schema/normalize.ts';
export { assertValidGraph, applyGraphPatch, edgesTouching, indexGraph, validateGraph } from './core/graph/index.ts';
export type { IndexedGraph } from './core/graph/index.ts';
export { projectGraph, resolveVisibleEndpoint } from './core/projection/index.ts';
export type { ExpansionState, Projection, ProjectedEdge, VisibleEndpoint, VisibleNode } from './core/projection/index.ts';
export { applyEvolutionEvents, diffSnapshots, edgeDeltaIdentity } from './core/evolution/index.ts';
export type { EdgeDelta, NodeDelta, NodeDeltaKind, StageDelta } from './core/evolution/index.ts';
export { createCanvasScene, createCanvasSceneSync } from './core/engine/index.ts';
export type { CanvasScene, SceneEdge, SceneInput, SceneNode } from './core/engine/index.ts';
export {
  aggregateSize,
  applyPinnedConstraints,
  createElkLayout,
  createLayeredLayout,
  createPinnedLayout,
  cssVariables,
  LAYOUT_METRICS,
  routeVisibleEdges,
  svgPathFromPoints,
} from './core/layout/index.ts';
export type {
  LayoutConstraints,
  LayoutEdgeInput,
  LayoutEngine,
  LayoutInput,
  LayoutMetrics,
  LayoutNodeInput,
  LayoutProvider,
  LayoutResult,
  NodeLayout,
  Point,
  Rect,
  Size,
} from './core/layout/index.ts';
