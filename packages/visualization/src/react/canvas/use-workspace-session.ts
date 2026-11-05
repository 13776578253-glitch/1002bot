/** Workspace session owns per-stage/view drafts, history, confirmations and persistence; Canonical graphs stay shared. */
import { useCallback, useMemo, useRef, useState, type SetStateAction } from 'react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { VisualizationCanvasProps } from '../types.ts';
import type { CanvasNode } from '../model/grouping.ts';
import { baselineNodes } from '../model/hierarchy.ts';
import { baselineForView } from '../model/view-projection.ts';
import { restoreFrozenGroups } from '../model/frozen.ts';
import { confirmationIsCurrent, draftMatchesConfirmed } from '../model/confirmation.ts';
import { normalizeCardLayout } from '../model/normalize-card-layout.ts';
import { hierarchyProjection } from '../model/hierarchy.ts';
import { validateStoredRoutes } from '../model/edge-routes.ts';
import type { UserGraphOverlay } from '../model/overlay.ts';
import { captureContent, captureNodeViews, restoreNodeViews, ViewHistory, type CanvasBaselineContent, type CanvasBaselineView, type CanvasViewMode, type CanvasViewport, type CanvasWorkspaceView, type EdgeRouteSnapshot, type FrozenGroupSnapshot, type DisplayRouteSnapshot, type EdgeLabelPin } from '../model/workspace.ts';
import type { StageInheritanceBase } from '../model/snapshot-inheritance.ts';
import type { StageTransitionSuccess } from '../model/stage-transition.ts';
import { saveWorkspace } from '../persistence/storage-session.ts';
import { sceneGeometryKey } from '../model/label-snapshots.ts';

/** 单个阶段/视图会话的内容字段；revision、确认和继承元数据留在 CanvasBaselineView。 */
export interface CanvasSessionState {
  nodes: CanvasNode[];
  edgeRoutes: EdgeRouteSnapshot[];
  frozenGroups: FrozenGroupSnapshot[];
  overlay?: UserGraphOverlay;
  displayRoutes?: DisplayRouteSnapshot[];
  labelPins?: EdgeLabelPin[];
}
export const VIEW_MODES = ['overview', 'structure', 'full'] as const;
export const VIEW_LABELS: Record<CanvasViewMode, string> = { overview: 'Overview View', structure: 'Structure View', full: 'Full View' };
export type ViewTransition = StageTransitionSuccess & { inheritance?: StageInheritanceBase };
export { baselineNodes };

/** 只读取视图内容；revision、确认和继承等元数据仍由视图保留。 */
function contentOf(view: CanvasBaselineView): CanvasBaselineContent {
  return { nodes: view.nodes, edgeRoutes: view.edgeRoutes, frozenGroups: view.frozenGroups,
    ...(view.overlay ? { overlay: view.overlay } : {}), ...(view.displayRoutes ? { displayRoutes: view.displayRoutes } : {}), ...(view.labelPins?.length ? { labelPins: view.labelPins } : {}) };
}
/** 替换内容时保留 revision、确认、继承和来源阶段等视图元数据。 */
function replaceContent(view: CanvasBaselineView, content: CanvasBaselineContent): CanvasBaselineView {
  const { overlay: _overlay, displayRoutes: _display, labelPins: _pins, ...metadata } = view;
  return { ...metadata, ...content };
}

interface RestoredViewsMigration {
  views: Record<CanvasViewMode, Record<string, CanvasBaselineView>>;
  issues: Map<string, string>;
}

