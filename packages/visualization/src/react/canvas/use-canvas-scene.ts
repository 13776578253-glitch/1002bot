/** Cached geometry and stable render entities; selection and viewport have no routing dependencies. */
import { useMemo, useRef } from 'react';
import { MarkerType, type Edge } from '@xyflow/react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { Projection } from '../../core/projection/index.ts';
import type { LinkData } from '../components/relation-edge.tsx';
import { leafMembers, selectionRoots, worldPosition, type CanvasNode } from '../model/grouping.ts';
import { nodeIsVisible } from '../model/hierarchy.ts';
import { DiagramRouteCache, type CachedRoute } from '../model/route-cache.ts';
import type { GroupSolveOutcome } from '../model/route-groups.ts';
import { selectCanvasRoutes } from '../model/route-selection.ts';
import { GroupRouteCache, type GroupRouteCacheStats } from '../model/group-route-cache.ts';
import { routingFallback, type RoutingFallbackReason, type RoutingStatus } from '../model/routing-status.ts';
import type { DisplayEdge } from '../model/display-edges.ts';
import { applyStoredRoutes, reservedLockedRoutes, retainedCanonicalRoutes } from '../model/edge-routes.ts';
import type { EdgeRouteSnapshot } from '../model/workspace.ts';
import type { DisplayRouteSnapshot, FrozenGroupSnapshot } from '../model/workspace.ts';
import { captureDisplayRoutes, retainedDisplayRoutes } from '../model/display-route-snapshots.ts';
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
  readOnly?: boolean;
  engine?: 'legacy' | 'group';
  storedRoutes?: readonly EdgeRouteSnapshot[];
  storedDisplayRoutes?: readonly DisplayRouteSnapshot[];
  frozenGroups?: readonly FrozenGroupSnapshot[];
  toggleNode(id: string): void;
  chooseEdge(id: string): void;
  renameNode(id: string, title: string): void;
  commitRename(): void;
}

