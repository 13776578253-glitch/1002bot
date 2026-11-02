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
export { assertValidGraph, applyGraphPatch, diffStages, edgesTouching, indexGraph, validateGraph } from './core/graph/index.ts';
export type { IndexedGraph, StageDiff } from './core/graph/index.ts';
export { projectGraph, resolveVisibleEndpoint } from './core/projection/index.ts';
export type { ExpansionState, Projection, ProjectedEdge, VisibleEndpoint, VisibleNode } from './core/projection/index.ts';
export type { Point, Rect, Obstacle, PortSide } from './core/layout/geometry.ts';
export type { PortPolicy, RouteCost, RouteCostMetric } from './core/layout/port-policy.ts';
export type {
  EndpointRole, NodePortAllocator, NodePortGeometry, PhysicalSlot, PortAllocationSnapshot, PortFailure,
  PortMode, PortPriority, PortRequest, PortSlot, SlotGrant, SlotRules,
} from './core/layout/node-port-allocator.ts';
export { createNodePortAllocator, DEFAULT_SLOT_RULES, slotAnchor, slotFractions, slotHandleId } from './core/layout/node-port-allocator.ts';
export type {
  FingerprintEdge, FingerprintLabel, FingerprintNode, FingerprintParts, FingerprintProtected,
  GroupFingerprintParts, NeighborToken, ProtectedRoute,
} from './core/layout/input-fingerprint.ts';
export { buildGroupFingerprint, buildInputFingerprint } from './core/layout/input-fingerprint.ts';
export type {
  LegalityIssue, LegalityIssueKind, RouteObstacle, RouteProtection, ValidateRouteInput,
} from './core/layout/legality.ts';
export { assertLegalRoute, validateRoute } from './core/layout/legality.ts';
export type { SearchBudget, SearchLimits } from './core/layout/search-limits.ts';
export { createSearchBudget, createSolveBudget, DEFAULT_SEARCH_LIMITS, DEFAULT_SOLVE_LIMITS } from './core/layout/search-limits.ts';
export type { EdgeBudget, SolveBudget, SolveBudgetLimits } from './core/layout/search-limits.ts';
export type * from './core/project/types.ts';
