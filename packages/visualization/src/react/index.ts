/** React visualization components and public canvas contracts. */
export { VisualizationCanvas } from './VisualizationCanvas.tsx';
export type { VisualizationCanvasProps } from './types.ts';
export type { VisualizationBaseline, ChangeKind, ChangeMark } from '../core/schema/baseline.ts';
export type { CanvasWorkspaceView, CanvasViewStorage, CanvasBaselineView, CanvasNodeView, CanvasViewport } from './model/workspace.ts';
export { createLocalStorageViewStorage } from './persistence/local-storage.ts';
export type { LayoutMode } from './model/grouping.ts';