export function useCanvasScene({ nodes, baseline, projection, displayEdges, selectedEdge, alignment, toggleNode, chooseEdge, renameNode, commitRename, readOnly = false, engine = 'legacy', storedRoutes = [], storedDisplayRoutes = [], frozenGroups=[] }: SceneState) {
  const geometryKey = nodes.map((node) => `${node.id}:${node.parentId ?? ''}:${node.type}:${node.position.x},${node.position.y},${node.width},${node.height}`).join('|');
  const parentKey = nodes.map((node) => `${node.id}:${node.parentId ?? ''}`).join('|');
  const selectedKey = nodes.filter((node) => node.selected).map((node) => node.id).join('|');
  const portPolicy = baseline.stage.presentation?.portPolicy;
  const cache = useMemo(() => new DiagramRouteCache(), [baseline.id,baseline.stage.graph.revision,readOnly]);
  const lastRenderedEngine = useRef<'legacy' | 'group'>('legacy');
  const lastVisibleRoutes = useRef<ReadonlyMap<string, CachedRoute>>(new Map());
  const routeInputs = useMemo(() => displayEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })), [displayEdges]);
  const reserved = useMemo(() => reservedLockedRoutes(storedRoutes, nodes, frozenGroups), [storedRoutes, geometryKey]);
  const retained = useMemo(() => retainedCanonicalRoutes(nodes, projection, displayEdges, storedRoutes, retainedDisplayRoutes(nodes, projection, displayEdges, storedDisplayRoutes, reserved, portPolicy), frozenGroups), [geometryKey, projection, displayEdges, storedDisplayRoutes, reserved, storedRoutes, portPolicy]);
  type GroupAttempt =
    | { status: 'disabled' }
    | { status: 'ineligible'; reason: Exclude<RoutingFallbackReason, 'incomplete' | 'error'> }
    | { status: 'result'; outcome: GroupSolveOutcome; stats: GroupRouteCacheStats }
    | { status: 'failed'; stats?: GroupRouteCacheStats; error?: string };
  const groupCache = useMemo(() => new GroupRouteCache(), [baseline.id, baseline.stage.graph.revision, engine]);
  const groupAttempt = useMemo((): GroupAttempt => {
    if (engine !== 'group') return { status: 'disabled' };
    if (readOnly) return { status: 'ineligible', reason: 'preview' };
    if (storedRoutes.length) return { status: 'ineligible', reason: 'protected-routes' };
    if (frozenGroups.length) return { status: 'ineligible', reason: 'frozen-groups' };
    if (displayEdges.some((edge) => edge.aggregated)) return { status: 'ineligible', reason: 'aggregated-edges' };
    try {
      const update = groupCache.update({
        nodes, projection, edges: routeInputs,
        ...(portPolicy ? { policy: portPolicy } : {}),
      });
      if (!update.outcome) return { status: 'failed', stats: update.stats, ...(update.error ? { error: update.error } : {}) };
      return { status: 'result', outcome: update.outcome, stats: update.stats };
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }, [engine, readOnly, storedRoutes, frozenGroups, displayEdges, geometryKey, projection, routeInputs, portPolicy, groupCache]);
  const expectedIds = routeInputs.map((edge) => edge.id);
  const groupOutcome = groupAttempt.status === 'result' ? groupAttempt.outcome : undefined;
  const groupComplete = Boolean(groupOutcome?.ok && expectedIds.every((id) => groupOutcome.routes.has(id)));
  const seed = lastRenderedEngine.current === 'group' && !groupComplete ? lastVisibleRoutes.current : undefined;
  const rawRoutes = useMemo(() => cache.update(nodes, projection, routeInputs, reserved, retained, portPolicy, seed), [geometryKey, projection, routeInputs, reserved, retained, portPolicy, seed]);
  const resolved = useMemo(() => {
    const started = performance.now();
    const routes = applyStoredRoutes(rawRoutes, displayEdges, storedRoutes, nodes, projection, frozenGroups);
    return { routes, durationMs: performance.now() - started };
  }, [rawRoutes, displayEdges, storedRoutes, geometryKey, projection, frozenGroups]);
  const selectedRoutes = selectCanvasRoutes(resolved.routes, groupOutcome, expectedIds);
  const routes = selectedRoutes.routes;
  const routingEngine = selectedRoutes.engine;
  lastRenderedEngine.current = routingEngine;
  lastVisibleRoutes.current = routes;
  const routingStatus = useMemo((): RoutingStatus => {
    if (engine !== 'group') return { requested: false, engine: 'legacy' };
    if (routingEngine === 'group') return { requested: true, engine: 'group', cache: groupAttempt.status === 'result' ? groupAttempt.stats : undefined };
    const reason: RoutingFallbackReason = groupAttempt.status === 'ineligible' ? groupAttempt.reason
      : groupAttempt.status === 'failed' ? 'error'
        : groupAttempt.status === 'result' && !groupAttempt.outcome.ok ? 'error' : 'incomplete';
    const failures = groupAttempt.status === 'result' ? groupAttempt.outcome.failures : [];
    return {
      requested: true, engine: 'legacy',
      ...(groupAttempt.status === 'result' ? { cache: groupAttempt.stats } : groupAttempt.status === 'failed' && groupAttempt.stats ? { cache: groupAttempt.stats } : {}),
      fallback: routingFallback(reason, failures),
    };
  }, [engine, routingEngine, groupAttempt]);
  const routeStats = useMemo(() => ({
    ...cache.lastStats, durationMs: cache.lastStats.durationMs + resolved.durationMs, routingMs: cache.lastStats.routingMs + resolved.durationMs,
    groupMs: groupAttempt.status === 'result' ? groupAttempt.stats.durationMs : 0,
    groupCacheMode: groupAttempt.status === 'result' ? groupAttempt.stats.mode : 'legacy',
  }), [cache, rawRoutes, resolved, geometryKey, groupAttempt]);
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
      data: { active, relation: edge.relation, change: edge.change, points: route.points, label: route.label, labelFallback: route.labelFallback, labelState: route.labelState, onSelect: chooseEdge, ...(edge.aggregated ? { counts: { added: edge.added, replaced: edge.replaced, title: edge.text.split(' · ')[0]! } } : {}) },
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
    const value: CanvasNode = { ...base, hidden: !visible, draggable: !readOnly && node.data.layoutMode !== 'locked', zIndex: node.type === 'card' ? 100 : depth,
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
    displayNodes, edges, routes, routingEngine, routingStatus, blockedRoutes: [...routes].filter(([, route]) => route.feasible === false).map(([id]) => id), visibleGuides: clipAlignmentGuides(alignment, guideBlockers), selectedGroup, roots,
    selectionLabel: roots.length > 1 ? `已选 ${roots.length} 项` : roots[0]?.data.title ?? '',
    selectedModes: new Set(selected.map((node) => node.data.layoutMode ?? 'free')), routeStats,
    snapshotRoutes: (_current: CanvasNode[]) => captureDisplayRoutes(nodes, projection, displayEdges, routes, reserved, portPolicy),
  };
}
