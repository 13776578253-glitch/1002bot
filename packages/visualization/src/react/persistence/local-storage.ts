/** Browser storage adapter; malformed records are surfaced at this external boundary. */
import type {
  CanvasBaselineContent,
  CanvasNodeView,
  CanvasViewport,
  CanvasViewStorage,
  CanvasWorkspaceView,
  EdgeRouteSnapshot,
  FrozenBoundarySide,
  FrozenGroupSnapshot,
  StageTransitionRecord,
} from '../model/workspace.ts';
import type { UserGraphOverlay } from '../model/overlay.ts';
import type { StageInheritanceBase } from '../model/snapshot-inheritance.ts';
import { assertValidGraph } from '../../core/graph/validate.ts';

type UnknownRecord = Record<string, unknown>;

const NODE_TYPES = new Set(['card', 'structure', 'cluster']);
const LAYOUT_MODES = new Set(['free', 'fixed', 'locked']);
const ROUTE_STATES = new Set(['auto', 'pinned', 'locked']);
const FROZEN_SIDES = new Set<FrozenBoundarySide>(['top', 'right', 'bottom', 'left']);

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkPoint(value: unknown, message: string): { x: number; y: number } {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) throw new Error(message);
  return { x: value.x, y: value.y };
}

function checkViewport(raw: unknown): CanvasViewport | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.zoom) || !(raw.zoom > 0)) {
    throw new Error('视口格式不正确');
  }
  return { x: raw.x, y: raw.y, zoom: raw.zoom };
}

function checkNodeViews(raw: unknown): CanvasNodeView[] {
  if (!Array.isArray(raw)) throw new Error('阶段视图格式不正确');
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || !isText(item.id)) continue;
    if (seen.has(item.id)) throw new Error('视图包含重复节点');
    seen.add(item.id);
  }
  const nodes = new Map<string, CanvasNodeView>();
  for (const item of raw) {
    if (!isRecord(item)) throw new Error('节点视图格式不正确');
    if (!isText(item.id) || typeof item.type !== 'string' || !NODE_TYPES.has(item.type) || !isRecord(item.data) || !isRecord(item.position)) {
      throw new Error('节点视图格式不正确');
    }
    if (!isFiniteNumber(item.position.x) || !isFiniteNumber(item.position.y) || !isFiniteNumber(item.width) || !isFiniteNumber(item.height) || !(item.width > 0) || !(item.height > 0)) {
      throw new Error('节点视图格式不正确');
    }
    if (!LAYOUT_MODES.has(typeof item.data.layoutMode === 'string' ? item.data.layoutMode : 'free')) throw new Error('节点视图格式不正确');
    if (item.data.frozen !== undefined && typeof item.data.frozen !== 'boolean') throw new Error('节点视图格式不正确');
    if (item.data.expanded !== undefined && typeof item.data.expanded !== 'boolean') throw new Error('节点视图格式不正确');
    if (item.parentId !== undefined && !isText(item.parentId)) throw new Error('分组层级格式不正确');
    const node = item as unknown as CanvasNodeView;
    nodes.set(node.id, node);
  }
  if (nodes.size !== raw.length) throw new Error('视图包含重复节点');
  for (const node of nodes.values()) {
    const ancestors = new Set([node.id]);
    let parent = node.parentId;
    while (parent) {
      if (!nodes.has(parent) || ancestors.has(parent)) throw new Error('分组层级格式不正确');
      ancestors.add(parent);
      parent = nodes.get(parent)!.parentId;
    }
  }
  return [...nodes.values()];
}

