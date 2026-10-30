import { useCallback, useEffect, useRef, useState } from 'react';
import { applyNodeChanges, useReactFlow, type NodeChange } from '@xyflow/react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { VisualizationCanvasProps } from '../types.ts';
import { groupSelection, type CanvasNode } from '../model/grouping.ts';
import { createHierarchyNodes, hierarchyProjection, nodeIsVisible, toggleHierarchy, syncHierarchyExpansion } from '../model/hierarchy.ts';
import { constrainNodeMoves, type AlignmentGuide } from '../model/constraints.ts';
import { useCanvasScene } from './use-canvas-scene.ts';

function baselineNodes(baseline: VisualizationBaseline): CanvasNode[] {
  return createHierarchyNodes(baseline.stage, baseline.positions).map((node) => ({ ...node, data: { ...node.data, change: baseline.nodeChanges[node.id]! } }));
}

export function useCanvasController({ baselines, initialBaselineId, initialTheme }: VisualizationCanvasProps) {

  const [baselineId, setBaselineId] = useState(initialBaselineId ?? baselines[baselines.length - 1]!.id);
  const baseline = baselines.find((item) => item.id === baselineId)!;
  const [nodes, setNodes] = useState<CanvasNode[]>(() => baselineNodes(baseline));
  const layouts = useRef(new Map<string, CanvasNode[]>());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => initialTheme ?? (localStorage.getItem('architecture-theme') === 'light' ? 'light' : 'dark'));
  const [boxMode, setBoxMode] = useState(false);
  const [grid, setGrid] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [zoom, setZoom] = useState(100);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const groupCounter = useRef(0);
  const [alignment, setAlignment] = useState<AlignmentGuide[]>([]);
  const flow = useReactFlow<CanvasNode>();
  const fitView = useCallback((options: { padding: number; maxZoom: number }) => flow.fitView(options), [flow.fitView]);
  const zoomIn = () => flow.zoomIn();
  const zoomOut = () => flow.zoomOut();
  const getZoom = flow.getZoom;
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => setNodes((current) => {
    let next = applyNodeChanges(changes, current);
    const moved = changes.flatMap((change) => change.type === 'position' && change.position ? [change.id] : []);
    if (moved.length) {
      const projection = hierarchyProjection(next, baseline.stage);
      const visible = new Set(next.filter((node) => nodeIsVisible(node, next, projection)).map((node) => node.id));
      const result = constrainNodeMoves(current, next, moved, getZoom(), visible, projection.edges.map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId })));
      next = result.nodes;
      setAlignment(changes.some((change) => change.type === 'position' && change.dragging) ? result.guides : []);
    }
    return next;
  }), [getZoom, baseline]);
  const toggleNode = useCallback((id: string) => {
    setNodes((current) => toggleHierarchy(current, id, baseline.stage));
    setSelectedEdge(undefined);
    setLayoutRevision((version) => version + 1);
  }, [baseline]);
  const selectBaseline = (id: string) => {
    if (id === baselineId) return;
    layouts.current.set(baselineId, nodes.map((node) => ({ ...node, selected: false })));
    const next = baselines.find((item) => item.id === id)!;
    setNodes(syncHierarchyExpansion(layouts.current.get(id) ?? baselineNodes(next), nodes, next.stage));
    setBaselineId(id);
    setSelectedEdge(undefined);
    setAlignment([]);
    setBoxMode(false);
    setLayoutRevision((version) => version + 1);
  };
  useEffect(() => {
    if (!layoutRevision) return;
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.12, maxZoom: 1.15 }));
    return () => cancelAnimationFrame(frame);
  }, [layoutRevision, fitView]);
  const chooseEdge = useCallback((id: string) => {
    setSelectedEdge(id);
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
  }, [setNodes]);
  const createGroup = useCallback(() => {
    setNodes((current) => groupSelection(current, `cluster-${++groupCounter.current}`));
    setSelectedEdge(undefined);
    setBoxMode(false);
  }, [setNodes]);
  useEffect(() => {
    localStorage.setItem('architecture-theme', theme);
  }, [theme]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); createGroup(); }
      if (event.key === 'Escape') { setSelectedEdge(undefined); setBoxMode(false); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [createGroup, setNodes]);

  const scene = useCanvasScene({ nodes, baseline, selectedEdge, alignment, zoom, toggleNode, chooseEdge, setNodes });
  return { ...scene, nodes, setNodes, baselines, baselineId, theme, setTheme, boxMode, setBoxMode, grid, setGrid, zoom, setZoom, setSelectedEdge, setAlignment, onNodesChange, toggleNode, chooseEdge, selectBaseline, createGroup, zoomIn, zoomOut, fitView };
}
