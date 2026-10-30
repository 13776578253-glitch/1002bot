import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { MarkerType, type Edge } from '@xyflow/react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { Rect } from '../../core/layout/geometry.ts';
import type { LinkData } from '../components/relation-edge.tsx';
import { leafMembers, selectionRoots, worldPosition, type CanvasNode } from '../model/grouping.ts';
import { hierarchyProjection, nodeIsVisible } from '../model/hierarchy.ts';
import { routeDiagramEdge } from '../model/routing.ts';
import { placeEdgeLabel } from '../model/labels.ts';
import { relationLabel } from '../model/change.ts';
import { clipAlignmentGuides } from '../model/guides.ts';
import type { AlignmentGuide } from '../model/constraints.ts';

interface SceneState {
  nodes: CanvasNode[];
  baseline: VisualizationBaseline;
  selectedEdge: string | undefined;
  alignment: AlignmentGuide[];
  zoom: number;
  toggleNode(id: string): void;
  chooseEdge(id: string): void;
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
}

export function useCanvasScene({ nodes, baseline, selectedEdge, alignment, zoom, toggleNode, chooseEdge, setNodes }: SceneState) {
  const expandedKey = nodes.filter((node) => node.data.expanded).map((node) => node.id).join('|');
  const projection = useMemo(() => hierarchyProjection(nodes, baseline.stage), [expandedKey, baseline]);
  const routes = useMemo(() => {
    const visible = nodes.filter((node) => nodeIsVisible(node, nodes, projection));
    const bounds = (node: CanvasNode): Rect => ({ ...worldPosition(node, nodes), w: node.width!, h: node.height! });
    const blockers = visible.map((node) => node.type === 'card' ? bounds(node) : { ...bounds(node), h: node.type === 'structure' ? 68 : 54 });
    const frames = visible.filter((node) => node.type !== 'card').map(bounds);
    const occupied: Rect[] = [];
    return new Map(projection.edges.map((edge) => {
      const route = routeDiagramEdge(nodes, projection, edge.source.nodeId, edge.target.nodeId);
      const change = baseline.edgeChanges[edge.canonicalEdgeId]!;
      const text = relationLabel(edge.label ?? '', change);
      const label = placeEdgeLabel(route.points, text, blockers, frames, occupied);
      occupied.push({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
      return [edge.canonicalEdgeId, { ...route, label, text, change }];
    }));
  }, [nodes, projection, baseline]);
  const selected = nodes.filter((node) => node.selected && nodeIsVisible(node, nodes, projection));
  const selectedIds = new Set(selected.map((node) => node.id));
  const leafIds = leafMembers(nodes, selectedIds);
  const connected = new Set<string>();
  const edges: Edge<LinkData>[] = projection.edges.map((edge) => {
    const id = edge.canonicalEdgeId;
    const route = routes.get(id)!;
    const active = leafIds.has(edge.source.canonicalNodeId) || leafIds.has(edge.target.canonicalNodeId) || id === selectedEdge;
    if (active) { connected.add(edge.source.nodeId); connected.add(edge.target.nodeId); }
    return {
      id, source: edge.source.nodeId, target: edge.target.nodeId,
      sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
      type: 'link', label: route.text, selected: id === selectedEdge,
      data: { active, relation: edge.relation, change: route.change, points: route.points, label: route.label, onSelect: chooseEdge },
      zIndex: 50,
      style: { stroke: `var(--change-${route.change.kind})`, strokeWidth: active ? 2.3 : 1.5, strokeDasharray: edge.relation === 'event' ? '5 5' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: `var(--change-${route.change.kind})`, width: 16, height: 16 },
    };
  });
  const displayNodes = nodes.map((node): CanvasNode => {
    const parent = nodes.find((item) => item.id === node.parentId);
    const visible = nodeIsVisible(node, nodes, projection);
    const { extent: _extent, ...base } = node;
    let depth = 0, ancestor = parent;
    while (ancestor) { depth += 1; ancestor = nodes.find((item) => item.id === ancestor?.parentId); }
    return { ...base,
      hidden: !visible,
      zIndex: node.type === 'card' ? 100 : depth,
      data: { ...node.data, onToggle: () => toggleNode(node.id), onRename: (title: string) => setNodes((current) => current.map((item) => item.id === node.id ? { ...item, data: { ...item.data, title } } : item)) },
      className: connected.has(node.id) && !node.selected ? 'is-neighbor' : '',
      ariaLabel: node.type === 'cluster' ? `聚合框：${node.data.title}` : node.data.title,
    };
  });
  const roots = selectionRoots(nodes).filter((node) => nodeIsVisible(node, nodes, projection));
  const selectedGroup = selected.length === 1 && selected[0]?.type === 'cluster' ? selected[0] : undefined;
  const selectedContainer = selected.length === 1 && (selected[0]?.type === 'cluster' || selected[0]?.type === 'structure') ? selected[0] : undefined;
  const guideBlockers = displayNodes.filter((node) => !node.hidden).map((node) => ({ ...worldPosition(node, nodes), w: node.width!, h: node.type === 'card' ? node.height! : node.type === 'structure' ? 68 : 54 }));
  for (const { label } of routes.values()) guideBlockers.push({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
  const visibleGuides = clipAlignmentGuides(alignment, guideBlockers);
  const selectionLabel = roots.length > 1 ? `已选 ${roots.length} 项` : selectedContainer?.data.title ?? '';
  return { displayNodes, edges, visibleGuides, selectedGroup, roots, selectionLabel };
}
