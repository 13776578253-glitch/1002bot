/** Committed workspace transactions, per-baseline history and storage writes at gesture boundaries. */
import { useCallback, useRef, useState, type SetStateAction } from 'react';
import type { VisualizationCanvasProps } from '../types.ts';
import type { CanvasNode } from '../model/grouping.ts';
import { baselineNodes } from '../model/hierarchy.ts';
import { restoreFrozenGroups } from '../model/frozen.ts';
import type { UserGraphOverlay } from '../model/overlay.ts';
import {
  captureContent,
  captureNodeViews,
  restoreNodeViews,
  ViewHistory,
  type CanvasBaselineContent,
  type CanvasViewport,
  type CanvasWorkspaceView,
  type EdgeRouteSnapshot,
  type FrozenGroupSnapshot,
  type StageTransitionRecord,
  type DisplayRouteSnapshot,
} from '../model/workspace.ts';
import type { StageInheritanceBase } from '../model/snapshot-inheritance.ts';
import type { StageSnapshot } from '../../core/schema/types.ts';
import { saveWorkspace } from '../persistence/storage-session.ts';

export interface CanvasSessionState {
  nodes: CanvasNode[];
  edgeRoutes: EdgeRouteSnapshot[];
  frozenGroups: FrozenGroupSnapshot[];
  overlay?: UserGraphOverlay;
  displayRoutes?: DisplayRouteSnapshot[];
}

export { baselineNodes };

