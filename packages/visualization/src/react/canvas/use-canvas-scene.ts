/** Canvas scene owns stable React Flow entities and route/label caches; selection, hover and viewport never solve. */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { MarkerType, type Edge } from '@xyflow/react';
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { Projection } from '../../core/projection/index.ts';
import type { LinkData } from '../components/primitives/relation-edge.tsx';
import { leafMembers, selectionRoots, structureHeaderHeight, worldPosition, type CanvasNode } from '../model/grouping.ts';
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
import { retainedDisplayRoutes } from '../model/display-route-snapshots.ts';
import { clipAlignmentGuides } from '../model/guides.ts';
import type { AlignmentGuide } from '../model/constraints.ts';
import { LabelLayoutCache } from '../model/label-layout.ts';
import { labelPinForEdge } from '../model/label-pins.ts';
import type { EdgeLabelPin, CanvasViewMode } from '../model/workspace.ts';
import { captureLabelledRoutes, labelIdentity, labelSeeds, sceneGeometryKey } from '../model/label-snapshots.ts';

/** 单帧渲染输入；stored* 是已保存内容，readOnly 时改用候选快照。 */
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
  labelPins?: readonly EdgeLabelPin[];
  toggleNode(id: string): void;
  canToggleHierarchy: boolean;
  viewMode: CanvasViewMode;
  chooseEdge(id: string): void;
  renameNode(id: string, title: string): void;
  commitRename(): void;
}

