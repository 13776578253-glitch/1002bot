/** Committed workspace transactions, per-baseline history and storage writes at gesture boundaries. */
import { useCallback, useRef, useState, type SetStateAction } from 'react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { VisualizationCanvasProps } from '../types.ts';
import type { CanvasNode } from '../model/grouping.ts';
import { createHierarchyNodes } from '../model/hierarchy.ts';
import { captureNodeViews, restoreNodeViews, ViewHistory, type CanvasNodeView, type CanvasViewport, type CanvasWorkspaceView } from '../model/workspace.ts';
import { saveWorkspace } from '../persistence/storage-session.ts';

export function baselineNodes(baseline: VisualizationBaseline): CanvasNode[] {
  return createHierarchyNodes(baseline.stage, baseline.positions).map((node) => ({ ...node, data: { ...node.data, change: baseline.nodeChanges[node.id]! } }));
}

export function useWorkspaceSession(props: VisualizationCanvasProps, restored?: CanvasWorkspaceView) {
  const { baselines, persistence } = props;
  const initialId = restored && baselines.some((item) => item.id === restored.baselineId) ? restored.baselineId : props.initialBaselineId ?? baselines[baselines.length - 1]!.id;
  const makeNodes = (id: string) => {
    const baseline = baselines.find((item) => item.id === id)!;
    const saved = restored?.baselines[id];
    return saved ? restoreNodeViews(baseline, baselineNodes(baseline), saved.nodes) : baselineNodes(baseline);
  };
  const [baselineId, setBaselineId] = useState(initialId);
  const idRef = useRef(baselineId);
  const [nodes, publish] = useState<CanvasNode[]>(() => makeNodes(initialId));
  const nodesRef = useRef(nodes);
  const layouts = useRef(new Map<string, CanvasNode[]>());
  const viewports = useRef(new Map(Object.entries(restored?.baselines ?? {}).flatMap(([id, view]) => view.viewport ? [[id, view.viewport] as const] : [])));
  const histories = useRef(new Map<string, ViewHistory>());
  const pending = useRef<CanvasNodeView[] | undefined>(undefined);
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

  const save = useCallback(() => {
    if (!persistence) return;
    layouts.current.set(idRef.current, nodesRef.current);
    const views: CanvasWorkspaceView['baselines'] = {};
    for (const baseline of baselines) {
      const layout = layouts.current.get(baseline.id), previous = restored?.baselines[baseline.id];
      if (!layout && !previous) continue;
      const viewport = viewports.current.get(baseline.id);
      views[baseline.id] = { revision: baseline.stage.graph.revision ?? baseline.stage.id, nodes: layout ? captureNodeViews(layout) : previous!.nodes, ...(viewport ? { viewport } : {}) };
    }
    const view: CanvasWorkspaceView = { version: 1, baselineId: idRef.current, baselines: views };
    void saveWorkspace(persistence.storage, persistence.key, view).then(() => setSaveError(''),
      (error: unknown) => setSaveError(`保存失败：${error instanceof Error ? error.message : String(error)}`));
  }, [baselines, persistence, restored]);

  const begin = useCallback(() => { pending.current ??= captureNodeViews(nodesRef.current); }, []);
  const finish = useCallback(() => {
    const before = pending.current;
    pending.current = undefined;
    if (!before) return;
    if (history().record(before, captureNodeViews(nodesRef.current))) refreshHistory((version) => version + 1);
    save();
  }, [save]);
  const commit = useCallback((transform: (current: CanvasNode[]) => CanvasNode[]) => {
    const current = nodesRef.current;
    const before = captureNodeViews(current), next = transform(current);
    if (next === current) return false;
    const changed = history().record(before, captureNodeViews(next));
    setNodes(next);
    if (changed) { refreshHistory((version) => version + 1); save(); }
    return changed;
  }, [save, setNodes]);

  const travel = useCallback((direction: 'undo' | 'redo') => {
    const stack = history();
    if (direction === 'undo' ? !stack.canUndo : !stack.canRedo) return;
    pending.current = undefined;
    const saved = stack[direction](captureNodeViews(nodesRef.current));
    const baseline = baselines.find((item) => item.id === idRef.current)!;
    setNodes(restoreNodeViews(baseline, baselineNodes(baseline), saved));
    refreshHistory((version) => version + 1);
    save();
  }, [baselines, save, setNodes]);

  const switchBaseline = useCallback((id: string, transform: (target: CanvasNode[], source: CanvasNode[]) => CanvasNode[]) => {
    pending.current = undefined;
    layouts.current.set(idRef.current, nodesRef.current);
    const next = transform(layouts.current.get(id) ?? makeNodes(id), nodesRef.current);
    idRef.current = id;
    setBaselineId(id);
    setNodes(next);
    layouts.current.set(id, next);
    save();
  }, [save, setNodes, baselines, restored]);

  const saveViewport = useCallback((viewport: CanvasViewport) => { viewports.current.set(idRef.current, viewport); if (!pending.current) save(); }, [save]);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);
  void historyVersion;
  return {
    nodes, nodesRef, setNodes, baselineId, baseline: baselines.find((item) => item.id === baselineId)!,
    initialViewport: viewports.current.get(initialId), getViewport: (id: string) => viewports.current.get(id), saveViewport,
    begin, finish, commit, switchBaseline, undo, redo,
    canUndo: history().canUndo, canRedo: history().canRedo, saveError, retrySave: save,
  };
}
