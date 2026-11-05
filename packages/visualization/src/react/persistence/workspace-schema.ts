/** Workspace schema owns persisted-view validation and v1/v2 migration; it performs no storage access. */
import type {
  CanvasBaselineContent,
  CanvasNodeView,
  CanvasViewport,
  CanvasViewMode,
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
const VIEW_MODES = new Set<CanvasViewMode>(['overview', 'structure', 'full']);
/** 错误文案是调用方与测试依赖的稳定合同，保持不变。 */
const NODE_ERROR = '节点视图格式不正确';
const ROUTE_ERROR = '路径视图格式不正确';
const FROZEN_ERROR = '冻结组视图格式不正确';
const PIN_ERROR = '标签固定位置格式不正确';
const DISPLAY_ERROR = '投影路径快照格式不正确';
const TRANSITION_ERROR = '阶段切换记录格式不正确';
const LABEL_ERROR = '路径标签格式不正确';

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalText(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isText(value)) throw new Error(message);
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkPoint(value: unknown, message: string): { x: number; y: number } {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) throw new Error(message);
  return { x: value.x, y: value.y };
}

function checkRectFields(value: UnknownRecord, message: string): void {
  for (const key of ['x', 'y', 'width', 'height']) if (!isFiniteNumber(value[key])) throw new Error(message);
}

function checkBounds(value: unknown, message: string): void {
  checkPoint(value, message);
  if (!isRecord(value) || !isFiniteNumber(value.w) || !isFiniteNumber(value.h)) throw new Error(message);
}

function checkViewport(raw: unknown): CanvasViewport | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.zoom) || !(raw.zoom > 0)) {
    throw new Error('视口格式不正确');
  }
  return { x: raw.x, y: raw.y, zoom: raw.zoom };
}

/** 两遍校验节点：先查重复 ID，再查形状与父链；错误优先级保持不变。 */
function checkNodeViews(raw: unknown): CanvasNodeView[] {
  if (!Array.isArray(raw)) throw new Error('阶段视图格式不正确');
  // 两遍扫描保持原有错误优先级：重复 ID 先于节点形状错误。
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || !isText(item.id)) continue;
    if (seen.has(item.id)) throw new Error('视图包含重复节点');
    seen.add(item.id);
  }
  const nodes = new Map<string, CanvasNodeView>();
  for (const item of raw) {
    if (!isRecord(item)) throw new Error(NODE_ERROR);
    if (!isText(item.id) || typeof item.type !== 'string' || !NODE_TYPES.has(item.type) || !isRecord(item.data) || !isRecord(item.position)) {
      throw new Error(NODE_ERROR);
    }
    if (!isFiniteNumber(item.position.x) || !isFiniteNumber(item.position.y) || !isFiniteNumber(item.width) || !isFiniteNumber(item.height) || !(item.width > 0) || !(item.height > 0)) {
      throw new Error(NODE_ERROR);
    }
    if (!LAYOUT_MODES.has(typeof item.data.layoutMode === 'string' ? item.data.layoutMode : 'free')) throw new Error(NODE_ERROR);
    if (item.data.frozen !== undefined && typeof item.data.frozen !== 'boolean') throw new Error(NODE_ERROR);
    if (item.data.expanded !== undefined && typeof item.data.expanded !== 'boolean') throw new Error(NODE_ERROR);
    if (item.data.layoutEdits !== undefined) {
      const edits = item.data.layoutEdits;
      if (!isRecord(edits) || edits.version !== 1) throw new Error('布局编辑意图格式不正确');
      if (edits.position !== undefined) {
        checkPoint(edits.position, '布局位置编辑格式不正确');
        if (!isRecord(edits.position) || !['user', 'legacy'].includes(String(edits.position.origin)) || edits.position.parentId !== undefined && !isText(edits.position.parentId)) throw new Error('布局位置编辑格式不正确');
      }
      if (edits.sizes !== undefined) {
        if (!isRecord(edits.sizes)) throw new Error('布局尺寸编辑格式不正确');
        for (const state of ['collapsed', 'expanded']) {
          const size = edits.sizes[state];
          if (size !== undefined && (!isRecord(size) || !isFiniteNumber(size.width) || !isFiniteNumber(size.height) || size.width <= 0 || size.height <= 0 || !['user', 'legacy'].includes(String(size.origin)))) throw new Error('布局尺寸编辑格式不正确');
        }
      }
    }
    if (item.parentId !== undefined && !isText(item.parentId)) throw new Error('分组层级格式不正确');
    const node = item as unknown as CanvasNodeView;
    nodes.set(node.id, node);
  }
  if (nodes.size !== raw.length) throw new Error('视图包含重复节点');
  // 父链必须闭合且无环；缺失父级与环使用同一层级错误。
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