export function useCanvasScene({ nodes, baseline, projection, displayEdges, selectedEdge, alignment, toggleNode, canToggleHierarchy, viewMode, chooseEdge, renameNode, commitRename, readOnly = false, engine = 'legacy', storedRoutes = [], storedDisplayRoutes = [], frozenGroups=[], labelPins=[] }: SceneState) {
  const geometryKey = sceneGeometryKey(nodes);
  const parentKey = nodes.map((node) => `${node.id}:${node.parentId ?? ''}`).join('|');
  const selectedKey = nodes.filter((node) => node.selected).map((node) => node.id).join('|');
  const portPolicy = baseline.stage.presentation?.portPolicy;
  const cache = useMemo(() => new DiagramRouteCache(), [baseline.id,baseline.stage.graph.revision,readOnly]);
  const lastRenderedEngine = useRef<'legacy' | 'group'>('legacy');
  const lastVisibleRoutes = useRef<ReadonlyMap<string, CachedRoute>>(new Map());
  const routeInputs = useMemo(() => displayEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })), [displayEdges]);
  // 固定/锁定路径先登记为保留障碍，再参与本次求解。
  const reserved = useMemo(() => reservedLockedRoutes(storedRoutes, nodes, frozenGroups), [storedRoutes, geometryKey]);
  type GroupAttempt =
    | { status: 'disabled' }
    | { status: 'ineligible'; reason: Exclude<RoutingFallbackReason, 'incomplete' | 'error'> }
    | { status: 'result'; outcome: GroupSolveOutcome; stats: GroupRouteCacheStats }
    | { status: 'failed'; stats?: GroupRouteCacheStats; error?: string };
  const groupCache = useMemo(() => new GroupRouteCache(), [baseline.id, baseline.stage.graph.revision, engine]);
  // 组求解只在没有只读预览、固定/锁定路径、冻结组和折叠聚合边时接管。
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
  // 只有覆盖全部预期边的完整组解才替换 Legacy；否则保留旧路径。
  const groupComplete = Boolean(groupOutcome?.ok && expectedIds.every((id) => groupOutcome.routes.has(id)));
  // 组解完整时跳过 Legacy 缓存；否则先恢复固定/锁定路径和已保存的显示几何。
  const retained = useMemo(() => groupComplete ? new Map<string, CachedRoute>() : retainedCanonicalRoutes(nodes, projection, displayEdges, storedRoutes, retainedDisplayRoutes(nodes, projection, displayEdges, storedDisplayRoutes, reserved, portPolicy), frozenGroups), [groupComplete, geometryKey, projection, displayEdges, storedDisplayRoutes, reserved, storedRoutes, portPolicy]);
  // 从组解降级时，用上一帧的组路径播种 Legacy，避免引擎切换导致路径跳变。
  const seed = lastRenderedEngine.current === 'group' && !groupComplete ? lastVisibleRoutes.current : undefined;
  const legacyRoutes = useMemo(() => groupComplete ? undefined : cache.update(nodes, projection, routeInputs, reserved, retained, portPolicy, seed), [groupComplete, geometryKey, projection, routeInputs, reserved, retained, portPolicy, seed]);
  const resolved = useMemo(() => {
    if (!legacyRoutes) return { routes: undefined, durationMs: 0 };
    const started = performance.now();
    const routes = applyStoredRoutes(legacyRoutes, displayEdges, storedRoutes, nodes, projection, frozenGroups);
    return { routes, durationMs: performance.now() - started };
  }, [legacyRoutes, displayEdges, storedRoutes, geometryKey, projection, frozenGroups]);
  const selectedRoutes = selectCanvasRoutes(resolved.routes ?? new Map(), groupOutcome, expectedIds);
  const routes = selectedRoutes.routes;
  const routingEngine = selectedRoutes.engine;
  // 标签缓存按基线隔离；渲染使用 fork 草稿，提交后才 adopt，丢弃被放弃的渲染帧。
  const labelCaches = useRef(new WeakMap<VisualizationBaseline, LabelLayoutCache>());
  let labelCache = labelCaches.current.get(baseline);
  if (!labelCache) { labelCache = new LabelLayoutCache(); labelCaches.current.set(baseline, labelCache); }
  const labelDraft = useMemo(() => {
    const draft = labelCache.fork();
    const layout = draft.update(nodes, projection, displayEdges.map((edge) => {
    const fixed = labelPinForEdge(labelPins, edge)?.label;
    return { id: edge.id, text: edge.text, identity: labelIdentity(edge), priority: edge.change.kind === 'added' || edge.change.kind === 'replaced' ? 2 : 1, ...(fixed ? { fixed } : {}) };
    }), routes, labelSeeds(storedDisplayRoutes, displayEdges));
    return { draft, layout };
  }, [labelCache, routes, geometryKey, projection, displayEdges, labelPins, storedDisplayRoutes]);
  const labelLayout = labelDraft.layout;
  useLayoutEffect(() => { labelCache.adopt(labelDraft.draft); }, [labelCache, labelDraft]);
  // 路径与标签快照从同一帧生成，不重新求解；路由的 label 字段只是载体，最终位置以 labelLayout 为准。
  const snapshotLabels = useMemo(() => new Map([...routes].map(([id, route]) => {
    const label = labelLayout.labels.get(id)?.placement;
    return [id, { ...route, label: label ?? { x: 0, y: 0, width: 0, height: 0 } }];
  })), [routes, labelLayout]);
  const snapshots = useMemo(() => captureLabelledRoutes(nodes, projection, displayEdges, routes, labelLayout.labels, reserved, portPolicy), [geometryKey, projection, displayEdges, routes, labelLayout.labels, reserved, portPolicy]);
  // 只在 React 提交后更新引擎和可见路径，供下一次降级播种。
  useLayoutEffect(() => {
    lastRenderedEngine.current = routingEngine;
    lastVisibleRoutes.current = routes;
  }, [routingEngine, routes]);
  // 组求解降级原因供底部提示；拖动和预览保持静默。
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
  // 完整组解时 Legacy 计时归零，同一帧不重复统计。
  const routeStats = useMemo(() => {
    const groupMs = groupAttempt.status === 'result' ? groupAttempt.stats.durationMs : 0;
    const groupCacheMode = groupAttempt.status === 'result' ? groupAttempt.stats.mode : 'legacy';
    if (groupComplete && groupOutcome?.ok) {
      return {
        routedEdges: groupOutcome.routes.size,
        placedLabels: [...groupOutcome.routes.values()].filter((route) => route.label.width > 0).length,
        translatedEdges: 0, durationMs: groupMs, totalEdges: routeInputs.length,
        routingMs: 0, labelMs: 0, geometryMs: 0, groupMs, groupCacheMode,
      };
    }
    return {
      ...cache.lastStats, durationMs: cache.lastStats.durationMs + resolved.durationMs, routingMs: cache.lastStats.routingMs + resolved.durationMs,
      groupMs, groupCacheMode,
    };
  }, [cache, legacyRoutes, resolved, geometryKey, groupAttempt, groupComplete, groupOutcome, routeInputs.length]);
  const members = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    return counts;
  }, [parentKey]);
  const leafIds = useMemo(() => leafMembers(nodes, new Set(nodes.filter((node) => node.selected).map((node) => node.id))), [selectedKey, parentKey]);
  // 边和节点对象按输入身份缓存，未变化的引用直接复用，避免 React Flow 重渲染。
  const edgeCache = useRef(new Map<string, { route: unknown; label: unknown; source: DisplayEdge; active: boolean; selected: boolean; muted: boolean; callback: unknown; value: Edge<LinkData> }>());
  // connected 在边映射时填充，节点高亮随后读取，顺序不可交换。
  const connected = new Set<string>();
  // 选中边或选中节点的叶成员决定 active；其余边弱化但不隐藏。
  const nextEdges = displayEdges.map((edge): Edge<LinkData> => {
    const route = routes.get(edge.id)!;
    const active = edge.id === selectedEdge || edge.members.some((member) => member.canonicalEdgeId === selectedEdge || leafIds.has(member.source.canonicalNodeId) || leafIds.has(member.target.canonicalNodeId));
    const selected = edge.id === selectedEdge || edge.members.some((member) => member.canonicalEdgeId === selectedEdge);
    const muted = Boolean(selectedEdge || leafIds.size) && !active;
    const label = labelLayout.labels.get(edge.id)!;
    if (active) { connected.add(edge.source); connected.add(edge.target); }
    const cached = edgeCache.current.get(edge.id);
    if (cached && cached.route === route && cached.label === label && cached.source === edge && cached.active === active && cached.selected === selected && cached.muted === muted && cached.callback === chooseEdge) return cached.value;
    const marker = { type: MarkerType.ArrowClosed, color: `var(--change-${edge.change.kind})`, width: 16, height: 16 };
    const value: Edge<LinkData> = {
      id: edge.id, source: edge.source, target: edge.target, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
      type: 'link', label: edge.text, selected, zIndex: 50,
      ariaLabel: `连接：${edge.text}`,
      data: { active, muted, relation: edge.relation, change: edge.change, points: route.points, label: label.placement ?? { x: 0, y: 0, width: 0, height: 0 }, labelText: label.text, labelState: label.state === 'fixed' ? 'normal' : label.state, onSelect: chooseEdge },
      style: { stroke: `var(--change-${edge.change.kind})`, strokeWidth: active ? 2.3 : 1.5, ...(edge.members[0]?.edge.semantics === 'dependency' ? { strokeDasharray: '3 5' } : edge.relation === 'event' ? { strokeDasharray: '5 5' } : {}) },
      markerEnd: marker, ...(edge.direction === 'bidirectional' ? { markerStart: marker } : {}),
    };
    edgeCache.current.set(edge.id, { route, label, source: edge, active, selected, muted, callback: chooseEdge, value });
    return value;
  });
  for (const id of edgeCache.current.keys()) if (!routes.has(id)) edgeCache.current.delete(id);
  const previousEdges = useRef<Edge<LinkData>[]>([]);
  if (nextEdges.length !== previousEdges.current.length || nextEdges.some((edge, index) => edge !== previousEdges.current[index])) previousEdges.current = nextEdges;
  const edges = previousEdges.current;

  // 处理器只在父链/节点集合或交互能力变化时重建，节点内容更新复用同一引用。
  const handlers = useMemo(() => new Map(nodes.map((node) => [node.id, { ...(canToggleHierarchy ? { onToggle: () => toggleNode(node.id) } : {}), onRename: (title: string) => renameNode(node.id, title), onRenameCommit: commitRename }])), [parentKey, toggleNode, canToggleHierarchy, renameNode, commitRename]);
  const nodeCache = useRef(new Map<string, { input: CanvasNode; visible: boolean; neighbor: boolean; handlers: unknown; count: number; value: CanvasNode }>());
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // 隐藏、锁定拖动、层级 zIndex 和邻居高亮都在渲染实体上派生，不改动工作区节点。
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
  // 对齐辅助线只保留卡片、标题栏和可见标签之外的线段。
  const guideBlockers = alignment.length ? displayNodes.filter((node) => !node.hidden).map((node) => ({ ...worldPosition(node, nodes), w: node.width!, h: node.type === 'card' ? node.height! : node.type === 'structure' ? structureHeaderHeight(node) : 54 })) : [];
  if (alignment.length) for (const { placement } of labelLayout.labels.values()) if (placement) guideBlockers.push({ x: placement.x - placement.width / 2, y: placement.y - placement.height / 2, w: placement.width, h: placement.height });
  // frame 把几何键、基线/视图和最终快照绑定在一起，供控制器在提交帧读取。
  return {
    displayNodes, edges, routes, routingEngine, routingStatus, blockedRoutes: [...routes].filter(([, route]) => route.feasible === false).map(([id]) => id), visibleGuides: clipAlignmentGuides(alignment, guideBlockers), selectedGroup, roots,
    selectionLabel: roots.length > 1 ? `已选 ${roots.length} 项` : roots[0]?.data.title ?? '',
    selectedModes: new Set(selected.map((node) => node.data.layoutMode ?? 'free')), routeStats, labelLayout, labelledRoutes: snapshotLabels,
    frame: { geometryKey, baselineId: baseline.id, viewMode, snapshots },
  };
}