export function useWorkspaceSession(props: VisualizationCanvasProps, restored?: CanvasWorkspaceView) {
  const { baselines, persistence } = props;
  const initialId = restored && baselines.some((item) => item.id === restored.baselineId) ? restored.baselineId : props.initialBaselineId ?? baselines[baselines.length - 1]!.id;
  const contents = useRef(new Map<string, CanvasBaselineContent>());
  const revisions = useRef(new Map(Object.entries(restored?.baselines ?? {}).map(([id, view]) => [id, view.revision])));

  const makeContent = useCallback((id: string): CanvasSessionState => {
    const baseline = baselines.find((item) => item.id === id)!;
    const saved = contents.current.get(id) ?? restored?.baselines[id];
    if (!saved) return { nodes: baselineNodes(baseline), edgeRoutes: [], frozenGroups: [] };
    const frozen = restoreFrozenGroups(restoreNodeViews(baseline, baselineNodes(baseline), saved.nodes), saved.frozenGroups);
    return {
      nodes: frozen.nodes,
      edgeRoutes: structuredClone(saved.edgeRoutes),
      frozenGroups: structuredClone(frozen.groups),
      ...(saved.overlay ? { overlay: structuredClone(saved.overlay) } : {}),
      ...(saved.displayRoutes ? { displayRoutes: structuredClone(saved.displayRoutes) } : {}),
    };
  }, [baselines, restored]);

  const [initialContent] = useState<CanvasSessionState>(() => makeContent(initialId));
  const [baselineId, setBaselineId] = useState(initialId);
  const idRef = useRef(baselineId);
  const [nodes, publish] = useState<CanvasNode[]>(initialContent.nodes);
  const nodesRef = useRef(nodes);
  const [routes, publishRoutes] = useState<EdgeRouteSnapshot[]>(initialContent.edgeRoutes);
  const routesRef = useRef(routes);
  const [frozenGroups, publishFrozen] = useState<FrozenGroupSnapshot[]>(initialContent.frozenGroups);
  const frozenRef = useRef(frozenGroups);
  const [overlay, publishOverlay] = useState<UserGraphOverlay | undefined>(initialContent.overlay);
  const overlayRef = useRef(overlay);
  const [displayRoutes, publishDisplayRoutes] = useState<DisplayRouteSnapshot[]>(initialContent.displayRoutes ?? []);
  const displayRoutesRef = useRef(displayRoutes);
  const inheritances = useRef(new Map<string, StageInheritanceBase>(Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.inheritance ? [[id, view.inheritance] as const] : [])));
  const sourceStages = useRef(new Map<string, StageSnapshot>(Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.sourceStage ? [[id, view.sourceStage] as const] : [])));
  const confirmedContents = useRef(new Map<string, CanvasBaselineContent>(
    Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.confirmed ? [[id, structuredClone(view.confirmed)] as const] : []),
  ));
  const confirmedAt = useRef(new Map<string, string>(
    Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.confirmedAt ? [[id, view.confirmedAt] as const] : []),
  ));
  const confirmationIds = useRef(new Map(Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.confirmationId ? [[id, view.confirmationId] as const] : [])));
  const transitions = useRef(new Map<string, StageTransitionRecord>(
    Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.transition ? [[id, view.transition] as const] : []),
  ));
  const viewports = useRef(new Map(Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.viewport ? [[id, view.viewport] as const] : [])));
  const histories = useRef(new Map<string, ViewHistory>());
  const pending = useRef<CanvasBaselineContent | undefined>(undefined);
  const [historyVersion, refreshHistory] = useState(0);
  const [saveError, setSaveError] = useState('');
  const history = () => {
    let value = histories.current.get(idRef.current);
    if (!value) { value = new ViewHistory(); histories.current.set(idRef.current, value); }
    return value;
  };

  const setNodes = useCallback((action: SetStateAction<CanvasNode[]>) => {
    const next = typeof action === 'function' ? action(nodesRef.current) : action;
    nodesRef.current = next;
    publish(next);
  }, []);
  const setRoutes = useCallback((next: EdgeRouteSnapshot[]) => { routesRef.current = next; publishRoutes(next); }, []);
  const setFrozenGroups = useCallback((next: FrozenGroupSnapshot[]) => { frozenRef.current = next; publishFrozen(next); }, []);
  const setOverlay = useCallback((next: UserGraphOverlay | undefined) => { overlayRef.current = next; publishOverlay(next); }, []);
  const setDisplayRoutes = useCallback((next: DisplayRouteSnapshot[]) => { displayRoutesRef.current = next; publishDisplayRoutes(next); }, []);

  const captureCurrent = useCallback(() => captureContent(nodesRef.current, routesRef.current, frozenRef.current, overlayRef.current, displayRoutesRef.current), []);

  const storedContent = useCallback((id: string): CanvasBaselineContent | undefined => {
    const saved = restored?.baselines[id];
    if (!saved) return undefined;
    return {
      nodes: saved.nodes,
      edgeRoutes: saved.edgeRoutes,
      frozenGroups: saved.frozenGroups,
      ...(saved.overlay ? { overlay: saved.overlay } : {}),
      ...(saved.displayRoutes ? { displayRoutes: saved.displayRoutes } : {}),
    };
  }, [restored]);

  const save = useCallback(() => {
    contents.current.set(idRef.current, captureCurrent());
    if (!persistence) return;
    const views: CanvasWorkspaceView['baselines'] = {};
    for (const baseline of baselines) {
      const restoredBaseline = restored?.baselines[baseline.id];
      const content = contents.current.get(baseline.id) ?? storedContent(baseline.id);
      const confirmed = confirmedContents.current.get(baseline.id) ?? (restoredBaseline?.confirmed ? structuredClone(restoredBaseline.confirmed) : undefined);
      const confirmedStamp = confirmedAt.current.get(baseline.id) ?? restoredBaseline?.confirmedAt;
      const transition = transitions.current.get(baseline.id) ?? restoredBaseline?.transition;
      const viewport = viewports.current.get(baseline.id) ?? restoredBaseline?.viewport;
      const base = content ?? confirmed;
      if (!base && !transition && !viewport) continue;
      const storedOverlay = base?.overlay;
      views[baseline.id] = {
        revision: revisions.current.get(baseline.id) ?? baseline.stage.graph.revision ?? baseline.stage.id,
        nodes: base?.nodes ?? [],
        edgeRoutes: base?.edgeRoutes ?? [],
        frozenGroups: base?.frozenGroups ?? [],
        ...(storedOverlay ? { overlay: storedOverlay } : {}),
        ...(base?.displayRoutes ? { displayRoutes: base.displayRoutes } : {}),
        ...(inheritances.current.get(baseline.id) ? { inheritance: inheritances.current.get(baseline.id)! } : {}),
        ...(sourceStages.current.get(baseline.id) ? { sourceStage: sourceStages.current.get(baseline.id)! } : {}),
        ...(confirmed ? { confirmed } : {}),
        ...(confirmedStamp ? { confirmedAt: confirmedStamp } : {}),
        ...(confirmationIds.current.get(baseline.id) ? { confirmationId: confirmationIds.current.get(baseline.id)! } : {}),
        ...(transition ? { transition } : {}),
        ...(viewport ? { viewport } : {}),
      };
    }
    const view: CanvasWorkspaceView = { version: 2, baselineId: idRef.current, baselines: views };
    void saveWorkspace(persistence.storage, persistence.key, view).then(() => setSaveError(''),
      (error: unknown) => setSaveError(`保存失败：${error instanceof Error ? error.message : String(error)}`));
  }, [baselines, persistence, restored, captureCurrent, storedContent]);

  const begin = useCallback(() => { pending.current ??= captureCurrent(); }, [captureCurrent]);
  const finish = useCallback(() => {
    const before = pending.current;
    pending.current = undefined;
    if (!before) return;
    if (history().record(before, captureCurrent())) refreshHistory((version) => version + 1);
    save();
  }, [captureCurrent, save]);

  const commit = useCallback((transform: (current: CanvasNode[]) => CanvasNode[]) => {
    const current = nodesRef.current;
    const before = captureCurrent();
    const next = transform(current);
    if (next === current) return false;
    setNodes(next);
    const after = captureContent(next, routesRef.current, frozenRef.current, overlayRef.current, displayRoutesRef.current);
    const changed = history().record(before, after);
    if (changed) { refreshHistory((version) => version + 1); save(); }
    return changed;
  }, [captureCurrent, save, setNodes]);

  const commitContent = useCallback((transform: (current: CanvasSessionState) => CanvasSessionState | undefined) => {
    const before = captureCurrent();
    const current: CanvasSessionState = {
      nodes: nodesRef.current, edgeRoutes: routesRef.current, frozenGroups: frozenRef.current,
      ...(overlayRef.current ? { overlay: overlayRef.current } : {}),
      displayRoutes: displayRoutesRef.current,
    };
    const next = transform(current);
    if (!next || next === current) return false;
    setNodes(next.nodes);
    setRoutes(next.edgeRoutes);
    setFrozenGroups(next.frozenGroups);
    setOverlay(next.overlay);
    setDisplayRoutes(next.displayRoutes ?? displayRoutesRef.current);
    const after = captureCurrent();
    const changed = history().record(before, after);
    if (changed) { refreshHistory((version) => version + 1); save(); }
    return changed;
  }, [captureCurrent, save, setFrozenGroups, setNodes, setOverlay, setRoutes]);

  const applyContent = useCallback((content: CanvasBaselineContent) => {
    const baseline = baselines.find((item) => item.id === idRef.current)!;
    const frozen = restoreFrozenGroups(restoreNodeViews(baseline, baselineNodes(baseline), content.nodes), content.frozenGroups);
    setNodes(frozen.nodes);
    setRoutes(structuredClone(content.edgeRoutes));
    setFrozenGroups(structuredClone(frozen.groups));
    setOverlay(content.overlay ? structuredClone(content.overlay) : undefined);
    setDisplayRoutes(structuredClone(content.displayRoutes ?? []));
  }, [baselines, setFrozenGroups, setNodes, setOverlay, setRoutes]);

  const travel = useCallback((direction: 'undo' | 'redo') => {
    const stack = history();
    if (direction === 'undo' ? !stack.canUndo : !stack.canRedo) return;
    pending.current = undefined;
    const saved = stack[direction](captureCurrent());
    applyContent(saved);
    refreshHistory((version) => version + 1);
    save();
  }, [applyContent, captureCurrent, save]);

  const switchBaseline = useCallback((id: string, transform?: (target: CanvasNode[], source: CanvasNode[]) => CanvasNode[]) => {
    pending.current = undefined;
    contents.current.set(idRef.current, captureCurrent());
    const target = makeContent(id);
    const nextNodes = transform ? transform(target.nodes, nodesRef.current) : target.nodes;
    idRef.current = id;
    setBaselineId(id);
    setNodes(nextNodes);
    setRoutes(structuredClone(target.edgeRoutes));
    setFrozenGroups(structuredClone(target.frozenGroups));
    setOverlay(target.overlay ? structuredClone(target.overlay) : undefined);
    setDisplayRoutes(structuredClone(target.displayRoutes ?? []));
    contents.current.set(id, captureCurrent());
    save();
  }, [captureCurrent, makeContent, save, setFrozenGroups, setNodes, setOverlay, setRoutes]);

  const applyStageTransition = useCallback((targetId: string, next: CanvasSessionState, before: CanvasBaselineContent, record: StageTransitionRecord, inheritance?: StageInheritanceBase) => {
    pending.current = undefined;
    contents.current.set(idRef.current, captureCurrent());
    idRef.current = targetId;
    setBaselineId(targetId);
    setNodes(next.nodes);
    setRoutes(structuredClone(next.edgeRoutes));
    setFrozenGroups(structuredClone(next.frozenGroups));
    setOverlay(next.overlay ? structuredClone(next.overlay) : undefined);
    setDisplayRoutes(structuredClone(next.displayRoutes ?? []));
    const after = captureCurrent();
    contents.current.set(targetId, after);
    transitions.current.set(targetId, record);
    revisions.current.set(targetId, record.targetRevision);
    if (inheritance) inheritances.current.set(targetId, inheritance);
    sourceStages.current.set(targetId, structuredClone(baselines.find((item) => item.id === targetId)!.stage));
    const stack = histories.current.get(targetId) ?? new ViewHistory();
    histories.current.set(targetId, stack);
    if (stack.record(before, after)) refreshHistory((version) => version + 1);
    save();
  }, [captureCurrent, save, setFrozenGroups, setNodes, setOverlay, setRoutes]);

  const confirm = useCallback((renderedRoutes?: DisplayRouteSnapshot[]) => {
    if (renderedRoutes) setDisplayRoutes(renderedRoutes);
    confirmedContents.current.set(idRef.current, captureCurrent());
    confirmedAt.current.set(idRef.current, new Date().toISOString());
    confirmationIds.current.set(idRef.current, crypto.randomUUID());
    const baseline = baselines.find((item) => item.id === idRef.current)!;
    revisions.current.set(idRef.current, baseline.stage.graph.revision ?? baseline.stage.id);
    sourceStages.current.set(idRef.current, structuredClone(baseline.stage));
    save();
  }, [baselines, captureCurrent, save]);

  const getConfirmedContent = useCallback((id: string): CanvasBaselineContent | undefined => confirmedContents.current.get(id) ?? restored?.baselines[id]?.confirmed, [restored]);

  const getSavedContent = useCallback((id: string): { content: CanvasBaselineContent; revision?: string; inheritance?: StageInheritanceBase; sourceStage?: StageSnapshot } | undefined => {
    const inMemory = contents.current.get(id);
    if (inMemory) {
      const baseline = baselines.find((item) => item.id === id)!;
      return { content: inMemory, revision: revisions.current.get(id) ?? baseline.stage.graph.revision ?? baseline.stage.id, ...(inheritances.current.get(id) ? { inheritance: inheritances.current.get(id)! } : {}), ...(sourceStages.current.get(id) ? { sourceStage: sourceStages.current.get(id)! } : {}) };
    }
    const saved = restored?.baselines[id];
    if (!saved) return undefined;
    return {
      content: {
        nodes: saved.nodes,
        edgeRoutes: saved.edgeRoutes,
        frozenGroups: saved.frozenGroups,
        ...(saved.overlay ? { overlay: saved.overlay } : {}),
        ...(saved.displayRoutes ? { displayRoutes: saved.displayRoutes } : {}),
      },
      revision: saved.revision,
      ...(saved.inheritance ? { inheritance: saved.inheritance } : {}),
      ...(saved.sourceStage ? { sourceStage: saved.sourceStage } : {}),
    };
  }, [baselines, restored]);

  const saveViewport = useCallback((viewport: CanvasViewport) => { viewports.current.set(idRef.current, viewport); if (!pending.current) save(); }, [save]);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);
  void historyVersion;
  return {
    nodes, nodesRef, setNodes,
    edgeRoutes: routes, routesRef, frozenGroups, frozenRef, overlay, overlayRef,
    setRoutes, setFrozenGroups, setOverlay, setDisplayRoutes, displayRoutes, displayRoutesRef, commitContent,
    baselineId, baseline: baselines.find((item) => item.id === baselineId)!,
    initialViewport: viewports.current.get(initialId), getViewport: (id: string) => viewports.current.get(id), saveViewport,
    begin, finish, commit, switchBaseline, applyStageTransition, confirm, getConfirmedContent, getSavedContent,
    undo, redo, canUndo: history().canUndo, canRedo: history().canRedo, saveError, retrySave: save,
    transition:transitions.current.get(baselineId),
  };
}
