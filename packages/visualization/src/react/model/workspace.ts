/** Serializable working views and transaction history; source entities remain owned by each baseline. */
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { Point } from '../../core/layout/geometry.ts';
import type { CanvasNode, LayoutMode } from './grouping.ts';
import { CARD_SIZE, detailCardSize } from './grouping.ts';
import type { EdgeLabelPlacement } from './labels.ts';
import type { UserGraphOverlay } from './overlay.ts';
import type { StageInheritanceBase } from './snapshot-inheritance.ts';
import type { StageSnapshot } from '../../core/schema/types.ts';
import { legacyLayoutEdits } from './layout-intent.ts';
import type { LabelAttachment } from './label-layout.ts';
import { comparableCanvasIntent } from './confirmation.ts';

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

type ViewData = Pick<CanvasNode['data'], 'expanded' | 'contentWidth' | 'contentHeight' | 'fitOffset' | 'reflowOrigin' | 'expansionSizes' | 'groupOrigins' | 'layoutEdits'> & {
  layoutMode?: 'free' | 'fixed' | 'locked';
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

export interface CanvasViewStorage {
  load(key: string): CanvasWorkspaceView | undefined | Promise<CanvasWorkspaceView | undefined>;
  save(key: string, view: CanvasWorkspaceView): void | Promise<void>;
}

export function captureNodeViews(nodes: readonly CanvasNode[]): CanvasNodeView[] {
  return nodes.map((node) => {
    const { expanded, contentWidth, contentHeight, fitOffset, reflowOrigin, expansionSizes, groupOrigins, frozen } = node.data;
    return structuredClone({
      id: node.id, type: node.type!, ...(node.parentId ? { parentId: node.parentId } : {}),
      position: node.position, width: node.width!, height: node.height!,
      data: {
        ...(node.type === 'cluster' || node.data.titleOverride !== undefined ? { title: node.data.titleOverride ?? node.data.title } : {}),
        ...(expanded !== undefined ? { expanded } : {}),
        ...(contentWidth !== undefined ? { contentWidth } : {}), ...(contentHeight !== undefined ? { contentHeight } : {}),
        ...(fitOffset ? { fitOffset } : {}), ...(reflowOrigin ? { reflowOrigin } : {}),
        ...(expansionSizes ? { expansionSizes } : {}), ...(groupOrigins ? { groupOrigins } : {}),
        ...(frozen ? { frozen } : {}),
        layoutMode: node.data.layoutMode ?? 'free',
        ...(node.data.layoutEdits ? { layoutEdits: node.data.layoutEdits } : {}),
      },
    });
  });
}

export function captureContent(
  nodes: readonly CanvasNode[],
  edgeRoutes: readonly EdgeRouteSnapshot[] = [],
  frozenGroups: readonly FrozenGroupSnapshot[] = [],
  overlay?: UserGraphOverlay,
  displayRoutes?: readonly DisplayRouteSnapshot[],
  labelPins?: readonly EdgeLabelPin[],
): CanvasBaselineContent {
  return {
    nodes: captureNodeViews(nodes),
    edgeRoutes: structuredClone([...edgeRoutes]),
    frozenGroups: structuredClone([...frozenGroups]),
    ...(overlay ? { overlay: structuredClone(overlay) } : {}),
    ...(displayRoutes ? { displayRoutes: structuredClone([...displayRoutes]) } : {}),
    ...(labelPins?.length ? { labelPins: structuredClone([...labelPins]) } : {}),
  };
}

export function cloneContent(content: CanvasBaselineContent): CanvasBaselineContent {
  return structuredClone(content);
}

export function emptyContent(nodes: CanvasNodeView[] = []): CanvasBaselineContent {
  return { nodes, edgeRoutes: [], frozenGroups: [] };
}

export function restoreNodeViews(baseline: VisualizationBaseline, fresh: readonly CanvasNode[], saved: readonly CanvasNodeView[], standardizeCards = true): CanvasNode[] {
  const canonical = new Map(fresh.map((node) => [node.id, node]));
  const previous = new Map(saved.map((node) => [node.id, node]));
  const retained = new Set([...canonical.keys(), ...saved.filter((node) => node.type === 'cluster').map((node) => node.id)]);
  let removed = true;
  while (removed) {
    removed = false;
    for (const node of saved) {
      if (node.type !== 'cluster' || !retained.has(node.id)) continue;
      if (!saved.some((child) => child.parentId === node.id && retained.has(child.id))) { retained.delete(node.id); removed = true; }
    }
  }
  const world = (node: CanvasNodeView): { x: number; y: number } => {
    const parent = node.parentId ? previous.get(node.parentId) : undefined;
    const origin = parent ? world(parent) : { x: 0, y: 0 };
    return { x: origin.x + node.position.x, y: origin.y + node.position.y };
  };
  const freshWorld = (node: CanvasNode): { x: number; y: number } => {
    const parent = node.parentId ? canonical.get(node.parentId) : undefined;
    const origin = parent ? freshWorld(parent) : { x: 0, y: 0 };
    return { x: origin.x + node.position.x, y: origin.y + node.position.y };
  };
  const result = saved.filter((node) => retained.has(node.id)).map((view): CanvasNode => {
    const source = canonical.get(view.id);
    const manualParent = view.parentId && retained.has(view.parentId) && previous.get(view.parentId)?.type === 'cluster';
    const parentId = manualParent ? view.parentId : source ? source.parentId : view.parentId && retained.has(view.parentId) ? view.parentId : undefined;
    const position = parentId === view.parentId ? view.position : (() => {
      const point = world(view), parent = parentId ? previous.get(parentId) : undefined, freshParent = parentId ? canonical.get(parentId) : undefined;
      const origin = parent ? world(parent) : freshParent ? freshWorld(freshParent) : { x: 0, y: 0 };
      return { x: point.x - origin.x, y: point.y - origin.y };
    })();
    const expanded = !!source?.data.expandable && (baseline.layout?.expansion === 'expanded' || baseline.layout?.expansion !== 'collapsed' && !!view.data.expanded);
    const cluster = view.type === 'cluster';
    const structure = expanded && (source?.data.childCount ?? 0) > 0;
    const shapeChanged = !cluster && (expanded !== !!view.data.expanded || expanded && (view.type === 'structure') !== structure);
    const size = source && (shapeChanged || !source.data.expandable && view.type === 'structure') ? { width: source.width!, height: source.height! } : { width: view.width, height: view.height };
    if (standardizeCards && !cluster && !structure && !view.data.frozen && view.data.layoutMode !== 'locked') Object.assign(size, expanded ? detailCardSize(source?.data.details?.length ?? 0) : CARD_SIZE);
    return {
      ...(source ? (({ parentId: _parent, extent: _extent, dragHandle: _handle, ...node }) => node)(source) : { id: view.id, data: { title: view.data.title! } }),
      type: cluster ? 'cluster' : structure ? 'structure' : 'card',
      position: { ...position }, ...size,
      measured: { ...size }, style: { ...size },
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      ...(cluster ? { dragHandle: '.cluster-drag-handle' } : structure ? { dragHandle: '.structure-header' } : {}),
      selected: false,
      data: { ...source?.data, ...view.data, layoutEdits: view.data.layoutEdits ?? legacyLayoutEdits(view, saved), ...(shapeChanged && source ? { contentWidth: source.width!, contentHeight: source.height! } : {}), expanded, title: view.data.title ?? source!.data.title, ...(!cluster && view.data.title !== undefined ? { titleOverride: view.data.title } : {}), ...(source ? { change: baseline.nodeChanges[source.id]! } : {}) },
    };
  });
  const restoredIds = new Set(result.map((node) => node.id));
  result.push(...fresh.filter((node) => !restoredIds.has(node.id)));
  const byId = new Map(result.map((node) => [node.id, node])), ordered: CanvasNode[] = [], visited = new Set<string>(), visiting = new Set<string>();
  const append = (node: CanvasNode): void => {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) throw new Error('保存的分组与当前架构形成循环，请修正分组后重试');
    visiting.add(node.id);
    if (node.parentId) append(byId.get(node.parentId)!);
    visiting.delete(node.id); visited.add(node.id); ordered.push(node);
  };
  result.forEach(append);
  return ordered;
}

/** 每个已提交手势一条记录；选择和视口不进入历史。 */
export class ViewHistory {
  private past: CanvasBaselineContent[] = [];
  private future: CanvasBaselineContent[] = [];
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  record(before: CanvasBaselineContent, after: CanvasBaselineContent): boolean {
    if (JSON.stringify(comparableCanvasIntent(before)) === JSON.stringify(comparableCanvasIntent(after))) return false;
    this.past.push(before);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current: CanvasBaselineContent): CanvasBaselineContent { this.future.push(current); return this.past.pop()!; }
  redo(current: CanvasBaselineContent): CanvasBaselineContent { this.past.push(current); return this.future.pop()!; }
}
