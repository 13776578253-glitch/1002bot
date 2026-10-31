/** Cached geometry and stable render entities; selection and viewport have no routing dependencies. */
import { useMemo, useRef } from 'react';
import { MarkerType, type Edge } from '@xyflow/react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { Projection } from '../../core/projection/index.ts';
import type { LinkData } from '../components/relation-edge.tsx';
import { leafMembers, selectionRoots, worldPosition, type CanvasNode } from '../model/grouping.ts';
import { nodeIsVisible } from '../model/hierarchy.ts';
import { DiagramRouteCache } from '../model/route-cache.ts';
import type { DisplayEdge } from '../model/display-edges.ts';
import { clipAlignmentGuides } from '../model/guides.ts';
import type { AlignmentGuide } from '../model/constraints.ts';

interface SceneState {
  nodes: CanvasNode[];
  baseline: VisualizationBaseline;
  projection: Projection;
  displayEdges: DisplayEdge[];
  selectedEdge: string | undefined;
  alignment: AlignmentGuide[];
  zoom: number;
  toggleNode(id: string): void;
  chooseEdge(id: string): void;
  renameNode(id: string, title: string): void;
  commitRename(): void;
}

export function useCanvasScene({ nodes, projection, displayEdges, selectedEdge, alignment, toggleNode, chooseEdge, renameNode, commitRename }: SceneState) {
  const geometryKey = nodes.map((node) => `${node.id}:${node.parentId ?? ''}:${node.type}:${node.position.x},${node.position.y},${node.width},${node.height}`).join('|');
  const parentKey = nodes.map((node) => `${node.id}:${node.parentId ?? ''}`).join('|');
  const selectedKey = nodes.filter((node) => node.selected).map((node) => node.id).join('|');
  const cache = useMemo(() => new DiagramRouteCache(), []);
  const routeInputs = useMemo(() => displayEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })), [displayEdges]);
  const routes = useMemo(() => cache.update(nodes, projection, routeInputs), [geometryKey, projection, routeInputs]);
  const members = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    return counts;
  }, [parentKey]);
  const leafIds = useMemo(() => leafMembers(nodes, new Set(nodes.filter((node) => node.selected).map((node) => node.id))), [selectedKey, parentKey]);
  const edgeCache = useRef(new Map<string, { route: unknown; source: DisplayEdge; active: boolean; selected: boolean; callback: unknown; value: Edge<LinkData> }>());
  const connected = new Set<string>();
  const nextEdges = displayEdges.map((edge): Edge<LinkData> => {
    const route = routes.get(edge.id)!;
    const active = edge.id === selectedEdge || edge.members.some((member) => member.canonicalEdgeId === selectedEdge || leafIds.has(member.source.canonicalNodeId) || leafIds.has(member.target.canonicalNodeId));
    const selected = edge.id === selectedEdge || edge.members.some((member) => member.canonicalEdgeId === selectedEdge);
    if (active) { connected.add(edge.source); connected.add(edge.target); }
    const cached = edgeCache.current.get(edge.id);
    if (cached && cached.route === route && cached.source === edge && cached.active === active && cached.selected === selected && cached.callback === chooseEdge) return cached.value;
    const marker = { type: MarkerType.ArrowClosed, color: `var(--change-${edge.change.kind})`, width: 16, height: 16 };
    const value: Edge<LinkData> = {
      id: edge.id, source: edge.source, target: edge.target, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
      type: 'link', label: edge.text, selected, zIndex: 50,
      data: { active, relation: edge.relation, change: edge.change, points: route.points, label: route.label, onSelect: chooseEdge, ...(edge.aggregated ? { counts: { added: edge.added, replaced: edge.replaced, title: edge.text.split(' · ')[0]! } } : {}) },
      style: { stroke: `var(--change-${edge.change.kind})`, strokeWidth: active ? 2.3 : 1.5, ...(edge.relation === 'event' ? { strokeDasharray: '5 5' } : {}) },
      markerEnd: marker, ...(edge.direction === 'bidirectional' ? { markerStart: marker } : {}),
    };
    edgeCache.current.set(edge.id, { route, source: edge, active, selected, callback: chooseEdge, value });
    return value;
  });
  for (const id of edgeCache.current.keys()) if (!routes.has(id)) edgeCache.current.delete(id);
  const previousEdges = useRef<Edge<LinkData>[]>([]);
  if (nextEdges.length !== previousEdges.current.length || nextEdges.some((edge, index) => edge !== previousEdges.current[index])) previousEdges.current = nextEdges;
  const edges = previousEdges.current;

  const handlers = useMemo(() => new Map(nodes.map((node) => [node.id, { onToggle: () => toggleNode(node.id), onRename: (title: string) => renameNode(node.id, title), onRenameCommit: commitRename }])), [parentKey, toggleNode, renameNode, commitRename]);
  const nodeCache = useRef(new Map<string, { input: CanvasNode; visible: boolean; neighbor: boolean; handlers: unknown; count: number; value: CanvasNode }>());
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const nextDisplayNodes = nodes.map((node): CanvasNode => {
    const visible = nodeIsVisible(node, nodes, projection), neighbor = connected.has(node.id) && !node.selected;
    const callbacks = handlers.get(node.id)!, count = members.get(node.id) ?? 0;
    const cached = nodeCache.current.get(node.id);
    if (cached && cached.input === node && cached.visible === visible && cached.neighbor === neighbor && cached.handlers === callbacks && cached.count === count) return cached.value;
    let depth = 0, parent = node.parentId ? byId.get(node.parentId) : undefined;
    while (parent) { depth++; parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
    const { extent: _extent, ...base } = node;
    const value: CanvasNode = { ...base, hidden: !visible, draggable: node.data.layoutMode !== 'locked', zIndex: node.type === 'card' ? 100 : depth,
      data: { ...node.data, ...callbacks, childCount: count }, className: neighbor ? 'is-neighbor' : '', ariaLabel: node.type === 'cluster' ? `聚合框：${node.data.title}` : node.data.title };
    nodeCache.current.set(node.id, { input: node, visible, neighbor, handlers: callbacks, count, value });
    return value;
  });
  for (const id of nodeCache.current.keys()) if (!byId.has(id)) nodeCache.current.delete(id);
  const previousNodes = useRef<CanvasNode[]>([]);
  if (nextDisplayNodes.length !== previousNodes.current.length || nextDisplayNodes.some((node, index) => node !== previousNodes.current[index])) previousNodes.current = nextDisplayNodes;
  const displayNodes = previousNodes.current;
  const selected = nodes.filter((node) => node.selected && nodeIsVisible(node, nodes, projection));
  const selectedRoots = useMemo(() => new Set(selectionRoots(nodes).map((node) => node.id)), [selectedKey, parentKey]);
  const roots = nodes.filter((node) => selectedRoots.has(node.id) && nodeIsVisible(node, nodes, projection));
  const selectedGroup = selected.length === 1 && selected[0]?.type === 'cluster' ? selected[0] : undefined;
  const guideBlockers = alignment.length ? displayNodes.filter((node) => !node.hidden).map((node) => ({ ...worldPosition(node, nodes), w: node.width!, h: node.type === 'card' ? node.height! : node.type === 'structure' ? 68 : 54 })) : [];
  if (alignment.length) for (const { label } of routes.values()) guideBlockers.push({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
  return {
    displayNodes, edges, visibleGuides: clipAlignmentGuides(alignment, guideBlockers), selectedGroup, roots,
    selectionLabel: roots.length > 1 ? `已选 ${roots.length} 项` : roots[0]?.data.title ?? '',
    selectedModes: new Set(selected.map((node) => node.data.layoutMode ?? 'free')), routeStats: cache.lastStats,
  };
}
