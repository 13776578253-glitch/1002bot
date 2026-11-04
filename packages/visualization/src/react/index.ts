/** React visualization components and public canvas contracts. */
export { VisualizationCanvas } from './VisualizationCanvas.tsx';
export type { VisualizationCanvasProps } from './types.ts';
export type { VisualizationBaseline, ChangeKind, ChangeMark } from '../core/schema/baseline.ts';
export type {
  CanvasBaselineContent, CanvasBaselineView, CanvasNodeView, CanvasViewport, CanvasViewMode, CanvasViewStorage, CanvasWorkspaceView,
  DisplayRouteSnapshot, EdgeLabelPin, EdgeRouteEndpointView, EdgeRouteSnapshot, EdgeRouteState, FrozenBoundaryPort, FrozenBoundarySegment, FrozenBoundarySide, FrozenGroupSnapshot,
  StagePlacementRecord, StageTransitionRecord,
} from './model/workspace.ts';
export type { StageConflict, StageConflictAction, StageConflictKind } from './model/stage-types.ts';
export type { EdgeOverride, UserGraphOverlay } from './model/overlay.ts';
export { createLocalStorageViewStorage } from './persistence/local-storage.ts';
export type { LayoutMode } from './model/grouping.ts';
export type { NodeLayoutEdits, LayoutPositionEdit, LayoutSizeEdit } from './model/layout-intent.ts';
export type { StageInheritanceBase } from './model/snapshot-inheritance.ts';
export { createProjectViewStorage, normalizeProjectWorkspace } from './persistence/project-storage.ts';
export { canvasWorkspaceToProject, projectWorkspaceToCanvas, projectSnapshot } from './model/project-workspace.ts';
export type { ProjectWorkspace, ProjectStageWorkspace, ProjectViewWorkspace, ProjectWorkspaceSnapshot, ProjectWorkspaceCheckpoint, ProjectOverrides, ProjectContainerStates } from './model/project-workspace.ts';