/** 在存储恢复边界一次性迁移旧卡版；当前规格视图不重写，确认快照保持不变。 */
export function migrateRestoredViews(
  restored: CanvasWorkspaceView | undefined,
  definitions: Record<CanvasViewMode, Map<string, VisualizationBaseline>>,
): RestoredViewsMigration {
  const source = restored?.views ?? { structure: restored?.baselines ?? {} };
  const views = structuredClone(source) as Record<CanvasViewMode, Record<string, CanvasBaselineView>>;
  for (const mode of VIEW_MODES) views[mode] ??= {};
  const issues = new Map<string, string>();
  for (const mode of VIEW_MODES) {
    for (const [id, view] of Object.entries(views[mode])) {
      const baseline = definitions[mode].get(id);
      if (!baseline) continue;
      const restoredNodes = restoreFrozenGroups(restoreNodeViews(baseline, baselineNodes(baseline), view.nodes), view.frozenGroups);
      if (restoredNodes.conflicts.length) continue;
      const normalized = normalizeCardLayout(restoredNodes.nodes, view.nodes, baseline.stage);
      if (normalized.conflict) { issues.set(`${mode}:${id}`, normalized.conflict.message); continue; }
      const normalizedById = new Map(normalized.nodes.map((node) => [node.id, node]));
      const changed = view.nodes.some((saved) => {
        const node = normalizedById.get(saved.id);
        return !!node && (node.type !== saved.type || node.width !== saved.width || node.height !== saved.height
          || node.position.x !== saved.position.x || node.position.y !== saved.position.y);
      });
      if (!changed) continue;
      const original = restoreNodeViews(baseline, baselineNodes(baseline), view.nodes, false);
      const routeIssue = validateStoredRoutes(original, normalized.nodes, view.edgeRoutes, hierarchyProjection(normalized.nodes, baseline.stage));
      if (routeIssue) { issues.set(`${mode}:${id}`, routeIssue); continue; }
      const captured = captureNodeViews(normalized.nodes);
      const byId = new Map(captured.map((node) => [node.id, node]));
      view.nodes = view.nodes.map((saved) => byId.get(saved.id) ?? saved);
      if (view.confirmed && !draftMatchesConfirmed(view)) view.requiresConfirmation = true;
    }
  }
  return { views, issues };
}