function checkEdgeRoutes(raw: unknown): EdgeRouteSnapshot[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('路径视图格式不正确');
  const ids = new Set<string>();
  return raw.map((item) => {
    if (!isRecord(item) || !isText(item.canonicalEdgeId) || !ROUTE_STATES.has(typeof item.state === 'string' ? item.state : '') || !isRecord(item.source) || !isRecord(item.target) || !Array.isArray(item.points) || !isRecord(item.space) || !isText(item.endpointFingerprint)) {
      throw new Error('路径视图格式不正确');
    }
    if (ids.has(item.canonicalEdgeId)) throw new Error('路径视图包含重复关系');
    if (item.policyKey !== undefined && !isText(item.policyKey)) throw new Error('路径策略版本格式不正确');
    ids.add(item.canonicalEdgeId);
    if (!isText(item.source.nodeId) || !isText(item.target.nodeId)) throw new Error('路径视图格式不正确');
    if (item.source.portId !== undefined && !isText(item.source.portId)) throw new Error('路径视图格式不正确');
    if (item.target.portId !== undefined && !isText(item.target.portId)) throw new Error('路径视图格式不正确');
    if (item.source.handle !== undefined && !isText(item.source.handle)) throw new Error('路径视图格式不正确');
    if (item.target.handle !== undefined && !isText(item.target.handle)) throw new Error('路径视图格式不正确');
    if (item.space.kind !== 'world' && item.space.kind !== 'owner') throw new Error('路径视图格式不正确');
    if (item.space.kind === 'owner' && !isText(item.space.ownerId)) throw new Error('路径视图格式不正确');
    if (!item.points.length) throw new Error('路径视图格式不正确');
    for (const point of item.points) checkPoint(point, '路径视图格式不正确');
    if (item.label !== undefined) {
      if (!isRecord(item.label)) throw new Error('路径标签格式不正确');
      for (const key of ['x', 'y', 'width', 'height']) if (!isFiniteNumber(item.label[key])) throw new Error('路径标签格式不正确');
    }
    if (item.frozenBoundaries !== undefined) {
      if (!Array.isArray(item.frozenBoundaries)) throw new Error('冻结路径分段格式不正确');
      for (const segment of item.frozenBoundaries) {
        if (!isRecord(segment) || !isText(segment.ownerId) || !['source', 'target'].includes(String(segment.endpoint)) || !FROZEN_SIDES.has(segment.side as FrozenBoundarySide) || !Array.isArray(segment.points) || segment.points.length < 1) throw new Error('冻结路径分段格式不正确');
        for (const point of segment.points) checkPoint(point, '冻结路径分段格式不正确');
      }
    }
    return item as unknown as EdgeRouteSnapshot;
  });
}

function checkFrozenGroups(raw: unknown, nodes: readonly CanvasNodeView[]): FrozenGroupSnapshot[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('冻结组视图格式不正确');
  const nodeIds = new Set(nodes.map((node) => node.id));
  const groups: FrozenGroupSnapshot[] = [];
  const used = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.rootId) || !Array.isArray(item.memberIds) || !isRecord(item.worldBounds) || !Array.isArray(item.boundaryPorts) || !isText(item.createdAt)) {
      throw new Error('冻结组视图格式不正确');
    }
    if (groups.some((group) => group.id === item.id)) throw new Error('冻结组视图包含重复标识');
    if (!Number.isFinite(item.worldBounds.x) || !Number.isFinite(item.worldBounds.y) || !Number.isFinite(item.worldBounds.w) || !Number.isFinite(item.worldBounds.h)) throw new Error('冻结组视图格式不正确');
    if (!item.memberIds.every((id) => isText(id))) throw new Error('冻结组视图格式不正确');
    const memberIds = item.memberIds as string[];
    for (const id of [item.rootId, ...memberIds]) {
      if (used.has(id)) throw new Error('冻结组视图成员重叠');
      used.add(id);
      if (!nodeIds.has(id)) throw new Error('冻结组视图引用未知节点');
    }
    for (const port of item.boundaryPorts) {
      if (!isRecord(port) || !isText(port.edgeId) || !isText(port.nodeId) || !FROZEN_SIDES.has(port.side as FrozenBoundarySide)) throw new Error('冻结组边界端口格式不正确');
      if (port.handle !== undefined && !isText(port.handle)) throw new Error('冻结组边界端口格式不正确');
    }
    if (item.previousModes !== undefined) {
      if (!isRecord(item.previousModes) || Object.values(item.previousModes).some((mode) => mode !== undefined && !LAYOUT_MODES.has(String(mode)))) throw new Error('冻结前节点状态格式不正确');
    }
    if (item.previousRoutes !== undefined) checkEdgeRoutes(item.previousRoutes);
    if (item.frozenFrames !== undefined) {
      if (!isRecord(item.frozenFrames) || Object.values(item.frozenFrames).some((frame) => !isRecord(frame) || !isFiniteNumber(frame.width) || !isFiniteNumber(frame.height) || frame.width <= 0 || frame.height <= 0)) throw new Error('冻结框尺寸格式不正确');
    }
    if (item.protectedFrame !== undefined) {
      checkPoint(item.protectedFrame, '冻结保护框格式不正确');
      if (!isRecord(item.protectedFrame) || !isFiniteNumber(item.protectedFrame.width) || !isFiniteNumber(item.protectedFrame.height) || item.protectedFrame.width <= 0 || item.protectedFrame.height <= 0) throw new Error('冻结保护框格式不正确');
    }
    groups.push(item as unknown as FrozenGroupSnapshot);
  }
  return groups;
}

