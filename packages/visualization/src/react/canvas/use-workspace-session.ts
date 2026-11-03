/** Independent stage/view transactions and persisted snapshots; canonical graphs stay shared. */
import { useCallback, useMemo, useRef, useState, type SetStateAction } from 'react';
import type { VisualizationCanvasProps } from '../types.ts';
import type { CanvasNode } from '../model/grouping.ts';
import { baselineNodes } from '../model/hierarchy.ts';
import { baselineForView } from '../model/view-projection.ts';
import { restoreFrozenGroups } from '../model/frozen.ts';
import { confirmationIsCurrent } from '../model/confirmation.ts';
import { normalizeCardLayout } from '../model/normalize-card-layout.ts';
import { hierarchyProjection } from '../model/hierarchy.ts';
import { validateStoredRoutes } from '../model/edge-routes.ts';
import type { UserGraphOverlay } from '../model/overlay.ts';
import { captureContent, restoreNodeViews, ViewHistory, type CanvasBaselineContent, type CanvasBaselineView, type CanvasViewMode, type CanvasViewport, type CanvasWorkspaceView, type EdgeRouteSnapshot, type FrozenGroupSnapshot, type DisplayRouteSnapshot } from '../model/workspace.ts';
import type { StageInheritanceBase } from '../model/snapshot-inheritance.ts';
import type { StageTransitionSuccess } from '../model/stage-transition.ts';
import { saveWorkspace } from '../persistence/storage-session.ts';

export interface CanvasSessionState {
  nodes: CanvasNode[];
  edgeRoutes: EdgeRouteSnapshot[];
  frozenGroups: FrozenGroupSnapshot[];
  overlay?: UserGraphOverlay;
  displayRoutes?: DisplayRouteSnapshot[];
}
export const VIEW_MODES = ['overview', 'structure', 'full'] as const;
export const VIEW_LABELS: Record<CanvasViewMode, string> = { overview: 'Overview View', structure: 'Structure View', full: 'Full View' };
export type ViewTransition = StageTransitionSuccess & { inheritance?: StageInheritanceBase };
export { baselineNodes };

function contentOf(view: CanvasBaselineView): CanvasBaselineContent {
  return { nodes: view.nodes, edgeRoutes: view.edgeRoutes, frozenGroups: view.frozenGroups,
    ...(view.overlay ? { overlay: view.overlay } : {}), ...(view.displayRoutes ? { displayRoutes: view.displayRoutes } : {}) };
}
function replaceContent(view: CanvasBaselineView, content: CanvasBaselineContent): CanvasBaselineView {
  const { overlay: _overlay, displayRoutes: _display, ...metadata } = view;
  return { ...metadata, ...content };
}