/** 校验持久化路径；标签与冻结分段是可选字段，非法时直接失败。 */
function checkEdgeRoutes(raw: unknown): EdgeRouteSnapshot[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(ROUTE_ERROR);
  const ids = new Set<string>();
  return raw.map((item) => {
    if (!isRecord(item) || !isText(item.canonicalEdgeId) || !ROUTE_STATES.has(typeof item.state === 'string' ? item.state : '') || !isRecord(item.source) || !isRecord(item.target) || !Array.isArray(item.points) || !isRecord(item.space) || !isText(item.endpointFingerprint)) {
      throw new Error(ROUTE_ERROR);
    }
    // 同一 canonicalEdgeId 只能出现一次。
    if (ids.has(item.canonicalEdgeId)) throw new Error('路径视图包含重复关系');
    if (item.policyKey !== undefined && !isText(item.policyKey)) throw new Error('路径策略版本格式不正确');
    ids.add(item.canonicalEdgeId);
    if (!isText(item.source.nodeId) || !isText(item.target.nodeId)) throw new Error(ROUTE_ERROR);
    if (item.source.portId !== undefined && !isText(item.source.portId)) throw new Error(ROUTE_ERROR);
    if (item.target.portId !== undefined && !isText(item.target.portId)) throw new Error(ROUTE_ERROR);
    if (item.source.handle !== undefined && !isText(item.source.handle)) throw new Error(ROUTE_ERROR);
    if (item.target.handle !== undefined && !isText(item.target.handle)) throw new Error(ROUTE_ERROR);
    if (item.space.kind !== 'world' && item.space.kind !== 'owner') throw new Error(ROUTE_ERROR);
    if (item.space.kind === 'owner' && !isText(item.space.ownerId)) throw new Error(ROUTE_ERROR);
    if (!item.points.length) throw new Error(ROUTE_ERROR);
    for (const point of item.points) checkPoint(point, ROUTE_ERROR);
    if (item.label !== undefined) {
      if (!isRecord(item.label)) throw new Error(LABEL_ERROR);
      checkRectFields(item.label, LABEL_ERROR);
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

/** 校验冻结组；成员不得重叠，且必须引用当前阶段节点。 */
function checkFrozenGroups(raw: unknown, nodes: readonly CanvasNodeView[]): FrozenGroupSnapshot[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(FROZEN_ERROR);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const groups: FrozenGroupSnapshot[] = [];
  // 成员集合全局唯一，根节点也算成员。
  const used = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.rootId) || !Array.isArray(item.memberIds) || !isRecord(item.worldBounds) || !Array.isArray(item.boundaryPorts) || !isText(item.createdAt)) {
      throw new Error(FROZEN_ERROR);
    }
    if (groups.some((group) => group.id === item.id)) throw new Error('冻结组视图包含重复标识');
    if (!Number.isFinite(item.worldBounds.x) || !Number.isFinite(item.worldBounds.y) || !Number.isFinite(item.worldBounds.w) || !Number.isFinite(item.worldBounds.h)) throw new Error(FROZEN_ERROR);
    if (!item.memberIds.every((id) => isText(id))) throw new Error(FROZEN_ERROR);
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

/** 校验阶段切换记录；placements 的模式限定在已知集合。 */
function checkTransition(raw: unknown): StageTransitionRecord | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isText(raw.toStageId) || !isText(raw.sourceRevision) || !isText(raw.targetRevision) || !isText(raw.startedAt) || !isFiniteNumber(raw.durationMs) || !Array.isArray(raw.placements) || !Array.isArray(raw.expanded)) {
    throw new Error(TRANSITION_ERROR);
  }
  if (raw.fromStageId !== undefined && !isText(raw.fromStageId)) throw new Error(TRANSITION_ERROR);
  if (!raw.expanded.every((id) => isText(id))) throw new Error(TRANSITION_ERROR);
  for (const placement of raw.placements) {
    if (!isRecord(placement) || !isText(placement.nodeId) || !['provided', 'gap', 'expanded', 'relocated'].includes(String(placement.mode))) throw new Error(TRANSITION_ERROR);
  }
  return raw as unknown as StageTransitionRecord;
}

/** 覆盖层只校验顶层数组形状；元素级校验仍是已记录缺口。 */
function checkOverlay(raw: unknown): UserGraphOverlay | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.addedNodes) || !Array.isArray(raw.addedEdges) || !Array.isArray(raw.hiddenSourceNodeIds) || !Array.isArray(raw.hiddenSourceEdgeIds) || !Array.isArray(raw.edgeOverrides)) {
    throw new Error('用户覆盖层格式不正确');
  }
  return raw as unknown as UserGraphOverlay;
}