function checkTransition(raw: unknown): StageTransitionRecord | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isText(raw.toStageId) || !isText(raw.sourceRevision) || !isText(raw.targetRevision) || !isText(raw.startedAt) || !isFiniteNumber(raw.durationMs) || !Array.isArray(raw.placements) || !Array.isArray(raw.expanded)) {
    throw new Error('阶段切换记录格式不正确');
  }
  if (raw.fromStageId !== undefined && !isText(raw.fromStageId)) throw new Error('阶段切换记录格式不正确');
  if (!raw.expanded.every((id) => isText(id))) throw new Error('阶段切换记录格式不正确');
  for (const placement of raw.placements) {
    if (!isRecord(placement) || !isText(placement.nodeId) || !['provided', 'gap', 'expanded', 'relocated'].includes(String(placement.mode))) throw new Error('阶段切换记录格式不正确');
  }
  return raw as unknown as StageTransitionRecord;
}

function checkOverlay(raw: unknown): UserGraphOverlay | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.addedNodes) || !Array.isArray(raw.addedEdges) || !Array.isArray(raw.hiddenSourceNodeIds) || !Array.isArray(raw.hiddenSourceEdgeIds) || !Array.isArray(raw.edgeOverrides)) {
    throw new Error('用户覆盖层格式不正确');
  }
  return raw as unknown as UserGraphOverlay;
}

function checkContent(raw: UnknownRecord): CanvasBaselineContent {
  const nodes = checkNodeViews(raw.nodes);
  const edgeRoutes = checkEdgeRoutes(raw.edgeRoutes);
  const frozenGroups = checkFrozenGroups(raw.frozenGroups, nodes);
  const overlay = checkOverlay(raw.overlay);
  if (raw.displayRoutes !== undefined) {
    if (!Array.isArray(raw.displayRoutes)) throw new Error('投影路径快照格式不正确');
    for (const route of raw.displayRoutes) {
      if (isRecord(route) && route.policyKey !== undefined && !isText(route.policyKey)) throw new Error('投影路径策略版本格式不正确');
      if (isRecord(route) && route.barrierKey !== undefined && !isText(route.barrierKey)) throw new Error('投影路径障碍版本格式不正确');
      if (!isRecord(route) || !isText(route.id) || !isText(route.source) || !isText(route.target) || !isText(route.sourceHandle) || !isText(route.targetHandle) || typeof route.text !== 'string' || !Array.isArray(route.memberIds) || !route.memberIds.every(isText) || !Array.isArray(route.points) || route.points.length < 2 || !isRecord(route.label)) throw new Error('投影路径快照格式不正确');
      for (const point of route.points) checkPoint(point, '投影路径快照格式不正确');
      for (const bounds of [route.sourceBounds, route.targetBounds]) {
        checkPoint(bounds, '投影路径端点格式不正确');
        if (!isRecord(bounds) || !isFiniteNumber(bounds.w) || !isFiniteNumber(bounds.h)) throw new Error('投影路径端点格式不正确');
      }
      for (const key of ['x', 'y', 'width', 'height']) if (!isFiniteNumber(route.label[key])) throw new Error('投影路径标签格式不正确');
    }
  }
  return { nodes, edgeRoutes, frozenGroups, ...(overlay ? { overlay } : {}), ...(raw.displayRoutes ? { displayRoutes: raw.displayRoutes as NonNullable<CanvasBaselineContent['displayRoutes']> } : {}) };
}

function checkInheritance(raw: unknown): StageInheritanceBase | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isText(raw.parentId) || !isText(raw.parentRevision) || !isText(raw.targetRevision) || !isRecord(raw.parentContent) || !isRecord(raw.targetContent) || !isRecord(raw.targetStage) || !isRecord(raw.targetStage.graph) || !Array.isArray(raw.targetStage.graph.nodes) || !Array.isArray(raw.targetStage.graph.edges)) throw new Error('阶段继承基准格式不正确');
  checkContent(raw.parentContent); checkContent(raw.targetContent);
  assertValidGraph(raw.targetStage.graph as unknown as StageInheritanceBase['targetStage']['graph']);
  return raw as unknown as StageInheritanceBase;
}

