/** Canvas commands coordinate geometry, per-baseline transactions and source-preserving navigation. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyNodeChanges, useReactFlow, type NodeChange } from '@xyflow/react';
import type { VisualizationCanvasProps } from '../types.ts';
import { groupSelection, ungroup, type CanvasNode, type LayoutMode } from '../model/grouping.ts';
import { hierarchyProjection, nodeIsVisible, toggleHierarchy, syncHierarchyExpansion } from '../model/hierarchy.ts';
import { constrainNodeMoves, type AlignmentGuide } from '../model/constraints.ts';
import { aggregateProjectedEdges, type DisplayEdge } from '../model/display-edges.ts';
import type { CanvasWorkspaceView } from '../model/workspace.ts';
import { useWorkspaceSession } from './use-workspace-session.ts';
import { useCanvasScene } from './use-canvas-scene.ts';
import { useDragProfile } from './use-drag-profile.ts';

export function useCanvasController(props: VisualizationCanvasProps, restored?: CanvasWorkspaceView) {
  const session = useWorkspaceSession(props, restored);
  const { nodes, nodesRef, setNodes, baseline, baselineId, commit, begin, finish } = session;
  const expandedKey = nodes.filter((node) => node.data.expanded).map((node) => node.id).join('|');
  const projection = useMemo(() => hierarchyProjection(nodes, baseline.stage), [expandedKey, baseline]);
  const displayEdges = useMemo(() => aggregateProjectedEdges(projection, baseline.edgeChanges), [projection, baseline]);
  const projectionRef = useRef(projection); projectionRef.current = projection;
  const links = useMemo(() => projection.edges.map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId })), [projection]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => props.initialTheme ?? (localStorage.getItem('architecture-theme') === 'light' ? 'light' : 'dark'));
  const [boxMode, setBoxMode] = useState(false), [grid, setGrid] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [connectionEdge, setConnectionEdge] = useState<DisplayEdge>();
  const [message, setMessage] = useState('');
  const [zoom, setZoom] = useState(Math.round((session.initialViewport?.zoom ?? 1) * 100));
  const [alignment, setAlignment] = useState<AlignmentGuide[]>([]);
  const flow = useReactFlow<CanvasNode>();
  const recordConstraint = useRef<(duration: number) => void>(() => {});
  const fitView = useCallback((options: { padding: number; maxZoom: number }) => flow.fitView(options), [flow.fitView]);
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const current = nodesRef.current;
    let next = applyNodeChanges(changes, current);
    const moved = changes.flatMap((change) => change.type === 'position' && change.position ? [change.id] : []);
    if (moved.length) {
      begin();
      const visible = new Set(next.filter((node) => nodeIsVisible(node, next, projectionRef.current)).map((node) => node.id));
      const started = performance.now();
      const result = constrainNodeMoves(current, next, moved, flow.getZoom(), visible, links);
      recordConstraint.current(performance.now() - started);
      next = result.nodes;
      setAlignment(changes.some((change) => change.type === 'position' && change.dragging) ? result.guides : []);
    }
    setNodes(next);
    if (moved.length && !changes.some((change) => change.type === 'position' && change.dragging)) finish();
  }, [begin, finish, flow.getZoom, links, setNodes]);

  const toggleNode = useCallback((id: string) => {
    const current = nodesRef.current;
    const next = toggleHierarchy(current, id, baseline.stage);
    if (next === current) { setMessage('空间不足：请移动或解除相关节点的固定后再展开'); return; }
    commit(() => next); setMessage(''); setSelectedEdge(undefined);
  }, [baseline, commit]);

  const chooseEdge = useCallback((id: string) => {
    setSelectedEdge(id);
    const edge = displayEdges.find((item) => item.id === id)!;
    setConnectionEdge(edge.aggregated ? edge : undefined);
    setMessage('');
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
  }, [displayEdges, setNodes]);

  const renameNode = useCallback((id: string, title: string) => {
    const node = nodesRef.current.find((item) => item.id === id)!;
    if (node.data.layoutMode === 'locked') return;
    begin();
    setNodes((current) => current.map((item) => item.id === id ? { ...item, data: { ...item.data, title } } : item));
  }, [begin, setNodes]);

  const createGroup = useCallback(() => {
    commit((current) => groupSelection(current, `cluster-${crypto.randomUUID()}`));
    setSelectedEdge(undefined); setBoxMode(false);
  }, [commit]);
  const dissolveGroup = useCallback((id: string) => { commit((current) => ungroup(current, id)); }, [commit]);
  const setLayoutMode = useCallback((mode: LayoutMode) => {
    commit((current) => current.map((node) => node.selected && nodeIsVisible(node, current, projectionRef.current) ? { ...node, data: { ...node.data, layoutMode: mode } } : node));
    setMessage('');
  }, [commit]);
  const freezeLayout = useCallback(() => {
    commit((current) => current.map((node) => (node.data.layoutMode ?? 'free') === 'free' && nodeIsVisible(node, current, projectionRef.current) ? { ...node, data: { ...node.data, layoutMode: 'fixed' } } : node));
    setMessage('');
  }, [commit]);

  const selectBaseline = useCallback((id: string) => {
    if (id === baselineId) return;
    session.saveViewport(flow.getViewport());
    const target = props.baselines.find((item) => item.id === id)!;
    session.switchBaseline(id, (destination, source) => {
      const next = syncHierarchyExpansion(destination, source, target.stage);
      const wanted = new Map(source.filter((node) => node.data.expandable).map((node) => [node.id, !!node.data.expanded]));
      setMessage(next.some((node) => wanted.has(node.id) && node.data.expandable && wanted.get(node.id) !== !!node.data.expanded) ? '部分模块空间不足，已保留目标阶段的原展开状态' : '');
      return next;
    });
    setSelectedEdge(undefined); setConnectionEdge(undefined); setAlignment([]); setBoxMode(false);
  }, [baselineId, session.saveViewport, session.switchBaseline, props.baselines, flow.getViewport]);
  useEffect(() => {
    const viewport = session.getViewport(baselineId);
    if (viewport) void flow.setViewport(viewport);
  }, [baselineId]);

  const locateConnection = useCallback((id: string) => {
    const edge = baseline.stage.graph.edges.find((item) => item.id === id)!;
    const graph = new Map(baseline.stage.graph.nodes.map((node) => [node.id, node]));
    const ancestors = new Set<string>();
    const collect = (id: string): void => { const parent = graph.get(id)!.parentId; if (parent && parent !== baseline.stage.graph.rootId) { collect(parent); ancestors.add(parent); } };
    collect(edge.source.nodeId); collect(edge.target.nodeId);
    let next = nodesRef.current;
    for (const parent of ancestors) {
      if (next.find((node) => node.id === parent)!.data.expanded) continue;
      const opened = toggleHierarchy(next, parent, baseline.stage);
      if (opened === next) { setMessage('定位所需空间不足：请先移动或解除相关节点的固定'); return; }
      next = opened;
    }
    commit(() => next);
    setSelectedEdge(id); setMessage('');
    requestAnimationFrame(() => void flow.fitView({ nodes: [{ id: edge.source.nodeId }, { id: edge.target.nodeId }], padding: 0.35, maxZoom: 1.15 }));
  }, [baseline, commit, flow.fitView]);
  const closeConnections = useCallback(() => setConnectionEdge(undefined), []);
  const clearMessage = useCallback(() => setMessage(''), []);
  const undo = useCallback(() => { session.undo(); setMessage(''); }, [session.undo]);
  const redo = useCallback(() => { session.redo(); setMessage(''); }, [session.redo]);

  useEffect(() => { localStorage.setItem('architecture-theme', theme); }, [theme]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); createGroup(); }
      if (event.key === 'Escape') { setSelectedEdge(undefined); setConnectionEdge(undefined); setBoxMode(false); setMessage(''); setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node)); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [createGroup, undo, redo, setNodes]);

  const scene = useCanvasScene({ nodes, baseline, projection, displayEdges, selectedEdge, alignment, zoom, toggleNode, chooseEdge, renameNode, commitRename: finish });
  const dragProfile = useDragProfile(scene.routeStats);
  recordConstraint.current = dragProfile.recordConstraint;
  const beginDrag = useCallback(() => { begin(); dragProfile.start(); }, [begin, dragProfile.start]);
  const finishDrag = useCallback(() => { finish(); dragProfile.stop(); setAlignment([]); }, [finish, dragProfile.stop]);
  return {
    ...scene, ...session, undo, redo, baselines: props.baselines, theme, setTheme, boxMode, setBoxMode, grid, setGrid, zoom, setZoom,
    setSelectedEdge, setAlignment, onNodesChange, toggleNode, chooseEdge, selectBaseline, createGroup, dissolveGroup,
    setLayoutMode, freezeLayout, beginDrag, finishDrag,
    dragProfile: dragProfile.result,
    zoomIn: () => flow.zoomIn(), zoomOut: () => flow.zoomOut(), fitView,
    connectionEdge, closeConnections, locateConnection, message, clearMessage,
  };
}
