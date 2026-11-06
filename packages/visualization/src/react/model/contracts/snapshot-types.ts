/** Serialized canvas snapshots and the source revision of inherited content. */
import type { Point } from '../../../core/layout/geometry.ts';
import type { StageSnapshot } from '../../../core/schema/types.ts';
import type { EdgeLabelPlacement, LabelAttachment } from './label-types.ts';
import type { LayoutMode, NodeLayoutEdits } from './layout-types.ts';
import type { UserGraphOverlay } from './overlay.ts';

export interface CanvasViewport { x: number; y: number; zoom: number }

export type EdgeRouteState = 'auto' | 'pinned' | 'locked';

export interface EdgeRouteEndpointView {
  nodeId: string;
  portId?: string;
  handle?: string;
}

/** 按规范边身份保留的路径；展示聚合从不拥有独立冻结路径。 */
export interface EdgeRouteSnapshot {
  policyKey?: string;
  canonicalEdgeId: string;
  state: EdgeRouteState;
  source: EdgeRouteEndpointView;
  target: EdgeRouteEndpointView;
  points: Point[];
  space: { kind: 'world' } | { kind: 'owner'; ownerId: string };
  endpointFingerprint: string;
  label?: EdgeLabelPlacement;
  frozenBoundaries?: FrozenBoundarySegment[];
}

/** 为一条精确展示边编写标签位置。 */
export interface EdgeLabelPin {
  id: string;
  source: string;
  target: string;
  memberIds: string[];
  memberFingerprints?: Record<string, string>;
  label: EdgeLabelPlacement;
}

export interface FrozenBoundarySegment {
  ownerId: string;
  endpoint: 'source' | 'target';
  points: Point[];
  side: FrozenBoundarySide;
}

/** 投影路径是视图几何；成员身份仍是规范身份。 */
export interface DisplayRouteSnapshot {
  policyKey?: string;
  id: string;
  source: string;
  target: string;
  memberIds: string[];
  sourceHandle: string;
  targetHandle: string;
  points: Point[];
  label: EdgeLabelPlacement;
  labelAttachment?: LabelAttachment;
  labelIdentity?: string;
  labelPolicyKey?: string;
  labelRouteKey?: string;
  text: string;
  sourceBounds: { x: number; y: number; w: number; h: number };
  targetBounds: { x: number; y: number; w: number; h: number };
  barrierKey?: string;
}

export type FrozenBoundarySide = 'top' | 'right' | 'bottom' | 'left';

export interface FrozenBoundaryPort {
  edgeId: string;
  nodeId: string;
  side: FrozenBoundarySide;
  handle?: string;
}

/** 单层冻结账本；成员不得与其他冻结组重叠。 */
export interface FrozenGroupSnapshot {
  id: string;
  rootId: string;
  memberIds: string[];
  worldBounds: { x: number; y: number; w: number; h: number };
  boundaryPorts: FrozenBoundaryPort[];
  createdAt: string;
  previousModes?: Record<string, LayoutMode>;
  previousRoutes?: EdgeRouteSnapshot[];
  frozenFrames?: Record<string, { width: number; height: number }>;
  protectedFrame?: { x: number; y: number; width: number; height: number };
}

export interface StagePlacementRecord {
  nodeId: string;
  mode: 'provided' | 'gap' | 'expanded' | 'relocated';
}

export interface StageTransitionRecord {
  fromStageId?: string;
  toStageId: string;
  sourceRevision: string;
  targetRevision: string;
  startedAt: string;
  durationMs: number;
  placements: StagePlacementRecord[];
  expanded: string[];
  metrics?: { inheritedNodes: number; addedNodes: number; reusedPaths: number; routedEdges: number; totalEdges: number };
}

export interface CanvasBaselineContent {
  nodes: CanvasNodeView[];
  edgeRoutes: EdgeRouteSnapshot[];
  frozenGroups: FrozenGroupSnapshot[];
  overlay?: UserGraphOverlay;
  displayRoutes?: DisplayRouteSnapshot[];
  labelPins?: EdgeLabelPin[];
}

interface ViewData {
  expanded?: boolean;
  contentWidth?: number;
  contentHeight?: number;
  fitOffset?: Point;
  reflowOrigin?: Point;
  expansionSizes?: Record<string, { width: number; height: number }>;
  groupOrigins?: Record<string, string | null>;
  layoutEdits?: NodeLayoutEdits;
  layoutMode?: LayoutMode;
  title?: string;
  frozen?: boolean;
};

export interface CanvasNodeView {
  id: string;
  type: string;
  parentId?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  data: ViewData;
}

export interface CanvasBaselineView extends CanvasBaselineContent {
  revision: string;
  confirmationId?: string;
  confirmedRevision?: string;
  confirmedAt?: string;
  confirmed?: CanvasBaselineContent;
  requiresConfirmation?: boolean;
  viewport?: CanvasViewport;
  transition?: StageTransitionRecord;
  inheritance?: StageInheritanceBase;
  sourceStage?: StageSnapshot;
}

export type CanvasViewMode = 'overview' | 'structure' | 'full';

export interface CanvasWorkspaceView {
  version: 2;
  baselineId: string;
  baselines: Record<string, CanvasBaselineView>;
  viewMode?: CanvasViewMode;
  views?: Partial<Record<CanvasViewMode, Record<string, CanvasBaselineView>>>;
}

/** 当前目标草稿分叉时使用的父内容和生成目标。 */
export interface StageInheritanceBase {
  parentId: string;
  parentRevision: string;
  parentContent: CanvasBaselineContent;
  targetRevision: string;
  targetStage: StageSnapshot;
  targetContent: CanvasBaselineContent;
}