export function useWorkspaceSession(props: VisualizationCanvasProps, restored?: CanvasWorkspaceView) {
  const { baselines, persistence } = props;
  const initialMode = restored?.viewMode ?? 'structure';
  // 三个视图各自派生展示基线；Canonical Graph 仍由 baselines 共享。
  const definitions = useMemo(() => Object.fromEntries(VIEW_MODES.map((mode) => [mode, new Map(baselines.map((item) => [item.id, baselineForView(item, mode)]))])) as Record<CanvasViewMode, Map<string, typeof baselines[number]>>, [baselines]);
  const getBaseline = useCallback((id: string, mode: CanvasViewMode) => definitions[mode].get(id)!, [definitions]);
  // 恢复的工作区按视图深拷贝；缺失的视图补空对象，并在恢复边界完成卡片迁移。
  const [initialState] = useState(() => migrateRestoredViews(restored, definitions));
  // views 是同步可读的权威草稿；React state 只负责触发渲染。
  const views = useRef(initialState.views);
  const migrationIssues = initialState.issues;
  const [initialId] = useState(() => {
    const requested = restored && baselines.some((item) => item.id === restored.baselineId) ? restored.baselineId : props.initialBaselineId ?? baselines[baselines.length - 1]!.id;
    return VIEW_MODES.every((mode) => views.current[mode][requested]) ? requested : baselines[0]!.id;
  });
  const [viewMode, publishMode] = useState<CanvasViewMode>(initialMode), modeRef = useRef(viewMode);
  const [baselineId, publishId] = useState(initialId), idRef = useRef(baselineId);
  // 首次进入某视图时从基线生成草稿；sourceStage 保留来源快照供后续继承比较。
  const seed = useCallback((id: string, mode: CanvasViewMode): CanvasBaselineView => {
    const baseline = getBaseline(id, mode);
    return { revision: baseline.stage.graph.revision ?? baseline.stage.id, ...captureContent(baselineNodes(baseline)), sourceStage: structuredClone(baseline.stage) };
  }, [getBaseline]);
  for (const mode of VIEW_MODES) views.current[mode][initialId] ??= seed(initialId, mode);
  const normalizationMessage = useRef('');
  // 读取视图时先恢复节点与冻结组，再做卡片规格归一化和存储路径校验；冲突时保留原几何。
  const makeContent = useCallback((id: string, mode: CanvasViewMode): CanvasSessionState => {
    const baseline = getBaseline(id, mode), saved = views.current[mode][id]!;
    const frozen = restoreFrozenGroups(restoreNodeViews(baseline, baselineNodes(baseline), saved.nodes), saved.frozenGroups);
    if (frozen.conflicts.length) throw new Error(frozen.conflicts.map((item) => item.message).join('；'));
    const original = restoreNodeViews(baseline, baselineNodes(baseline), saved.nodes, false);
    const issue = migrationIssues.get(`${mode}:${id}`) ?? validateStoredRoutes(original, frozen.nodes, saved.edgeRoutes, hierarchyProjection(frozen.nodes, baseline.stage));
    normalizationMessage.current = issue ? `卡片规格调整冲突：${issue}` : '';
    const working = issue ? original : frozen.nodes;
    return { nodes: working, edgeRoutes: structuredClone(saved.edgeRoutes), frozenGroups: structuredClone(frozen.groups),
      ...(saved.overlay ? { overlay: structuredClone(saved.overlay) } : {}), displayRoutes: structuredClone(saved.displayRoutes ?? []), labelPins: structuredClone(saved.labelPins ?? []) };
  }, [getBaseline, migrationIssues]);
  const [initialContent] = useState(() => makeContent(initialId, initialMode));
  const [nodes, publishNodes] = useState(initialContent.nodes), nodesRef = useRef(nodes);
  const [edgeRoutes, publishRoutes] = useState(initialContent.edgeRoutes), routesRef = useRef(edgeRoutes);
  const [frozenGroups, publishFrozen] = useState(initialContent.frozenGroups), frozenRef = useRef(frozenGroups);
  const [overlay, publishOverlay] = useState(initialContent.overlay), overlayRef = useRef(overlay);
  const [displayRoutes, publishDisplay] = useState(initialContent.displayRoutes ?? []), displayRoutesRef = useRef(displayRoutes);
  const displayGeometry = useRef(sceneGeometryKey(initialContent.nodes));
  const [labelPins, publishLabelPins] = useState(initialContent.labelPins ?? []), labelPinsRef = useRef(labelPins);
  // 撤销/重做按阶段与视图隔离，刷新后不保留。
  const histories = useRef(new Map<string, ViewHistory>());
  // 历史只存内容对象；确认、继承和来源元数据通过 WeakMap 关联，不参与几何比较。
  const metadata = useRef(new WeakMap<CanvasBaselineContent, CanvasBaselineView>());
  const pending = useRef<CanvasBaselineContent | undefined>(undefined);
  const [, refresh] = useState(0);
  const [saveError, setSaveError] = useState('');
  const history = (id = idRef.current, mode = modeRef.current) => {
    const key = `${mode}:${id}`;
    let stack = histories.current.get(key);
    if (!stack) { stack = new ViewHistory(); histories.current.set(key, stack); }
    return stack;
  };
  const setNodes = useCallback((action: SetStateAction<CanvasNode[]>) => { const next = typeof action === 'function' ? action(nodesRef.current) : action; nodesRef.current = next; publishNodes(next); }, []);
  // 路径、冻结组或标签固定变化会使已渲染的显示路径失效。
  const setRoutes = useCallback((next: EdgeRouteSnapshot[]) => { if (next !== routesRef.current) displayGeometry.current = ''; routesRef.current = next; publishRoutes(next); }, []);
  const setFrozenGroups = useCallback((next: FrozenGroupSnapshot[]) => { if (next !== frozenRef.current) displayGeometry.current = ''; frozenRef.current = next; publishFrozen(next); }, []);
  const setOverlay = useCallback((next: UserGraphOverlay | undefined) => { overlayRef.current = next; publishOverlay(next); }, []);
  const setDisplayRoutes = useCallback((next: DisplayRouteSnapshot[], geometry = sceneGeometryKey(nodesRef.current), stageId = idRef.current, mode = modeRef.current) => {
    if (stageId !== idRef.current || mode !== modeRef.current || geometry !== sceneGeometryKey(nodesRef.current)) return false;
    displayGeometry.current = geometry;
    if (JSON.stringify(next) === JSON.stringify(displayRoutesRef.current)) return false;
    displayRoutesRef.current = next; publishDisplay(next); return true;
  }, []);
  const setLabelPins = useCallback((next: EdgeLabelPin[]) => { if (next !== labelPinsRef.current) displayGeometry.current = ''; labelPinsRef.current = next; publishLabelPins(next); }, []);
  // 当前帧的显示路径只有在几何匹配时才写入快照；过期缓存不进入历史或保存。
  const captureCurrent = useCallback(() => {
    const content = captureContent(nodesRef.current, routesRef.current, frozenRef.current, overlayRef.current, displayGeometry.current === sceneGeometryKey(nodesRef.current) ? displayRoutesRef.current : [], labelPinsRef.current);
    metadata.current.set(content, structuredClone(views.current[modeRef.current][idRef.current]!));
    return content;
  }, []);
  const storeCurrent = useCallback(() => {
    const mode = modeRef.current, id = idRef.current;
    views.current[mode][id] = replaceContent(views.current[mode][id]!, captureCurrent());
  }, [captureCurrent]);
  // baselines 是活动视图的兼容别名，views 才是全部视图的权威。
  // 保存时深拷贝工作区；异步写入失败只更新提示，不改当前状态。
  const save = useCallback((capture = true) => {
    if (capture) storeCurrent();
    if (!persistence) return;
    const view: CanvasWorkspaceView = { version: 2, baselineId: idRef.current, viewMode: modeRef.current, baselines: views.current[modeRef.current], views: views.current };
    void saveWorkspace(persistence.storage, persistence.key, structuredClone(view)).then(() => setSaveError(''),
      (error: unknown) => setSaveError(`保存失败：${error instanceof Error ? error.message : String(error)}`));
  }, [persistence, storeCurrent]);
  const publishContent = useCallback((state: CanvasSessionState) => {
    setNodes(state.nodes); setRoutes(state.edgeRoutes); setFrozenGroups(state.frozenGroups); setOverlay(state.overlay); setLabelPins(state.labelPins ?? []); setDisplayRoutes(state.displayRoutes ?? []);
  }, [setNodes, setRoutes, setFrozenGroups, setOverlay, setDisplayRoutes, setLabelPins]);
  // 只缓存与当前阶段、视图和节点几何一致的渲染帧；未完成事务或过期帧直接丢弃。
  const cacheRenderedRoutes = useCallback((routes: DisplayRouteSnapshot[], geometry: string, stageId: string, mode: CanvasViewMode) => {
    const changed = setDisplayRoutes(routes, geometry, stageId, mode);
    if (pending.current || stageId !== idRef.current || mode !== modeRef.current || geometry !== sceneGeometryKey(nodesRef.current)) return;
    const saved = views.current[modeRef.current][idRef.current]!;
    if (!changed && sceneGeometryKey(saved.nodes) === geometry) return;
    views.current[modeRef.current][idRef.current] = replaceContent(saved, captureCurrent());
    save(false);
  }, [setDisplayRoutes, captureCurrent, save]);
  // 一次手势或命令用 pending 捕获 before 内容；finish 只提交一次历史并保存。
  const begin = useCallback(() => { pending.current ??= captureCurrent(); }, [captureCurrent]);
  const finish = useCallback(() => {
    const before = pending.current; pending.current = undefined;
    if (!before) return;
    if (history().record(before, captureCurrent())) refresh((value) => value + 1);
    save();
  }, [captureCurrent, save]);
  const commit = useCallback((transform: (current: CanvasNode[]) => CanvasNode[]) => {
    const current = nodesRef.current, before = captureCurrent(), next = transform(current);
    if (next === current) return false;
    setNodes(next);
    const changed = history().record(before, captureCurrent());
    if (changed) { refresh((value) => value + 1); save(); }
    return changed;
  }, [captureCurrent, save, setNodes]);
  // 路径、冻结组或标签固定改变时清空显示路径缓存，避免复用旧约束下的几何。
  const commitContent = useCallback((transform: (current: CanvasSessionState) => CanvasSessionState | undefined) => {
    const before = captureCurrent();
    const current: CanvasSessionState = { nodes: nodesRef.current, edgeRoutes: routesRef.current, frozenGroups: frozenRef.current, ...(overlayRef.current ? { overlay: overlayRef.current } : {}), displayRoutes: displayRoutesRef.current, labelPins: labelPinsRef.current };
    const next = transform(current);
    if (!next || next === current) return false;
    const constraintsChanged = JSON.stringify([current.edgeRoutes, current.frozenGroups, current.labelPins]) !== JSON.stringify([next.edgeRoutes, next.frozenGroups, next.labelPins]);
    publishContent({ ...next, displayRoutes: constraintsChanged ? [] : next.displayRoutes ?? displayRoutesRef.current, labelPins: next.labelPins ?? labelPinsRef.current });
    const changed = history().record(before, captureCurrent());
    if (changed) { refresh((value) => value + 1); save(); }
    return changed;
  }, [captureCurrent, publishContent, save]);
  // 撤销/重做恢复内容，同时恢复确认、继承和来源阶段等元数据；元数据不进入几何历史。
  const travel = useCallback((direction: 'undo' | 'redo') => {
    const stack = history();
    if (direction === 'undo' ? !stack.canUndo : !stack.canRedo) return;
    pending.current = undefined;
    const content = stack[direction](captureCurrent());
    const old = metadata.current.get(content), current = views.current[modeRef.current][idRef.current]!;
    const { inheritance: _inheritance, transition: _transition, sourceStage: _source, requiresConfirmation: _review, ...retained } = current;
    const sourceStage = old?.sourceStage ?? current.sourceStage;
    views.current[modeRef.current][idRef.current] = replaceContent({ ...retained,
      ...(old?.inheritance ? { inheritance: old.inheritance } : {}), ...(old?.transition ? { transition: old.transition } : {}),
      ...(old?.requiresConfirmation !== undefined ? { requiresConfirmation: old.requiresConfirmation } : {}),
      ...(sourceStage ? { sourceStage } : {}), revision: old?.revision ?? current.revision }, content);
    publishContent(makeContent(idRef.current, modeRef.current));
    refresh((value) => value + 1); save();
  }, [captureCurrent, makeContent, publishContent, save]);
  const switchBaseline = useCallback((id: string) => {
    pending.current = undefined; idRef.current = id; publishId(id);
    publishContent(makeContent(id, modeRef.current)); save(false);
  }, [makeContent, publishContent, save]);
  const switchView = useCallback((mode: CanvasViewMode) => {
    if (mode === modeRef.current) return '';
    pending.current = undefined; modeRef.current = mode; publishMode(mode);
    publishContent(makeContent(idRef.current, mode)); save(false);
    return normalizationMessage.current;
  }, [makeContent, publishContent, save]);
  // 三个视图在同一轮写入；提交前由导航逻辑保证结果完整，失败只保留预览。
  // reused 表示直接恢复已有视图且继承基准仍有效；确认要求沿用原记录。
  const applyStageTransitions = useCallback((targetId: string, results: Record<CanvasViewMode, ViewTransition>) => {
    storeCurrent(); pending.current = undefined;
    for (const mode of VIEW_MODES) {
      const result = results[mode], old = views.current[mode][targetId];
      const before = old ? structuredClone(contentOf(old)) : result.base;
      if (old) metadata.current.set(before, structuredClone(old));
      const next: CanvasBaselineView = { ...replaceContent(old ?? { revision: result.record.targetRevision, ...result.base }, result.content), revision: result.record.targetRevision, transition: result.record,
        requiresConfirmation: 'reused' in result && result.reused ? old?.requiresConfirmation ?? false : true,
        ...(old?.confirmed ? { confirmedRevision: old.confirmedRevision ?? old.revision } : {}),
        ...(result.inheritance ? { inheritance: result.inheritance } : {}), sourceStage: structuredClone(getBaseline(targetId, mode).stage) };
      views.current[mode][targetId] = next;
      metadata.current.set(result.content, structuredClone(next));
      history(targetId, mode).record(before, result.content);
    }
    idRef.current = targetId; publishId(targetId);
    publishContent(makeContent(targetId, modeRef.current)); refresh((value) => value + 1); save();
  }, [storeCurrent, getBaseline, makeContent, publishContent, save]);
  // 确认写入当前内容副本与来源修订；后续阶段以该副本为父基础。
  const confirm = useCallback((renderedRoutes?: DisplayRouteSnapshot[]) => {
    if (renderedRoutes) setDisplayRoutes(renderedRoutes);
    storeCurrent();
    const mode = modeRef.current, id = idRef.current, baseline = getBaseline(id, mode), content = captureCurrent();
    views.current[mode][id] = { ...views.current[mode][id]!, ...content, requiresConfirmation: false, confirmed: structuredClone(content), confirmedAt: new Date().toISOString(), confirmationId: crypto.randomUUID(), revision: baseline.stage.graph.revision ?? baseline.stage.id, confirmedRevision: baseline.stage.graph.revision ?? baseline.stage.id, sourceStage: structuredClone(baseline.stage) };
    refresh((value) => value + 1); save();
  }, [captureCurrent, getBaseline, setDisplayRoutes, storeCurrent, save]);
  // 读取当前视图前先写入最新内容，保证导航与预览使用同一版本。
  const getSavedContent = useCallback((id: string, mode = modeRef.current) => {
    if (id === idRef.current && mode === modeRef.current) storeCurrent();
    const saved = views.current[mode][id];
    return saved ? { content: contentOf(saved), revision: saved.revision, inheritance: saved.inheritance, sourceStage: saved.sourceStage } : undefined;
  }, [storeCurrent]);
  const getConfirmedContent = useCallback((id: string, mode = modeRef.current) => views.current[mode][id]?.confirmed, []);
  // 只有确认时的来源修订仍匹配当前基线，确认版本才可用于后续继承。
  const getConfirmedRevision = useCallback((id: string, mode = modeRef.current) => {
    const saved = views.current[mode][id], baseline = getBaseline(id, mode);
    if (!saved) return undefined;
    const revision = baseline.stage.graph.revision ?? baseline.stage.id;
    return confirmationIsCurrent(saved, revision) ? saved.confirmedRevision ?? saved.revision : undefined;
  }, [getBaseline]);
  // 视口属于视图草稿；有未完成事务时只更新内存，等事务结束再保存。
  const saveViewport = useCallback((viewport: CanvasViewport) => { views.current[modeRef.current][idRef.current]!.viewport = viewport; if (!pending.current) save(false); }, [save]);
  return {
    nodes, nodesRef, setNodes, edgeRoutes, routesRef, frozenGroups, frozenRef, overlay, overlayRef, labelPins, labelPinsRef, setLabelPins,
    setRoutes, setFrozenGroups, setOverlay, setDisplayRoutes, cacheRenderedRoutes, displayRoutes, displayRoutesRef, commitContent,
    baselineId, baseline: getBaseline(baselineId, viewMode), viewMode, switchView, getBaseline,
    // 旧阶段缺少三视图时只提示迁移，不自动改写历史。
    initializationMessage: normalizationMessage.current || (restored?.baselineId && restored.baselineId !== initialId ? '旧阶段尚未建立三个视图，先确认首阶段的三个视图；原有阶段草稿和快照已保留' : !restored && props.initialBaselineId && props.initialBaselineId !== initialId ? '目标阶段尚未建立三个视图，请先确认首阶段的三个视图' : ''),
    initialViewport: views.current[initialMode][initialId]?.viewport,
    getViewport: (id: string, mode = modeRef.current) => views.current[mode][id]?.viewport, saveViewport,
    begin, finish, commit, switchBaseline, applyStageTransitions, confirm, getConfirmedContent, getConfirmedRevision, getSavedContent, transactionPending: () => !!pending.current,
    undo: () => travel('undo'), redo: () => travel('redo'), canUndo: history().canUndo, canRedo: history().canRedo, saveError, retrySave: () => save(),
    transition: views.current[viewMode][baselineId]?.transition, confirmedAt: views.current[viewMode][baselineId]?.confirmedAt,
    confirmationStatus: VIEW_MODES.map((mode) => {
      const saved = views.current[mode][baselineId], source = getBaseline(baselineId, mode);
      const revision = source.stage.graph.revision ?? source.stage.id;
      return { mode, confirmed: !!saved?.confirmed, current: !!saved && confirmationIsCurrent(saved, revision) };
    }),
  };
}
