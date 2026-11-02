/** Canvas commands coordinate geometry, per-baseline transactions and source-preserving navigation. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyNodeChanges, useReactFlow, type NodeChange } from '@xyflow/react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { VisualizationCanvasProps } from '../types.ts';
import { groupSelection, selectionRoots, ungroup, type CanvasNode, type LayoutMode } from '../model/grouping.ts';
import { hierarchyProjection, nodeIsVisible, toggleHierarchy, syncHierarchyExpansion } from '../model/hierarchy.ts';
import { constrainNodeMoves, type AlignmentGuide } from '../model/constraints.ts';
import { manualGeometryConflict, moveAuthoredNodes } from '../model/manual-layout.ts';
import { aggregateProjectedEdges, type DisplayEdge } from '../model/display-edges.ts';
import { freezeSelection, frozenGroupFor, toggleFrozenExpansion } from '../model/frozen.ts';
import { removeRoute, routeSnapshotForEdge, routeStateFor, upsertRoute, validateStoredRoutes, worldRoutePoints, reservedLockedRoutes } from '../model/edge-routes.ts';
import { captureDisplayRoutes } from '../model/display-route-snapshots.ts';
import type { CachedRoute } from '../model/route-cache.ts';
import type { StageViewState } from '../model/stage-transition.ts';
import { prepareStageNavigation } from '../model/stage-navigation.ts';
import type { StageInheritanceBase } from '../model/snapshot-inheritance.ts';
import type { StageTransitionSuccess } from '../model/stage-transition.ts';
import { captureFrozenSubgraph, validateFrozenConnections, releaseFrozenSubgraph } from '../model/blackbox-routes.ts';
import { rebaseFrozenGrowth } from '../model/frozen-growth.ts';
import type { StageConflict } from '../model/stage-types.ts';
import type { CanvasWorkspaceView, EdgeRouteState, FrozenGroupSnapshot } from '../model/workspace.ts';
import { useWorkspaceSession } from './use-workspace-session.ts';
import { useCanvasScene } from './use-canvas-scene.ts';
import { useDragProfile } from './use-drag-profile.ts';

interface TransitionPreview {
  targetId: string;
  baseline: VisualizationBaseline;
  state: StageViewState;
  conflicts: StageConflict[];
  reset?: { result: StageTransitionSuccess; inheritance: StageInheritanceBase };
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
  const [message, setMessage] = useState('');
  const [zoom, setZoom] = useState(Math.round((session.initialViewport?.zoom ?? 1) * 100));
  const [alignment, setAlignment] = useState<AlignmentGuide[]>([]);
  const [engine] = useState<'legacy' | 'group'>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('routing') === 'group' ? 'group' : 'legacy');
  const [routingDragging, setRoutingDragging] = useState(false);
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
  const fitView = useCallback((options: { padding: number; maxZoom: number }) => flow.fitView(options), [flow.fitView]);
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    if (preview) return;
    const current = nodesRef.current;
    let next = applyNodeChanges(changes, current);
    const moved = changes.flatMap((change) => change.type === 'position' && change.position ? [change.id] : []);
    if (moved.length) {
      begin();
      const visible = new Set(next.filter((node) => nodeIsVisible(node, next, projectionRef.current)).map((node) => node.id));
      const started = performance.now();
      const result = baseline.layout?.kind === 'manual'
        ? { nodes: moveAuthoredNodes(current, next, moved, baseline.stage), guides: [] }
        : constrainNodeMoves(current, next, moved, flow.getZoom(), visible, links);
      next = result.nodes;
      const grown=rebaseFrozenGrowth(current,next,session.routesRef.current,session.frozenRef.current);
      const routeConflict = validateStoredRoutes(current, next, session.routesRef.current, projectionRef.current,grown.routes);
      const connections=routeConflict?[]:validateFrozenConnections(current,next,baseline.stage,grown.routes,grown.groups,routesRef.current);
      if (routeConflict||connections.length) { next = current; setMessage(routeConflict??connections[0]!.message); }
      else {if(grown.routes!==session.routesRef.current)session.setRoutes(grown.routes);if(grown.groups!==session.frozenRef.current)session.setFrozenGroups(grown.groups);}
      setAlignment(changes.some((change) => change.type === 'position' && change.dragging) ? result.guides : []);
      recordConstraint.current(performance.now() - started);
    }
    setNodes(next);
    if (moved.length && !dragging.current && !changes.some((change) => change.type === 'position' && change.dragging)) { captureRendered.current(); finish(); }
  }, [baseline, begin, finish, flow.getZoom, links, preview, setNodes]);

  const toggleNode = useCallback((id: string) => {
    if (preview) return;
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
    const next = toggleHierarchy(current, id, baseline.stage);
    if (next === current) { setMessage('空间不足：请移动或解除相关节点的固定后再展开'); return; }
    const conflict = validateStoredRoutes(current, next, session.routesRef.current, hierarchyProjection(next, baseline.stage));
    if (conflict) { setMessage(conflict); return; }
    if (commit(() => next)) setMessage(''); setSelectedEdge(undefined);
  }, [baseline, commit, preview]);

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
    commit((current) => groupSelection(current, `cluster-${crypto.randomUUID()}`, baseline.layout?.kind === 'manual'));
    setSelectedEdge(undefined); setBoxMode(false);
  }, [baseline, commit, preview]);
  const dissolveGroup = useCallback((id: string) => { if (!preview) commit((current) => ungroup(current, id, baseline.layout?.kind === 'manual')); }, [baseline, commit, preview]);
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

  const selectBaseline = useCallback((id: string) => {
    if (preview) { setPreview(undefined); setMessage('已取消候选预览'); return; }
    if (id === baselineId) return;
    captureRendered.current();
    const target = props.baselines.find((item) => item.id === id)!;
    const targetRevision = target.stage.graph.revision ?? target.stage.id;
    const saved = session.getSavedContent(id);
    const targetIndex = props.baselines.findIndex((item) => item.id === id);
    const parentId = target.previousStageId ?? props.baselines[targetIndex - 1]?.id;
    const synchronize = (destination: CanvasNode[], source: CanvasNode[], routes: typeof session.edgeRoutes, groups: FrozenGroupSnapshot[]) => {
      let conflict = '';
      const next = syncHierarchyExpansion(destination, source, target.stage, (before, after) => {
        const issue = validateStoredRoutes(before, after, routes, hierarchyProjection(after, target.stage))
          ?? validateFrozenConnections(before, after, target.stage, routes, groups)[0]?.message;
        if (issue) { conflict = issue; return false; }
        return true;
      });
      const wanted = new Map(source.filter(node => node.data.expandable).map(node => [node.id, !!node.data.expanded]));
      const partial = next.some(node => !node.data.frozen && wanted.has(node.id) && node.data.expandable && wanted.get(node.id) !== !!node.data.expanded);
      setMessage(conflict || (partial ? '部分模块空间不足，已保留目标阶段的原展开状态' : ''));
      return next;
    };
    if (!parentId && (!saved || saved.revision === targetRevision)) {
      session.saveViewport(flow.getViewport());
      session.switchBaseline(id, (destination, source) => synchronize(destination, source, saved?.content.edgeRoutes ?? [], saved?.content.frozenGroups ?? []));
      clearTransientState();
      return;
    }
    const parent = parentId ? props.baselines.find((item) => item.id === parentId)! : baseline;
    const sourceContent = session.getConfirmedContent(parent.id);
    if (!sourceContent) { setMessage(`请先确认 ${parent.stage.label} 阶段布局，再进入目标阶段`); return; }
    const sourceRevision = session.getSavedContent(parent.id)?.revision;
    if (sourceRevision !== (parent.stage.graph.revision ?? parent.stage.id)) { setMessage(`来源已更新，请先检查并重新确认 ${parent.stage.label}`); return; }
    const result = prepareStageNavigation({parent,target,parentContent:sourceContent,...(saved ? {saved:{...saved.content,revision:saved.revision!,...(saved.inheritance?{inheritance:saved.inheritance}:{}),...(saved.sourceStage?{sourceStage:saved.sourceStage}:{})}}:{})});
    if (!result.ok) {
      previewViewport.current = flow.getViewport();
      setPreview({ targetId: id, baseline: target, state: result.candidate, conflicts: result.conflicts, ...(result.resetCandidate && result.inheritance ? {reset:{result:result.resetCandidate,inheritance:result.inheritance}}:{}) });
      setMessage('');
      clearTransientState();
      return;
    }
    session.saveViewport(flow.getViewport());
    if (result.reused) session.switchBaseline(id, (destination, source) => synchronize(destination, source, result.state.edgeRoutes, result.state.frozenGroups));
    else {
      const requiredExpansion = new Set(result.record.expanded);
      const synchronized = synchronize(result.state.nodes, nodesRef.current.filter(node => !requiredExpansion.has(node.id)), result.state.edgeRoutes, result.state.frozenGroups);
      session.applyStageTransition(id, { ...result.state, nodes: synchronized }, result.base, result.record, result.inheritance);
    }
    setPreview(undefined);
    clearTransientState();
  }, [baseline, baselineId, clearTransientState, flow.getViewport, preview, props.baselines, session]);

  const confirmStage = useCallback(() => {
    if (preview) return;
    captureRendered.current();
    session.confirm();
    setPreview(undefined);
    setMessage('已确认当前阶段布局，可作为后续阶段基础');
  }, [preview, session.confirm]);
  const cancelPreview = useCallback(() => { setPreview(undefined); setMessage('已取消候选预览'); }, []);
  const adoptPreview = useCallback(() => {
    if (!preview?.reset) return;
    const {result,inheritance}=preview.reset;
    session.applyStageTransition(preview.targetId,result.state,session.getSavedContent(preview.targetId)!.content,result.record,inheritance);
    previewViewport.current=undefined;
    setPreview(undefined);setMessage('已从父阶段重新继承，旧视图可撤销恢复');
  },[preview,session]);

  useEffect(() => {
    if (preview) return;
    const viewport = previewViewport.current ?? session.getViewport(baselineId);
    previewViewport.current = undefined;
    if (viewport) void flow.setViewport(viewport);
  }, [baselineId, preview]);

  const locateConnection = useCallback((id: string) => {
    if (preview) return;
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
  }, [baseline, commit, flow.fitView, preview]);
  const closeConnections = useCallback(() => setConnectionEdge(undefined), []);
  const clearMessage = useCallback(() => setMessage(''), []);
  const undo = useCallback(() => { if (!preview) { captureRendered.current(); session.undo(); setMessage(''); } }, [preview, session.undo]);
  const redo = useCallback(() => { if (!preview) { captureRendered.current(); session.redo(); setMessage(''); } }, [preview, session.redo]);

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
    nodes: activeNodes, baseline: activeBaseline, projection, displayEdges, selectedEdge, alignment, zoom, engine, dragging: routingDragging,
    ...(preview ? { readOnly: true } : {}),
    storedRoutes: preview?.state.edgeRoutes ?? session.edgeRoutes,
    storedDisplayRoutes: preview?.state.displayRoutes ?? session.displayRoutes,
    frozenGroups:preview?.state.frozenGroups??session.frozenGroups,
    toggleNode, chooseEdge, renameNode, commitRename: finish,
  });
  routesRef.current = scene.routes;
  captureRendered.current = () => session.setDisplayRoutes(scene.snapshotRoutes(nodesRef.current));
  const selectedDisplayEdge = selectedEdge ? displayEdges.find((edge) => edge.id === selectedEdge) : undefined;
  const selectedCanonicalEdgeId = selectedDisplayEdge && !selectedDisplayEdge.aggregated ? selectedDisplayEdge.members[0]?.canonicalEdgeId : undefined;
  const selectedRouteState = selectedCanonicalEdgeId ? routeStateFor(session.edgeRoutes, selectedCanonicalEdgeId) : undefined;
  const dragProfile = useDragProfile(scene.routeStats);
  recordConstraint.current = dragProfile.recordConstraint;
  const beginDrag = useCallback(() => { if (!preview) { captureRendered.current(); dragging.current=true; setRoutingDragging(true); begin(); dragProfile.start(); } }, [begin, dragProfile.start, preview]);
  const finishDrag = useCallback(() => { if (!preview) { captureRendered.current(); dragging.current=false; setRoutingDragging(false); finish(); dragProfile.stop(); setAlignment([]); } }, [dragProfile.stop, finish, preview]);
  const saveViewport = useCallback((viewport: { x: number; y: number; zoom: number }) => { if (!preview) session.saveViewport(viewport); }, [preview, session.saveViewport]);
  return {
    ...scene, ...session, saveViewport, undo, redo, baselines: props.baselines, theme, setTheme, boxMode, setBoxMode, grid, setGrid, zoom, setZoom,
    setSelectedEdge, setAlignment, onNodesChange, toggleNode, chooseEdge, selectBaseline, createGroup, dissolveGroup,
    setLayoutMode, freezeLayout, beginDrag, finishDrag, confirmStage, cancelPreview, adoptPreview, preview,
    freezeSubgraph, unfreezeSelected, setEdgeRouteState, selectedRouteState,
    dragProfile: dragProfile.result,
    zoomIn: () => flow.zoomIn(), zoomOut: () => flow.zoomOut(), fitView,
    connectionEdge, closeConnections, locateConnection, message, clearMessage,
  };
}