function normalizeV1(view: UnknownRecord): CanvasWorkspaceView {
  const rawBaselines = view.baselines;
  if (!isRecord(rawBaselines)) throw new Error('工作视图格式不正确');
  const baselines: Record<string, CanvasWorkspaceView['baselines'][string]> = {};
  for (const [id, raw] of Object.entries(rawBaselines)) {
    if (!isRecord(raw) || !isText(raw.revision)) throw new Error('阶段视图格式不正确');
    const nodes = checkNodeViews(raw.nodes);
    const viewport = checkViewport(raw.viewport);
    baselines[id] = {
      revision: raw.revision,
      nodes,
      edgeRoutes: [],
      frozenGroups: [],
      ...(viewport ? { viewport } : {}),
    };
  }
  return { version: 2, baselineId: view.baselineId as string, baselines };
}

function normalizeV2(view: UnknownRecord): CanvasWorkspaceView {
  const rawBaselines = view.baselines;
  if (!isRecord(rawBaselines)) throw new Error('工作视图格式不正确');
  const baselines: Record<string, CanvasWorkspaceView['baselines'][string]> = {};
  for (const [id, raw] of Object.entries(rawBaselines)) {
    if (!isRecord(raw) || !isText(raw.revision)) throw new Error('阶段视图格式不正确');
    const content = checkContent(raw);
    let confirmed: CanvasBaselineContent | undefined;
    if (raw.confirmed !== undefined) {
      if (!isRecord(raw.confirmed)) throw new Error('阶段确认快照格式不正确');
      confirmed = checkContent(raw.confirmed);
    }
    if (raw.confirmedAt !== undefined && !isText(raw.confirmedAt)) throw new Error('阶段确认时间格式不正确');
    if (raw.confirmationId !== undefined && !isText(raw.confirmationId)) throw new Error('阶段确认标识格式不正确');
    const viewport = checkViewport(raw.viewport);
    const transition = checkTransition(raw.transition);
    const inheritance = checkInheritance(raw.inheritance);
    if (raw.sourceStage !== undefined) {
      if (!isRecord(raw.sourceStage) || !isRecord(raw.sourceStage.graph) || !Array.isArray(raw.sourceStage.graph.nodes) || !Array.isArray(raw.sourceStage.graph.edges)) throw new Error('来源基准格式不正确');
      assertValidGraph(raw.sourceStage.graph as unknown as StageInheritanceBase['targetStage']['graph']);
    }
    baselines[id] = {
      revision: raw.revision,
      ...content,
      ...(confirmed ? { confirmed } : {}),
      ...(raw.confirmedAt !== undefined ? { confirmedAt: raw.confirmedAt as string } : {}),
      ...(raw.confirmationId !== undefined ? { confirmationId: raw.confirmationId as string } : {}),
      ...(viewport ? { viewport } : {}),
      ...(transition ? { transition } : {}),
      ...(inheritance ? { inheritance } : {}),
      ...(raw.sourceStage ? {sourceStage:raw.sourceStage as unknown as StageInheritanceBase['targetStage']} : {}),
    };
  }
  return { version: 2, baselineId: view.baselineId as string, baselines };
}

/** Validate and migrate decoded records; legacy views remain drafts until explicit confirmation. */
export function normalizeWorkspaceView(value: unknown): CanvasWorkspaceView {
  if (!isRecord(value) || !isText(value.baselineId) || !isRecord(value.baselines)) throw new Error('工作视图格式不正确');
  if (value.version === 1) return normalizeV1(value);
  if (value.version === 2) return normalizeV2(value);
  throw new Error('工作视图格式不正确');
}

export function assertWorkspaceView(value: unknown): asserts value is CanvasWorkspaceView {
  normalizeWorkspaceView(value);
}

export function createLocalStorageViewStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): CanvasViewStorage {
  return {
    load(key) {
      const text = storage.getItem(key);
      if (text === null) return undefined;
      const view: unknown = JSON.parse(text);
      return normalizeWorkspaceView(view);
    },
    save(key, view) { storage.setItem(key, JSON.stringify(view)); },
  };
}
