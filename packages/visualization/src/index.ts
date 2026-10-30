/** Public UI-independent graph and baseline contracts. */
export type {
  CanonicalEdge, CanonicalEndpoint, CanonicalGraph, CanonicalNode, CanonicalPort,
  GraphEdgeId, GraphNodeId, GraphPortId, GraphPatch, GraphPatchOperation,
  NodeKind, StageMeta, StageSnapshot,
} from './core/schema/types.ts';
export type { ChangeKind, ChangeMark, VisualizationBaseline } from './core/schema/baseline.ts';
export { assertValidBaselines } from './core/schema/baseline.ts';
export { validateSnapshot, assertValidSnapshot } from './core/schema/validate.ts';
export type { ValidationIssue } from './core/schema/validate.ts';
export { assertValidGraph, applyGraphPatch, edgesTouching, indexGraph, validateGraph } from './core/graph/index.ts';
export type { IndexedGraph } from './core/graph/index.ts';
export { projectGraph, resolveVisibleEndpoint } from './core/projection/index.ts';
export type { ExpansionState, Projection, ProjectedEdge, VisibleEndpoint, VisibleNode } from './core/projection/index.ts';
export type { Point, Rect, Obstacle, PortSide } from './core/layout/geometry.ts';
