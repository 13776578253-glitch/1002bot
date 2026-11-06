/** React visualization components and public canvas contracts. */
export { VisualizationCanvas } from './VisualizationCanvas.tsx';
export type { VisualizationCanvasProps } from './types.ts';
export type { VisualizationBaseline, ChangeKind, ChangeMark } from '../core/schema/baseline.ts';
export type {
  CanvasBaselineContent, CanvasBaselineView, CanvasNodeView, CanvasViewport, CanvasViewMode, CanvasWorkspaceView,
  DisplayRouteSnapshot, EdgeLabelPin, EdgeRouteEndpointView, EdgeRouteSnapshot, EdgeRouteState,
  FrozenBoundaryPort, FrozenBoundarySegment, FrozenBoundarySide, FrozenGroupSnapshot,
  StageInheritanceBase, StagePlacementRecord, StageTransitionRecord,
} from './model/contracts/snapshot-types.ts';
export type { CanvasViewStorage } from './persistence/storage-types.ts';
export type { StageConflict, StageConflictAction, StageConflictKind } from './model/contracts/stage-types.ts';
export type { EdgeOverride, UserGraphOverlay } from './model/contracts/overlay.ts';
export { createLocalStorageViewStorage } from './persistence/local-storage.ts';
export type { LayoutMode, NodeLayoutEdits, LayoutPositionEdit, LayoutSizeEdit } from './model/contracts/layout-types.ts';
export { createProjectViewStorage, normalizeProjectWorkspace } from './persistence/project-storage.ts';
export { canvasWorkspaceToProject, projectWorkspaceToCanvas, projectSnapshot } from './persistence/project-workspace.ts';
export type {
  ProjectWorkspace, ProjectStageWorkspace, ProjectViewWorkspace, ProjectWorkspaceSnapshot,
  ProjectWorkspaceCheckpoint, ProjectOverrides, ProjectContainerStates,
} from './persistence/project-workspace.ts';
