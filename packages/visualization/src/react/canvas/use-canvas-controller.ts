/** Canvas commands coordinate geometry, per-baseline transactions and source-preserving navigation. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyNodeChanges, useReactFlow, type NodeChange } from '@xyflow/react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { VisualizationCanvasProps } from '../types.ts';
import { groupSelection, selectionRoots, ungroup, type CanvasNode, type LayoutMode } from '../model/grouping.ts';
import { hierarchyProjection, nodeIsVisible, toggleHierarchy } from '../model/hierarchy.ts';
import { constrainNodeMoves, type AlignmentGuide } from '../model/constraints.ts';
import { fitAuthoredLayout, manualGeometryConflict, moveAlignedAuthoredNodes } from '../model/manual-layout.ts';
import { aggregateProjectedEdges, type DisplayEdge } from '../model/display-edges.ts';
import { freezeSelection, frozenGroupFor, toggleFrozenExpansion } from '../model/frozen.ts';
import { removeRoute, routeSnapshotForEdge, routeStateFor, upsertRoute, validateStoredRoutes, worldRoutePoints, reservedLockedRoutes } from '../model/edge-routes.ts';
import { captureDisplayRoutes } from '../model/display-route-snapshots.ts';
import type { CachedRoute } from '../model/route-cache.ts';
import type { StageViewState } from '../model/stage-transition.ts';
import { prepareStageNavigation, type NavigationResult } from '../model/stage-navigation.ts';
import { captureFrozenSubgraph, validateFrozenConnections, releaseFrozenSubgraph } from '../model/blackbox-routes.ts';
import { rebaseFrozenGrowth } from '../model/frozen-growth.ts';
import type { StageConflict } from '../model/stage-types.ts';
import { recordPositionEdits, recordSizeEdits } from '../model/layout-intent.ts';
import type { CanvasWorkspaceView, CanvasViewMode, EdgeRouteState, FrozenGroupSnapshot } from '../model/workspace.ts';
import { useWorkspaceSession, VIEW_MODES, VIEW_LABELS, type ViewTransition } from './use-workspace-session.ts';
import { useCanvasScene } from './use-canvas-scene.ts';
import { useDragProfile } from './use-drag-profile.ts';
import { labelPinForEdge, pinLabelForEdge, upsertLabelPin, removeLabelPinForEdge } from '../model/label-pins.ts';
import { sceneGeometryKey } from '../model/label-snapshots.ts';

interface TransitionPreview {
  targetId: string;
  baseline: VisualizationBaseline;
  state: StageViewState;
  conflicts: StageConflict[];
  reset?: Record<CanvasViewMode, ViewTransition>;
}

export function useCanvasController(props: VisualizationCanvasProps, restored?: CanvasWorkspaceView) {
  const session = useWorkspaceSession(props, restored);
  const { nodes, nodesRef, setNodes, baseline, baselineId, begin, finish } = session;
  const [preview, setPreview] = useState<TransitionPreview>();
  const activeBaseline = preview?.baseline ?? baseline;
  const activeNodes = preview?.state.nodes ?? nodes;
  const expandedKey = activeNodes.filter((node) => node.data.expanded).map((node) => node.id).join('|');
  const projection = useMemo(() => hierarchyProjection(activeNodes, activeBaseline.stage), [expandedKey, activeBaseline]);
  const displayEdges = useMemo(() => aggregateProjectedEdges(projection, activeBaseline.edgeChanges), [projection, activeBaseline]);
  const projectionRef = useRef(projection); projectionRef.current = projection;
  const links = useMemo(() => projection.edges.map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId })), [projection]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => props.initialTheme ?? (localStorage.getItem('architecture-theme') === 'light' ? 'light' : 'dark'));
  const [boxMode, setBoxMode] = useState(false), [grid, setGrid] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [connectionEdge, setConnectionEdge] = useState<DisplayEdge>();
  const [message, setMessage] = useState(session.initializationMessage);
  const [zoom, setZoom] = useState(Math.round((session.initialViewport?.zoom ?? 1) * 100));
  const [alignment, setAlignment] = useState<AlignmentGuide[]>([]);
  const [engine] = useState<'legacy' | 'group'>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('routing') === 'group' ? 'group' : 'legacy');
  const flow = useReactFlow<CanvasNode>();
  const previewViewport = useRef<{ x: number; y: number; zoom: number } | undefined>(undefined);
  const commit = useCallback((transform: (current: CanvasNode[]) => CanvasNode[]) => {
    captureRendered.current();
    return session.commit((current) => {
      const next = transform(current);
      const geometryConflict = baseline.layout?.kind === 'manual' ? manualGeometryConflict(next, baseline.stage) : undefined;
      if (geometryConflict) { setMessage(geometryConflict.message); return current; }
      const conflict = validateStoredRoutes(current, next, session.routesRef.current, hierarchyProjection(next, baseline.stage));
      if (conflict) { setMessage(conflict); return current; }
      const connections=validateFrozenConnections(current,next,baseline.stage,session.routesRef.current,session.frozenRef.current,routesRef.current);
      if(connections.length){setMessage(connections[0]!.message);return current;}
      return next;
    });
  }, [baseline, session.commit]);
  const recordConstraint = useRef<(duration: number) => void>(() => {});
  const routesRef = useRef<Map<string, CachedRoute>>(new Map());
  const captureRendered = useRef<() => void>(() => {});
  const dragging = useRef(false);
  const pendingFinish = useRef(false);
  const deferredNavigation = useRef<(() => void) | undefined>(undefined);
  const [finishRevision, setFinishRevision] = useState(0);
  const requestFinish = useCallback(() => { pendingFinish.current = true; setFinishRevision((value) => value + 1); }, []);
  const fitView = useCallback((options: { padding: number; maxZoom: number }) => flow.fitView(options), [flow.fitView]);
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    if (preview) return;
    const current = nodesRef.current;
    let next = applyNodeChanges(changes, current);
    const moved = changes.flatMap((change) => change.type === 'position' && change.position ? [change.id] : []);
    const editedPositions = changes.flatMap((change) => change.type === 'position' && change.position && (typeof change.dragging === 'boolean' || dragging.current) ? [change.id] : []);
    const resized = changes.flatMap((change) => change.type === 'dimensions' && change.resizing === true ? [change.id] : []);
    if (resized.length) { begin(); next = recordSizeEdits(current, next, resized); }
    if (resized.length && !moved.length) {
      const fitted = fitAuthoredLayout(current, next, resized, baseline.stage);
      const issue = fitted.conflict?.message ?? validateStoredRoutes(current, fitted.nodes, session.routesRef.current, projectionRef.current)
        ?? validateFrozenConnections(current, fitted.nodes, baseline.stage, session.routesRef.current, session.frozenRef.current)[0]?.message;
      if (issue) { next = current; setMessage(issue); } else next = fitted.nodes;
    }
    if (moved.length) {
      begin();
      const visible = new Set(next.filter((node) => nodeIsVisible(node, next, projectionRef.current)).map((node) => node.id));
      const started = performance.now();
      const result: { nodes: CanvasNode[]; guides: AlignmentGuide[]; conflict?: StageConflict } = baseline.layout?.kind === 'manual'
        ? moveAlignedAuthoredNodes(current, next, moved, baseline.stage, flow.getZoom(), visible)
        : constrainNodeMoves(current, next, moved, flow.getZoom(), visible, links);
      next = result.nodes;
      if ('conflict' in result && result.conflict) setMessage(result.conflict.message);
      const grown=rebaseFrozenGrowth(current,next,session.routesRef.current,session.frozenRef.current);
      const routeConflict = validateStoredRoutes(current, next, session.routesRef.current, projectionRef.current,grown.routes);
      const connections=routeConflict?[]:validateFrozenConnections(current,next,baseline.stage,grown.routes,grown.groups,routesRef.current);
      if (routeConflict||connections.length) { next = current; setMessage(routeConflict??connections[0]!.message); }
      else { next = recordPositionEdits(current, next, editedPositions); if(grown.routes!==session.routesRef.current)session.setRoutes(grown.routes);if(grown.groups!==session.frozenRef.current)session.setFrozenGroups(grown.groups);}
      setAlignment(next !== current && changes.some((change) => change.type === 'position' && change.dragging) ? result.guides : []);
      recordConstraint.current(performance.now() - started);
    }
    setNodes(next);
    if (changes.some((change) => change.type === 'dimensions' && change.resizing === false)) requestFinish();
    if (moved.length && !dragging.current && !changes.some((change) => change.type === 'position' && change.dragging)) requestFinish();
  }, [baseline, begin, requestFinish, flow.getZoom, links, preview, setNodes]);

  const toggleNode = useCallback((id: string) => {
    if (preview) return;
    if (session.viewMode !== 'structure') return;
    const current = nodesRef.current;
    const frozenNode = current.find((node) => node.id === id);
    if (frozenNode?.data.frozen) {
      if (!frozenNode.data.expandable) return;
      const next=toggleFrozenExpansion(current, id, !frozenNode.data.expanded,session.frozenRef.current);
      if(next===current){setMessage('冻结框展开范围与已有节点冲突，原布局已保留');return;}
      if (commit(() => next)) setMessage('');
      setSelectedEdge(undefined);
      return;
    }
    let expansionConflict: StageConflict | undefined;
    const next = toggleHierarchy(current, id, baseline.stage, (conflict) => { expansionConflict = conflict; });
    if (next === current) { setMessage(expansionConflict?.message ?? '空间不足：请移动或解除相关节点的固定后再展开'); return; }
    const conflict = validateStoredRoutes(current, next, session.routesRef.current, hierarchyProjection(next, baseline.stage));
    if (conflict) { setMessage(conflict); return; }
    if (commit(() => next)) setMessage(''); setSelectedEdge(undefined);
  }, [baseline, commit, preview, session.viewMode]);

  const chooseEdge = useCallback((id: string) => {
    if (preview) return;
    setSelectedEdge(id);
    const edge = displayEdges.find((item) => item.id === id)!;
    setConnectionEdge(edge);
    const retained = session.routesRef.current.find((route) => route.canonicalEdgeId === edge.members[0]?.canonicalEdgeId && route.state === 'pinned');
    const original = retained && worldRoutePoints(retained, nodesRef.current), displayed = routesRef.current.get(id)?.points;
    setMessage(original && displayed && JSON.stringify(original) !== JSON.stringify(displayed) ? '固定路径当前不可用，显示自动计算结果；保存的路径偏好保留' : '');
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
  }, [displayEdges, preview, setNodes]);

  const renameNode = useCallback((id: string, title: string) => {
    if (preview) return;
    const node = nodesRef.current.find((item) => item.id === id)!;
    if (node.data.layoutMode === 'locked' || node.data.frozen) return;
    begin();
    setNodes((current) => current.map((item) => item.id === id ? { ...item, data: { ...item.data, title, ...(item.type !== 'cluster' ? { titleOverride: title } : {}) } } : item));
  }, [begin, preview, setNodes]);

  const createGroup = useCallback(() => {
    if (preview) return;
    commit((current) => {
      const next = groupSelection(current, `cluster-${crypto.randomUUID()}`, baseline.layout?.kind === 'manual');
      return recordPositionEdits(current, next, next.filter((node) => current.some((old) => old.id === node.id && old.parentId !== node.parentId)).map((node) => node.id));
    });
    setSelectedEdge(undefined); setBoxMode(false);
  }, [baseline, commit, preview]);
  const dissolveGroup = useCallback((id: string) => { if (!preview) commit((current) => { const next = ungroup(current, id, baseline.layout?.kind === 'manual'); return recordPositionEdits(current, next, current.filter((node) => node.parentId === id).map((node) => node.id)); }); }, [baseline, commit, preview]);
  const setLayoutMode = useCallback((mode: LayoutMode) => {
    if (preview) return;
    commit((current) => current.map((node) => node.selected && !node.data.frozen && nodeIsVisible(node, current, projectionRef.current) ? { ...node, data: { ...node.data, layoutMode: mode } } : node));
    setMessage('');
  }, [commit, preview]);
  const freezeLayout = useCallback(() => {
    if (preview) return;
    commit((current) => current.map((node) => (node.data.layoutMode ?? 'free') === 'free' && nodeIsVisible(node, current, projectionRef.current) ? { ...node, data: { ...node.data, layoutMode: 'fixed' } } : node));
    setMessage('');
  }, [commit, preview]);

  const clearTransientState = useCallback(() => {
    setSelectedEdge(undefined); setConnectionEdge(undefined); setAlignment([]); setBoxMode(false);
  }, []);

  const freezeSubgraph = useCallback(() => {
    if (preview) return;
    captureRendered.current();
    const roots = selectionRoots(nodesRef.current);
    if (!roots.length) { setMessage('请选择要冻结的节点或容器'); return; }
    const result = freezeSelection({
      nodes: nodesRef.current, rootIds: roots.map((node) => node.id), groupId: `frozen-${crypto.randomUUID()}`,
      stage: baseline.stage, frozenGroups: session.frozenGroups,
      preserveExpansion: session.viewMode === 'overview',
    });
    if (!result.ok) { setMessage(result.conflict.message); return; }
    const groups = [...session.frozenGroups, result.group];
    const inside = new Set([result.group.rootId, ...result.group.memberIds]);
    result.group.previousRoutes = structuredClone(session.edgeRoutes.filter((route) => inside.has(route.source.nodeId) || inside.has(route.target.nodeId)));
    const captured = captureFrozenSubgraph({nodes:result.nodes,stage:baseline.stage,group:result.group,groups,displayEdges,displayRoutes:routesRef.current,storedRoutes:session.edgeRoutes});
    if(!captured.ok){setMessage(captured.conflicts[0]!.message);return;}
    const merged = captured.routes.reduce((list, route) => upsertRoute(list, route), session.edgeRoutes);
    session.commitContent((current) => ({
      ...current, nodes: captured.nodes,
      frozenGroups: [...current.frozenGroups, captured.group],
      edgeRoutes: merged,
      displayRoutes: captureDisplayRoutes(nodesRef.current, projection, displayEdges, routesRef.current, reservedLockedRoutes(merged, captured.nodes, [...session.frozenGroups, captured.group])),
    }));
    setMessage(`已冻结 ${1 + result.group.memberIds.length} 个节点`);
    clearTransientState();
  }, [baseline, clearTransientState, preview, session]);

  const unfreezeSelected = useCallback(() => {
    if (preview) return;
    captureRendered.current();
    const roots = selectionRoots(nodesRef.current);
    const group = roots.map((node) => frozenGroupFor(session.frozenGroups, node.id)).find((item): item is FrozenGroupSnapshot => !!item);
    if (!group) { setMessage('请选择冻结组根节点或成员'); return; }
    const released=releaseFrozenSubgraph(nodesRef.current,session.edgeRoutes,session.frozenGroups,group);
    session.commitContent((current) => ({
      ...current,...released,
    }));
    setMessage('已解冻，可编辑内部节点和路径');
    clearTransientState();
  }, [clearTransientState, preview, session]);

  const setEdgeRouteState = useCallback((state: EdgeRouteState) => {
    if (preview || !selectedEdge) return;
    captureRendered.current();
    const edge = displayEdges.find((item) => item.id === selectedEdge);
    if (!edge || edge.aggregated) return;
    const canonicalId = edge.members[0]?.canonicalEdgeId;
    if (!canonicalId) return;
    const canonical = edge.members[0]!.edge;
    if(session.routesRef.current.find(route=>route.canonicalEdgeId===canonicalId)?.frozenBoundaries?.length){setMessage('请先解冻子图，再修改其边界连接');return;}
    if (session.frozenGroups.some((group) => {
      const ids = new Set([group.rootId, ...group.memberIds]);
      return ids.has(canonical.source.nodeId) && ids.has(canonical.target.nodeId);
    })) { setMessage('请先解冻子图，再修改内部路径'); return; }
    if (state === 'auto') {
      session.commitContent((current) => ({ ...current, edgeRoutes: removeRoute(current.edgeRoutes, canonicalId) }));
      setMessage('路径已恢复自动');
      return;
    }
    const route = routesRef.current.get(selectedEdge);
    if (!route) { setMessage('当前路径尚未生成，无法固定'); return; }
    const snapshot = routeSnapshotForEdge(edge, route, state, nodesRef.current, session.frozenGroups);
    if (!snapshot) { setMessage('无法固定当前路径'); return; }
    session.commitContent((current) => ({ ...current, edgeRoutes: upsertRoute(current.edgeRoutes, snapshot) }));
    setMessage(state === 'locked' ? '路径已锁定' : '路径已固定');
  }, [displayEdges, preview, selectedEdge, session]);

  const selectView = useCallback((mode: CanvasViewMode): void => {
    if (preview || mode === session.viewMode) return;
    if (pendingFinish.current || dragging.current || session.transactionPending()) { deferredNavigation.current = () => selectView(mode); if (!dragging.current) requestFinish(); return; }
    captureRendered.current();
    session.saveViewport(flow.getViewport());
    const notice = session.switchView(mode);
    clearTransientState(); setMessage(notice);
  }, [preview, session, flow.getViewport, clearTransientState, requestFinish]);

  const selectBaseline = useCallback((id: string): void => {
    if (preview) { setPreview(undefined); setMessage('已取消候选预览'); return; }
    if (id === baselineId) return;
    if (pendingFinish.current || dragging.current || session.transactionPending()) { deferredNavigation.current = () => selectBaseline(id); if (!dragging.current) requestFinish(); return; }
    captureRendered.current();
    const targetIndex = props.baselines.findIndex((item) => item.id === id);
    const original = props.baselines[targetIndex]!;
    const parentId = original.previousStageId ?? props.baselines[targetIndex - 1]?.id;
    if (!parentId) {
      session.saveViewport(flow.getViewport()); session.switchBaseline(id);
      clearTransientState(); setMessage(''); return;
    }
    const missing = VIEW_MODES.filter((mode) => !session.getConfirmedContent(parentId, mode));
    if (missing.length) { setMessage(`请先确认 ${props.baselines.find((item) => item.id === parentId)!.stage.label} 的 ${missing.map((mode) => VIEW_LABELS[mode]).join('、')}`); return; }
    const stale = VIEW_MODES.filter((mode) => session.getConfirmedRevision(parentId, mode) !== (session.getBaseline(parentId, mode).stage.graph.revision ?? session.getBaseline(parentId, mode).stage.id));
    if (stale.length) { setMessage(`来源已更新，请重新确认 ${stale.map((mode) => VIEW_LABELS[mode]).join('、')}`); return; }
    const results = {} as Record<CanvasViewMode, ViewTransition>;
    let failed: { mode: CanvasViewMode; result: Extract<NavigationResult, { ok: false }> } | undefined;
    const conflicts: StageConflict[] = [];
    let canReset = true;
    for (const mode of VIEW_MODES) {
      const parent = session.getBaseline(parentId, mode), target = session.getBaseline(id, mode);
      const saved = session.getSavedContent(id, mode);
      const result = prepareStageNavigation({ parent, target, parentContent: session.getConfirmedContent(parentId, mode)!,
        ...(saved ? { saved: { ...saved.content, revision: saved.revision!, ...(saved.inheritance ? { inheritance: saved.inheritance } : {}), ...(saved.sourceStage ? { sourceStage: saved.sourceStage } : {}) } } : {}) });
      if (result.ok) results[mode] = result;
      else {
        failed ??= { mode, result };
        conflicts.push(...result.conflicts.map((item) => ({ ...item, message: `${VIEW_LABELS[mode]}：${item.message}` })));
        if (result.resetCandidate && result.inheritance) results[mode] = { ...result.resetCandidate, inheritance: result.inheritance };
        else canReset = false;
      }
    }
    if (failed) {
      previewViewport.current = flow.getViewport();
      const target = session.getBaseline(id, failed.mode), candidate = failed.result.candidate;
      const ids = new Set(candidate.nodes.map((node) => node.id)), edgeIds = new Set(target.stage.graph.edges.map((edge) => edge.id));
      const frozenGroups = candidate.frozenGroups.filter((group) => [group.rootId, ...group.memberIds].every((nodeId) => ids.has(nodeId)));
      const frozenOwners = new Set(frozenGroups.map((group) => group.rootId));
      const state: StageViewState = { ...candidate,
        frozenGroups,
        edgeRoutes: candidate.edgeRoutes.filter((route) => edgeIds.has(route.canonicalEdgeId) && ids.has(route.source.nodeId) && ids.has(route.target.nodeId)
          && (route.space.kind === 'world' || ids.has(route.space.ownerId)) && (route.frozenBoundaries ?? []).every((part) => frozenOwners.has(part.ownerId))),
      };
      setPreview({ targetId: id, baseline: target, state, conflicts, ...(canReset ? { reset: results } : {}) });
      clearTransientState(); setMessage(''); return;
    }
    session.saveViewport(flow.getViewport());
    if (VIEW_MODES.every((mode) => (results[mode] as NavigationResult & { ok: true }).reused)) session.switchBaseline(id);
    else session.applyStageTransitions(id, results);
    setPreview(undefined); clearTransientState(); setMessage('三个视图已继承，待逐一审查并确认');
  }, [baselineId, clearTransientState, flow.getViewport, preview, props.baselines, session, requestFinish]);

  const confirmStage = useCallback((): void => {
    if (preview) return;
    if (pendingFinish.current || dragging.current || session.transactionPending()) { deferredNavigation.current = confirmStage; if (!dragging.current) requestFinish(); return; }
    captureRendered.current(); session.confirm();
    setMessage(`已确认 ${VIEW_LABELS[session.viewMode]}`);
  }, [preview, session, requestFinish]);
  const cancelPreview = useCallback(() => { setPreview(undefined); setMessage('已取消候选预览'); }, []);
  const adoptPreview = useCallback(() => {
    if (!preview?.reset) return;
    session.applyStageTransitions(preview.targetId, preview.reset);
    previewViewport.current = undefined;
    setPreview(undefined); setMessage('三个视图已从对应父快照重新继承，待审查确认');
  }, [preview, session]);

  useEffect(() => {
    if (preview) return;
    const viewport = previewViewport.current ?? session.getViewport(baselineId);
    previewViewport.current = undefined;
    if (viewport) void flow.setViewport(viewport);
    else requestAnimationFrame(() => void flow.fitView({ padding: 0.22, maxZoom: 1.15 }));
  }, [baselineId, session.viewMode, preview]);
  const locateConnection = useCallback((id: string) => {
    if (preview) return;
    if (session.viewMode === 'overview') { setMessage('在 Structure View 或 Full View 中定位内部节点'); return; }
    const edge = baseline.stage.graph.edges.find((item) => item.id === id)!;
    const graph = new Map(baseline.stage.graph.nodes.map((node) => [node.id, node]));
    const ancestors = new Set<string>();
    const collect = (id: string): void => { const parent = graph.get(id)!.parentId; if (parent && parent !== baseline.stage.graph.rootId) { collect(parent); ancestors.add(parent); } };
    collect(edge.source.nodeId); collect(edge.target.nodeId);
    let next = nodesRef.current;
    for (const parent of ancestors) {
      const owner = next.find((node) => node.id === parent)!;
      if (owner.data.expanded) continue;
      const opened = owner.data.frozen ? toggleFrozenExpansion(next, parent, true,session.frozenRef.current) : toggleHierarchy(next, parent, baseline.stage);
      if (opened === next) { setMessage('定位所需空间不足：请先移动或解除相关节点的固定'); return; }
      next = opened;
    }
    const conflict = validateStoredRoutes(nodesRef.current, next, session.routesRef.current, hierarchyProjection(next, baseline.stage));
    if (conflict) { setMessage(conflict); return; }
    commit(() => next);
    setSelectedEdge(id); setMessage('');
    requestAnimationFrame(() => void flow.fitView({ nodes: [{ id: edge.source.nodeId }, { id: edge.target.nodeId }], padding: 0.35, maxZoom: 1.15 }));
  }, [baseline, commit, flow.fitView, preview, session.viewMode]);
  const closeConnections = useCallback(() => setConnectionEdge(undefined), []);
  const clearMessage = useCallback(() => setMessage(''), []);
  const undo = useCallback((): void => {
    if (preview) return;
    if (pendingFinish.current || dragging.current || session.transactionPending()) { deferredNavigation.current = undo; if (!dragging.current) requestFinish(); return; }
    captureRendered.current(); session.undo(); setMessage('');
  }, [preview, session, requestFinish]);
  const redo = useCallback((): void => {
    if (preview) return;
    if (pendingFinish.current || dragging.current || session.transactionPending()) { deferredNavigation.current = redo; if (!dragging.current) requestFinish(); return; }
    captureRendered.current(); session.redo(); setMessage('');
  }, [preview, session, requestFinish]);

  useEffect(() => { localStorage.setItem('architecture-theme', theme); }, [theme]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (!preview) { event.shiftKey ? redo() : undo(); } }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); if (!preview) redo(); }
      if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); createGroup(); }
      if (event.key === 'Escape') {
        if (preview) { setPreview(undefined); setMessage('已取消候选预览'); }
        else setMessage('');
        setSelectedEdge(undefined); setConnectionEdge(undefined); setBoxMode(false);
        if (!preview) setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [createGroup, preview, redo, setNodes, undo]);

  const scene = useCanvasScene({
    nodes: activeNodes, baseline: activeBaseline, projection, displayEdges, selectedEdge, alignment, zoom, engine,
    ...(preview ? { readOnly: true } : {}),
    storedRoutes: preview?.state.edgeRoutes ?? session.edgeRoutes,
    storedDisplayRoutes: preview?.state.displayRoutes ?? session.displayRoutes,
    frozenGroups:preview?.state.frozenGroups??session.frozenGroups,
    labelPins: preview ? preview.state.labelPins ?? [] : session.labelPins,
    toggleNode, canToggleHierarchy: session.viewMode === 'structure', viewMode: session.viewMode, chooseEdge, renameNode, commitRename: requestFinish,
  });
  const selectedDisplayEdge = selectedEdge ? displayEdges.find((edge) => edge.id === selectedEdge) : undefined;
  const selectedCanonicalEdgeId = selectedDisplayEdge && !selectedDisplayEdge.aggregated ? selectedDisplayEdge.members[0]?.canonicalEdgeId : undefined;
  const selectedRouteState = selectedCanonicalEdgeId ? routeStateFor(session.edgeRoutes, selectedCanonicalEdgeId) : undefined;
  const labelState = selectedDisplayEdge ? {
    pinned: !!labelPinForEdge(session.labelPins, selectedDisplayEdge),
    visible: !!scene.labelLayout.labels.get(selectedDisplayEdge.id)?.placement,
  } : undefined;
  const setLabelPinned = useCallback((pinned: boolean) => {
    if (preview || !selectedDisplayEdge) return;
    const label = scene.labelLayout.labels.get(selectedDisplayEdge.id)?.placement;
    if (pinned && !label) return;
    captureRendered.current();
    session.commitContent((current) => ({ ...current, labelPins: pinned
      ? upsertLabelPin(current.labelPins ?? [], pinLabelForEdge(selectedDisplayEdge, label!))
      : removeLabelPinForEdge(current.labelPins ?? [], selectedDisplayEdge) }));
  }, [preview, selectedDisplayEdge, scene.labelLayout, session.commitContent]);
  const dragProfile = useDragProfile(scene.routeStats);
  recordConstraint.current = dragProfile.recordConstraint;
  const beginDrag = useCallback(() => { if (!preview) { captureRendered.current(); dragging.current=true; begin(); dragProfile.start(); } }, [begin, dragProfile.start, preview]);
  const finishDrag = useCallback(() => {
    if (preview) return;
    if (baseline.layout?.kind === 'manual') {
      const current = nodesRef.current, roots = new Set(selectionRoots(current).map((node) => node.id));
      const fitted = fitAuthoredLayout(current, current, [...roots], baseline.stage, roots);
      const issue = fitted.conflict?.message ?? validateStoredRoutes(current, fitted.nodes, session.routesRef.current, projectionRef.current)
        ?? validateFrozenConnections(current, fitted.nodes, baseline.stage, session.routesRef.current, session.frozenRef.current)[0]?.message;
      if (issue) setMessage(issue); else setNodes(fitted.nodes);
    }
    dragging.current = false; requestFinish(); setAlignment([]);
  }, [baseline, requestFinish, preview, setNodes]);
  useLayoutEffect(() => {
    const frame = scene.frame;
    routesRef.current = scene.labelledRoutes;
    const capture = () => {
      if (preview || frame.baselineId !== baselineId || frame.geometryKey !== sceneGeometryKey(nodesRef.current)) return;
      session.setDisplayRoutes(frame.snapshots, frame.geometryKey, frame.baselineId, frame.viewMode);
    };
    captureRendered.current = capture;
    if (preview || frame.geometryKey !== sceneGeometryKey(nodesRef.current) || dragging.current) return;
    if (pendingFinish.current) {
      pendingFinish.current = false; capture(); finish(); dragProfile.stop();
      const navigation = deferredNavigation.current; deferredNavigation.current = undefined; navigation?.();
    } else session.cacheRenderedRoutes(frame.snapshots, frame.geometryKey, frame.baselineId, frame.viewMode);
  }, [scene.frame.geometryKey, scene.frame.snapshots, scene.frame.viewMode, scene.labelledRoutes, baselineId, preview, finishRevision, finish, session.setDisplayRoutes, session.cacheRenderedRoutes, dragProfile.stop]);
  const saveViewport = useCallback((viewport: { x: number; y: number; zoom: number }) => { if (!preview) session.saveViewport(viewport); }, [preview, session.saveViewport]);
  return {
    ...scene, ...session, saveViewport, undo, redo, baselines: props.baselines, theme, setTheme, boxMode, setBoxMode, grid, setGrid, zoom, setZoom,
    viewMode: session.viewMode, selectView, confirmedAt: session.confirmedAt, confirmationStatus: session.confirmationStatus,
    setSelectedEdge, setAlignment, onNodesChange, toggleNode, chooseEdge, selectBaseline, createGroup, dissolveGroup,
    setLayoutMode, freezeLayout, beginDrag, finishDrag, confirmStage, cancelPreview, adoptPreview, preview,
    freezeSubgraph, unfreezeSelected, setEdgeRouteState, selectedRouteState, labelState, setLabelPinned,
    dragProfile: dragProfile.result,
    zoomIn: () => flow.zoomIn(), zoomOut: () => flow.zoomOut(), fitView,
    connectionEdge, closeConnections, locateConnection, message, clearMessage,
  };
}