export function useWorkspaceSession(props: VisualizationCanvasProps, restored?: CanvasWorkspaceView) {
  const { baselines, persistence } = props;
  const initialMode = restored?.viewMode ?? 'structure';
  const definitions = useMemo(() => Object.fromEntries(VIEW_MODES.map((mode) => [mode, new Map(baselines.map((item) => [item.id, baselineForView(item, mode)]))])) as Record<CanvasViewMode, Map<string, typeof baselines[number]>>, [baselines]);
  const getBaseline = useCallback((id: string, mode: CanvasViewMode) => definitions[mode].get(id)!, [definitions]);
  const [initialViews] = useState(() => {
    const views = structuredClone(restored?.views ?? { structure: restored?.baselines ?? {} });
    for (const mode of VIEW_MODES) views[mode] ??= {};
    return views as Record<CanvasViewMode, Record<string, CanvasBaselineView>>;
  });
  const views = useRef(initialViews);
  const [initialId] = useState(() => {
    const requested = restored && baselines.some((item) => item.id === restored.baselineId) ? restored.baselineId : props.initialBaselineId ?? baselines[baselines.length - 1]!.id;
    return VIEW_MODES.every((mode) => views.current[mode][requested]) ? requested : baselines[0]!.id;
  });
  const [viewMode, publishMode] = useState<CanvasViewMode>(initialMode), modeRef = useRef(viewMode);
  const [baselineId, publishId] = useState(initialId), idRef = useRef(baselineId);
  const seed = useCallback((id: string, mode: CanvasViewMode): CanvasBaselineView => {
    const baseline = getBaseline(id, mode);
    return { revision: baseline.stage.graph.revision ?? baseline.stage.id, ...captureContent(baselineNodes(baseline)), sourceStage: structuredClone(baseline.stage) };
  }, [getBaseline]);
  for (const mode of VIEW_MODES) views.current[mode][initialId] ??= seed(initialId, mode);
  const normalizationMessage = useRef('');
  const makeContent = useCallback((id: string, mode: CanvasViewMode): CanvasSessionState => {
    const baseline = getBaseline(id, mode), saved = views.current[mode][id]!;
    const frozen = restoreFrozenGroups(restoreNodeViews(baseline, baselineNodes(baseline), saved.nodes), saved.frozenGroups);
    if (frozen.conflicts.length) throw new Error(frozen.conflicts.map((item) => item.message).join('；'));
    const original = restoreNodeViews(baseline, baselineNodes(baseline), saved.nodes, false);
    const normalized = normalizeCardLayout(frozen.nodes, saved.nodes, baseline.stage);
    const issue = normalized.conflict?.message ?? validateStoredRoutes(original, normalized.nodes, saved.edgeRoutes, hierarchyProjection(normalized.nodes, baseline.stage));
    normalizationMessage.current = issue ? `卡片规格调整冲突：${issue}` : '';
    const working = issue ? original : normalized.nodes;
    return { nodes: working, edgeRoutes: structuredClone(saved.edgeRoutes), frozenGroups: structuredClone(frozen.groups),
      ...(saved.overlay ? { overlay: structuredClone(saved.overlay) } : {}), displayRoutes: structuredClone(saved.displayRoutes ?? []) };
  }, [getBaseline]);
  const [initialContent] = useState(() => makeContent(initialId, initialMode));
  const [nodes, publishNodes] = useState(initialContent.nodes), nodesRef = useRef(nodes);
  const [edgeRoutes, publishRoutes] = useState(initialContent.edgeRoutes), routesRef = useRef(edgeRoutes);
  const [frozenGroups, publishFrozen] = useState(initialContent.frozenGroups), frozenRef = useRef(frozenGroups);
  const [overlay, publishOverlay] = useState(initialContent.overlay), overlayRef = useRef(overlay);
  const [displayRoutes, publishDisplay] = useState(initialContent.displayRoutes ?? []), displayRoutesRef = useRef(displayRoutes);
  const histories = useRef(new Map<string, ViewHistory>());
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
  const setRoutes = useCallback((next: EdgeRouteSnapshot[]) => { routesRef.current = next; publishRoutes(next); }, []);
  const setFrozenGroups = useCallback((next: FrozenGroupSnapshot[]) => { frozenRef.current = next; publishFrozen(next); }, []);
  const setOverlay = useCallback((next: UserGraphOverlay | undefined) => { overlayRef.current = next; publishOverlay(next); }, []);
  const setDisplayRoutes = useCallback((next: DisplayRouteSnapshot[]) => { displayRoutesRef.current = next; publishDisplay(next); }, []);
  const captureCurrent = useCallback(() => {
    const content = captureContent(nodesRef.current, routesRef.current, frozenRef.current, overlayRef.current, displayRoutesRef.current);
    metadata.current.set(content, structuredClone(views.current[modeRef.current][idRef.current]!));
    return content;
  }, []);
  const storeCurrent = useCallback(() => {
    const mode = modeRef.current, id = idRef.current;
    views.current[mode][id] = replaceContent(views.current[mode][id]!, captureCurrent());
  }, [captureCurrent]);
  const save = useCallback((capture = true) => {
    if (capture) storeCurrent();
    if (!persistence) return;
    const view: CanvasWorkspaceView = { version: 2, baselineId: idRef.current, viewMode: modeRef.current, baselines: views.current[modeRef.current], views: views.current };
    void saveWorkspace(persistence.storage, persistence.key, structuredClone(view)).then(() => setSaveError(''),
      (error: unknown) => setSaveError(`保存失败：${error instanceof Error ? error.message : String(error)}`));
  }, [persistence, storeCurrent]);
  const publishContent = useCallback((state: CanvasSessionState) => {
    setNodes(state.nodes); setRoutes(state.edgeRoutes); setFrozenGroups(state.frozenGroups); setOverlay(state.overlay); setDisplayRoutes(state.displayRoutes ?? []);
  }, [setNodes, setRoutes, setFrozenGroups, setOverlay, setDisplayRoutes]);
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
  const commitContent = useCallback((transform: (current: CanvasSessionState) => CanvasSessionState | undefined) => {
    const before = captureCurrent();
    const current: CanvasSessionState = { nodes: nodesRef.current, edgeRoutes: routesRef.current, frozenGroups: frozenRef.current, ...(overlayRef.current ? { overlay: overlayRef.current } : {}), displayRoutes: displayRoutesRef.current };
    const next = transform(current);
    if (!next || next === current) return false;
    publishContent({ ...next, displayRoutes: next.displayRoutes ?? displayRoutesRef.current });
    const changed = history().record(before, captureCurrent());
    if (changed) { refresh((value) => value + 1); save(); }
    return changed;
  }, [captureCurrent, publishContent, save]);
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
  const confirm = useCallback((renderedRoutes?: DisplayRouteSnapshot[]) => {
    if (renderedRoutes) setDisplayRoutes(renderedRoutes);
    storeCurrent();
    const mode = modeRef.current, id = idRef.current, baseline = getBaseline(id, mode), content = captureCurrent();
    views.current[mode][id] = { ...views.current[mode][id]!, ...content, requiresConfirmation: false, confirmed: structuredClone(content), confirmedAt: new Date().toISOString(), confirmationId: crypto.randomUUID(), revision: baseline.stage.graph.revision ?? baseline.stage.id, confirmedRevision: baseline.stage.graph.revision ?? baseline.stage.id, sourceStage: structuredClone(baseline.stage) };
    refresh((value) => value + 1); save();
  }, [captureCurrent, getBaseline, setDisplayRoutes, storeCurrent, save]);
  const getSavedContent = useCallback((id: string, mode = modeRef.current) => {
    if (id === idRef.current && mode === modeRef.current) storeCurrent();
    const saved = views.current[mode][id];
    return saved ? { content: contentOf(saved), revision: saved.revision, inheritance: saved.inheritance, sourceStage: saved.sourceStage } : undefined;
  }, [storeCurrent]);
  const getConfirmedContent = useCallback((id: string, mode = modeRef.current) => views.current[mode][id]?.confirmed, []);
  const getConfirmedRevision = useCallback((id: string, mode = modeRef.current) => {
    const saved = views.current[mode][id], baseline = getBaseline(id, mode);
    if (!saved) return undefined;
    const revision = baseline.stage.graph.revision ?? baseline.stage.id;
    return confirmationIsCurrent(saved, revision) ? saved.confirmedRevision ?? saved.revision : undefined;
  }, [getBaseline]);
  const saveViewport = useCallback((viewport: CanvasViewport) => { views.current[modeRef.current][idRef.current]!.viewport = viewport; if (!pending.current) save(false); }, [save]);
  return {
    nodes, nodesRef, setNodes, edgeRoutes, routesRef, frozenGroups, frozenRef, overlay, overlayRef,
    setRoutes, setFrozenGroups, setOverlay, setDisplayRoutes, displayRoutes, displayRoutesRef, commitContent,
    baselineId, baseline: getBaseline(baselineId, viewMode), viewMode, switchView, getBaseline,
    initializationMessage: normalizationMessage.current || (restored?.baselineId && restored.baselineId !== initialId ? '旧阶段尚未建立三个视图，先确认首阶段的三个视图；原有阶段草稿和快照已保留' : !restored && props.initialBaselineId && props.initialBaselineId !== initialId ? '目标阶段尚未建立三个视图，请先确认首阶段的三个视图' : ''),
    initialViewport: views.current[initialMode][initialId]?.viewport,
    getViewport: (id: string, mode = modeRef.current) => views.current[mode][id]?.viewport, saveViewport,
    begin, finish, commit, switchBaseline, applyStageTransitions, confirm, getConfirmedContent, getConfirmedRevision, getSavedContent,
    undo: () => travel('undo'), redo: () => travel('redo'), canUndo: history().canUndo, canRedo: history().canRedo, saveError, retrySave: () => save(),
    transition: views.current[viewMode][baselineId]?.transition, confirmedAt: views.current[viewMode][baselineId]?.confirmedAt,
    confirmationStatus: VIEW_MODES.map((mode) => {
      const saved = views.current[mode][baselineId], source = getBaseline(baselineId, mode);
      const revision = source.stage.graph.revision ?? source.stage.id;
      return { mode, confirmed: !!saved?.confirmed, current: !!saved && confirmationIsCurrent(saved, revision) };
    }),
  };
}