/** 汇总内容校验；节点、路径、冻结组、覆盖层、标签固定和投影路径依次读取。 */
function checkContent(raw: UnknownRecord): CanvasBaselineContent {
  const nodes = checkNodeViews(raw.nodes);
  const edgeRoutes = checkEdgeRoutes(raw.edgeRoutes);
  const frozenGroups = checkFrozenGroups(raw.frozenGroups, nodes);
  const overlay = checkOverlay(raw.overlay);
  if (raw.labelPins !== undefined) {
    if (!Array.isArray(raw.labelPins)) throw new Error(PIN_ERROR);
    const ids = new Set<string>();
    for (const pin of raw.labelPins) {
      if (!isRecord(pin) || !isText(pin.id) || !isText(pin.source) || !isText(pin.target) || !Array.isArray(pin.memberIds) || !pin.memberIds.length || !pin.memberIds.every(isText) || new Set(pin.memberIds).size !== pin.memberIds.length || !isRecord(pin.label)) throw new Error(PIN_ERROR);
      checkRectFields(pin.label, PIN_ERROR);
      if (Number(pin.label.width) <= 0 || Number(pin.label.height) <= 0) throw new Error(PIN_ERROR);
      if (pin.memberFingerprints !== undefined && (!isRecord(pin.memberFingerprints) || Object.keys(pin.memberFingerprints).length !== pin.memberIds.length || pin.memberIds.some((id) => !isText((pin.memberFingerprints as UnknownRecord)[String(id)])))) throw new Error('标签固定身份格式不正确');
      const key = JSON.stringify([pin.id, pin.source, pin.target, [...pin.memberIds].sort()]);
      if (ids.has(key)) throw new Error('标签固定位置重复');
      ids.add(key);
    }
  }
  let displayRoutes: CanvasBaselineContent['displayRoutes'];
  if (raw.displayRoutes !== undefined) {
    if (!Array.isArray(raw.displayRoutes)) throw new Error(DISPLAY_ERROR);
    for (const route of raw.displayRoutes) {
      if (!isRecord(route)) throw new Error(DISPLAY_ERROR);
      if (route.policyKey !== undefined && !isText(route.policyKey)) throw new Error('投影路径策略版本格式不正确');
      if (route.barrierKey !== undefined && !isText(route.barrierKey)) throw new Error('投影路径障碍版本格式不正确');
      if (!isText(route.id) || !isText(route.source) || !isText(route.target) || !isText(route.sourceHandle) || !isText(route.targetHandle) || typeof route.text !== 'string' || !Array.isArray(route.memberIds) || !route.memberIds.every(isText) || !Array.isArray(route.points) || route.points.length < 2 || !isRecord(route.label)) throw new Error(DISPLAY_ERROR);
      for (const point of route.points) checkPoint(point, DISPLAY_ERROR);
      for (const bounds of [route.sourceBounds, route.targetBounds]) checkBounds(bounds, '投影路径端点格式不正确');
      checkRectFields(route.label, '投影路径标签格式不正确');
    }
    // 旧的自动标签附着是可丢弃缓存；非法附件只剥离元数据，路径几何保留。
    displayRoutes = raw.displayRoutes.map((rawRoute) => {
      const route = structuredClone(rawRoute) as UnknownRecord, anchor = route.labelAttachment;
      const validPoint = (point: unknown) => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y);
      const valid = isText(route.labelPolicyKey) && isText(route.labelIdentity) && isText(route.labelRouteKey) && isRecord(anchor)
        && ['horizontal', 'vertical', 'diagonal'].includes(String(anchor.axis)) && ['inline', 'negative', 'positive'].includes(String(anchor.side))
        && isFiniteNumber(anchor.fraction) && anchor.fraction >= 0 && anchor.fraction <= 1
        && isFiniteNumber(anchor.pathFraction) && anchor.pathFraction >= 0 && anchor.pathFraction <= 1 && isFiniteNumber(anchor.offset)
        && ['from', 'to', 'projected', 'pathStart', 'pathEnd'].every((key) => validPoint(anchor[key]));
      if (!valid) { delete route.labelAttachment; delete route.labelIdentity; delete route.labelPolicyKey; delete route.labelRouteKey; }
      return route as unknown as NonNullable<CanvasBaselineContent['displayRoutes']>[number];
    });
  }
  return { nodes, edgeRoutes, frozenGroups, ...(overlay ? { overlay } : {}), ...(displayRoutes ? { displayRoutes } : {}), ...(Array.isArray(raw.labelPins) && raw.labelPins.length ? { labelPins: structuredClone(raw.labelPins) as NonNullable<CanvasBaselineContent['labelPins']> } : {}) };
}

/** 继承基准同时校验父/目标内容与目标图结构。 */
function checkInheritance(raw: unknown): StageInheritanceBase | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isText(raw.parentId) || !isText(raw.parentRevision) || !isText(raw.targetRevision) || !isRecord(raw.parentContent) || !isRecord(raw.targetContent) || !isRecord(raw.targetStage) || !isRecord(raw.targetStage.graph) || !Array.isArray(raw.targetStage.graph.nodes) || !Array.isArray(raw.targetStage.graph.edges)) throw new Error('阶段继承基准格式不正确');
  checkContent(raw.parentContent); checkContent(raw.targetContent);
  assertValidGraph(raw.targetStage.graph as unknown as StageInheritanceBase['targetStage']['graph']);
  return raw as unknown as StageInheritanceBase;
}

/** 基线条目先校验稳定 ID 和源修订，随后才读取视图内容。 */
function checkBaseline(id: string, raw: unknown): asserts raw is UnknownRecord & { revision: string } {
  if (!isText(id) || !isRecord(raw) || !isText(raw.revision)) throw new Error('阶段视图格式不正确');
}

/** v1 只保留节点和视口；路径与冻结账本为空，确认信息不补造。 */
function normalizeV1(view: UnknownRecord): CanvasWorkspaceView {
  const rawBaselines = view.baselines;
  if (!isRecord(rawBaselines)) throw new Error('工作视图格式不正确');
  const baselines: Record<string, CanvasWorkspaceView['baselines'][string]> = {};
  for (const [id, raw] of Object.entries(rawBaselines)) {
    checkBaseline(id, raw);
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

/** v2 校验内容与确认元数据；确认字段必须成组出现。 */
function normalizeV2(view: UnknownRecord): CanvasWorkspaceView {
  const rawBaselines = view.baselines;
  if (!isRecord(rawBaselines)) throw new Error('工作视图格式不正确');
  const baselines: Record<string, CanvasWorkspaceView['baselines'][string]> = {};
  for (const [id, raw] of Object.entries(rawBaselines)) {
    checkBaseline(id, raw);
    const content = checkContent(raw);
    let confirmed: CanvasBaselineContent | undefined;
    if (raw.confirmed !== undefined) {
      if (!isRecord(raw.confirmed)) throw new Error('阶段确认快照格式不正确');
      confirmed = checkContent(raw.confirmed);
    }
    // 确认字段必须成组出现；来源修订只记录确认时的版本，不改写历史内容。
    const confirmedAt = optionalText(raw.confirmedAt, '阶段确认时间格式不正确');
    const confirmationId = optionalText(raw.confirmationId, '阶段确认标识格式不正确');
    if (confirmationId !== undefined && (!confirmed || confirmedAt === undefined)) throw new Error('阶段确认标识格式不正确');
    const confirmedRevision = optionalText(raw.confirmedRevision, '阶段确认来源版本格式不正确');
    if (confirmedRevision !== undefined && !confirmed) throw new Error('阶段确认来源版本格式不正确');
    if (raw.requiresConfirmation !== undefined && typeof raw.requiresConfirmation !== 'boolean') throw new Error('阶段确认状态格式不正确');
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
      ...(confirmedAt !== undefined ? { confirmedAt } : {}),
      ...(confirmationId !== undefined ? { confirmationId } : {}),
      ...(confirmedRevision !== undefined ? { confirmedRevision } : {}),
      ...(raw.requiresConfirmation !== undefined ? { requiresConfirmation: raw.requiresConfirmation as boolean } : {}),
      ...(viewport ? { viewport } : {}),
      ...(transition ? { transition } : {}),
      ...(inheritance ? { inheritance } : {}),
      ...(raw.sourceStage ? {sourceStage:raw.sourceStage as unknown as StageInheritanceBase['targetStage']} : {}),
    };
  }
  return { version: 2, baselineId: view.baselineId as string, baselines };
}

/** 校验并迁移解码记录；旧视图在显式确认前保持草稿。 */
export function normalizeWorkspaceView(value: unknown): CanvasWorkspaceView {
  if (!isRecord(value) || !isText(value.baselineId) || !isRecord(value.baselines)) throw new Error('工作视图格式不正确');
  const active = value.version === 1 ? normalizeV1(value) : value.version === 2 ? normalizeV2(value) : undefined;
  if (!active) throw new Error('工作视图格式不正确');
  if (value.viewMode !== undefined && !VIEW_MODES.has(value.viewMode as CanvasViewMode)) throw new Error('工作视图类型不正确');
  // 旧记录缺少 views 时只补 Structure 视图；不补造确认。
  if (value.views === undefined) {
    if (value.viewMode !== undefined && value.viewMode !== 'structure') throw new Error('工作视图类型缺少对应内容');
    return { ...active, viewMode: 'structure', views: { structure: structuredClone(active.baselines) } };
  }
  if (!isRecord(value.views) || value.viewMode === undefined) throw new Error('工作视图集合格式不正确');
  const viewMode = value.viewMode as CanvasViewMode;
  const views: NonNullable<CanvasWorkspaceView['views']> = {};
  for (const [mode, baselines] of Object.entries(value.views)) {
    if (!VIEW_MODES.has(mode as CanvasViewMode) || !isRecord(baselines)) throw new Error('工作视图集合格式不正确');
    views[mode as CanvasViewMode] = normalizeV2({ baselineId: value.baselineId, baselines }).baselines;
  }
  if (!views[viewMode]) {
    if (Object.keys(active.baselines).length) throw new Error('当前工作视图缺少对应内容');
    views[viewMode] = {};
  }
  // 排序后比较，忽略对象键顺序。
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])])) : item;
  if (JSON.stringify(ordered(active.baselines)) !== JSON.stringify(ordered(views[viewMode]))) throw new Error('当前工作视图与视图集合不一致');
  return { ...active, viewMode, views };
}

/** 断言入口；失败沿用 normalizeWorkspaceView 的错误文案。 */
export function assertWorkspaceView(value: unknown): asserts value is CanvasWorkspaceView {
  normalizeWorkspaceView(value);
}
