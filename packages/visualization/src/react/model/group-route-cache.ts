/** Group-level incremental cache: reuse unchanged star groups and reserve their paths. */
import { rectIntersects, type Rect } from '../../core/layout/geometry.ts';
import type { PortPolicy } from '../../core/layout/port-policy.ts';
import type { SlotRules } from '../../core/layout/node-port-allocator.ts';
import type { Projection } from '../../core/projection/index.ts';
import type { CanvasNode } from './grouping.ts';
import { worldPosition } from './grouping.ts';
import {
  buildRouteGroups, solveRouteGroups, type GroupEdgeInput, type GroupMode, type GroupPlan,
  type GroupSolveInput, type GroupSolveOutcome, type GroupSolveSuccess, type RouteGroup,
} from './route-groups.ts';
import type { CachedRoute } from './route-cache.ts';
import { coordinateLabels } from './label-coordinator.ts';
import { fallbackLabel } from './labels.ts';
import { createDiagramGeometry, pathIsClear, type DiagramGeometry, type ReservedRoute } from './routing.ts';

export interface GroupRouteCacheInput {
  nodes: readonly CanvasNode[];
  projection: Projection;
  edges: readonly GroupEdgeInput[];
  policy?: PortPolicy;
  rules?: Partial<SlotRules>;
  modes?: readonly GroupMode[];
  maxEdgesPerGroup?: number;
  laneStep?: number;
  trunkLength?: number;
  revision?: number;
}

export type GroupCacheMode = 'hit' | 'incremental' | 'full' | 'failed';
export type GroupFullReason = 'cold' | 'revision' | 'node-set';

export interface GroupRouteCacheStats {
  mode: GroupCacheMode;
  groups: number;
  reusedGroups: number;
  solvedGroups: number;
  durationMs: number;
  fullReason?: GroupFullReason;
  modeReuse?: number;
  reusedRoutes?: number;
  budgetFailures?: number;
  labelReselected?: number;
  labelHidden?: number;
}

export interface GroupRouteCacheUpdate {
  outcome?: GroupSolveOutcome;
  stats: GroupRouteCacheStats;
  error?: string;
}

interface GroupRecord {
  group: RouteGroup;
  signature: string;
  bounds: Rect;
  routes: Map<string, CachedRoute>;
  plan?: GroupPlan;
}

function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

function sameRect(a: Rect | undefined, b: Rect): boolean {
  return Boolean(a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
}

function nodeRect(node: CanvasNode, nodes: readonly CanvasNode[]): Rect {
  const point = worldPosition(node, nodes);
  return { x: point.x, y: point.y, w: node.width ?? 0, h: node.height ?? 0 };
}

function routeBounds(routes: Iterable<CachedRoute>): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const route of routes) {
    for (const point of route.points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    if (route.label.width > 0 && route.label.height > 0) {
      minX = Math.min(minX, route.label.x - route.label.width / 2); minY = Math.min(minY, route.label.y - route.label.height / 2);
      maxX = Math.max(maxX, route.label.x + route.label.width / 2); maxY = Math.max(maxY, route.label.y + route.label.height / 2);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
}

function groupNodes(group: RouteGroup, edges: Map<string, GroupEdgeInput>): Set<string> {
  const nodes = new Set<string>([group.ownerNodeId]);
  for (const id of group.edges) {
    const edge = edges.get(id);
    if (edge) { nodes.add(edge.source); nodes.add(edge.target); }
  }
  return nodes;
}

function groupSignature(group: RouteGroup, input: GroupRouteCacheInput, edges: Map<string, GroupEdgeInput>, nodes: Map<string, CanvasNode>, rects: Map<string, Rect>): string {
  const members = new Set<string>();
  for (const id of group.edges) {
    const edge = edges.get(id);
    if (edge) { members.add(edge.source); members.add(edge.target); }
  }
  const nodeParts = [...members].sort().map((id) => {
    const node = nodes.get(id), rect = rects.get(id);
    return [id, node?.type ?? '', node?.parentId ?? null, rect?.x ?? 0, rect?.y ?? 0, rect?.w ?? 0, rect?.h ?? 0, node?.data.expanded ?? false];
  });
  const edgeParts = group.edges.map((id) => {
    const edge = edges.get(id);
    return edge ? [edge.id, edge.source, edge.target, edge.text, edge.labelRequired ?? Boolean(edge.text.trim()), edge.priority ?? 'auto'] : [id];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({
    group: [group.id, group.ownerNodeId, group.edges],
    edges: edgeParts,
    nodes: nodeParts,
    policy: input.policy ?? {},
    rules: input.rules ?? {},
    modes: input.modes ?? null,
    max: input.maxEdgesPerGroup ?? 12,
    lane: input.laneStep ?? 8,
    trunk: input.trunkLength ?? 32,
  });
}

export type GroupSolver = (input: GroupSolveInput) => GroupSolveOutcome;

export class GroupRouteCache {
  private readonly solve: GroupSolver;
  constructor(solve: GroupSolver = solveRouteGroups) { this.solve = solve; }
  private outcome: GroupSolveSuccess | undefined;
  private records = new Map<string, GroupRecord>();
  private nodeRects = new Map<string, Rect>();
  private nodeIds: string | undefined;
  private lastRevision: number | undefined;

  update(input: GroupRouteCacheInput): GroupRouteCacheUpdate {
    const started = performance.now();
    const maxEdges = Math.max(1, input.maxEdgesPerGroup ?? 12);
    const groups = buildRouteGroups(input.edges, input.projection, maxEdges);
    const edgeById = new Map(input.edges.map((edge) => [edge.id, edge]));
    const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
    const rects = new Map(input.nodes.map((node) => [node.id, nodeRect(node, input.nodes)]));
    const nodeIds = [...rects.keys()].sort().join('|');
    const nodeSetChanged = this.nodeIds !== undefined && this.nodeIds !== nodeIds;
    const revisionChanged = this.lastRevision !== undefined && this.lastRevision !== input.revision;
    if (!this.outcome || this.nodeIds === undefined || nodeSetChanged || revisionChanged) {
      const fullReason: GroupFullReason = !this.outcome || this.nodeIds === undefined ? 'cold' : nodeSetChanged ? 'node-set' : 'revision';
      return this.full(input, groups, rects, nodeIds, started, fullReason);
    }

    const currentIds = new Set(groups.map((group) => group.id));
    for (const id of this.records.keys()) if (!currentIds.has(id)) this.records.delete(id);

    const dirty = new Set<string>();
    for (const group of groups) {
      const record = this.records.get(group.id);
      if (!record || record.group.edges.join('|') !== group.edges.join('|')
        || record.signature !== groupSignature(group, input, edgeById, nodesById, rects)) {
        dirty.add(group.id);
        continue;
      }
      const bounds = inflate(record.bounds, 32);
      for (const [id, rect] of rects) {
        if (sameRect(this.nodeRects.get(id), rect)) continue;
        if (rectIntersects(rect, bounds)) { dirty.add(group.id); break; }
      }
    }

    if (!dirty.size) {
      return { outcome: this.outcome, stats: { mode: 'hit', groups: groups.length, reusedGroups: groups.length, solvedGroups: 0, durationMs: performance.now() - started } };
    }

    const dirtyIds = new Set([...dirty]);
    const dirtyGroups = groups.filter((group) => dirtyIds.has(group.id));
    let geometry: DiagramGeometry | undefined;
    const reusable = new Set<string>();
    for (const group of dirtyGroups) {
      const record = this.records.get(group.id);
      if (!record) continue;
      geometry ??= createDiagramGeometry(input.nodes, input.projection);
      for (const [edgeId, route] of record.routes) {
        const edge = edgeById.get(edgeId);
        if (!edge) continue;
        const oldSource = this.nodeRects.get(edge.source), oldTarget = this.nodeRects.get(edge.target);
        const source = rects.get(edge.source), target = rects.get(edge.target);
        if (!oldSource || !oldTarget || !source || !target) continue;
        if (!sameRect(oldSource, source) || !sameRect(oldTarget, target)) continue;
        if (pathIsClear(route.points, geometry, edge.source, edge.target, edge.id)) reusable.add(edgeId);
      }
    }
    const edgeGroup = new Map<string, RouteGroup>();
    for (const group of groups) for (const id of group.edges) edgeGroup.set(id, group);
    const solverEdges: GroupEdgeInput[] = input.edges.map((edge) => {
      const group = edgeGroup.get(edge.id);
      const cached = group && !dirtyIds.has(group.id)
        ? this.outcome!.routes.get(edge.id)
        : reusable.has(edge.id) ? this.records.get(edgeGroup.get(edge.id)!.id)?.routes.get(edge.id) : undefined;
      return cached ? { ...edge, fixed: cached, priority: 'pinned' as const, softPorts: true } : edge;
    });
    const reserved: ReservedRoute[] = [];
    const modeHints: Record<string, GroupMode> = {};
    const portHints: Record<string, { sourceHandle: string; targetHandle: string }> = {};
    for (const group of dirtyGroups) {
      const record = this.records.get(group.id);
      if (!record?.plan) continue;
      modeHints[group.id] = record.plan.mode;
      for (const [edgeId, route] of record.routes) portHints[edgeId] = { sourceHandle: route.sourceHandle, targetHandle: route.targetHandle };
    }

    let incremental: GroupSolveOutcome;
    try {
      incremental = this.solve({
        ...this.base(input),
        edges: solverEdges,
        groups: dirtyGroups,
        reserved,
        modeHints,
        portHints,
        transactional: true,
      });
    } catch (error) {
      return {
        stats: { mode: 'failed', groups: groups.length, reusedGroups: groups.length - dirtyGroups.length, solvedGroups: dirtyGroups.length, durationMs: performance.now() - started },
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!incremental.ok) {
      return {
        outcome: incremental,
        stats: { mode: 'failed', groups: groups.length, reusedGroups: groups.length - dirtyGroups.length, solvedGroups: dirtyGroups.length, durationMs: performance.now() - started },
      };
    }

    const plans = groups.flatMap((group) => {
      if (dirtyIds.has(group.id)) return incremental.plans.filter((plan) => plan.groupId === group.id);
      const record = this.records.get(group.id);
      return record?.plan ? [record.plan] : [];
    });
    const merged: GroupSolveSuccess = { ...incremental, groups, plans, elapsedMs: performance.now() - started };
    const changedEdges = new Set(dirtyGroups.flatMap((group) => group.edges));
    const labelChange = this.coordinateOutcomeLabels(merged, input, 8, changedEdges);
    this.outcome = merged;
    this.records.clear();
    for (const group of groups) {
      const routes = new Map<string, CachedRoute>();
      for (const id of group.edges) {
        const route = merged.routes.get(id);
        if (route) routes.set(id, route);
      }
      if (routes.size !== group.edges.length) continue;
      const plan = plans.find((item) => item.groupId === group.id);
      this.records.set(group.id, {
        group,
        signature: groupSignature(group, input, edgeById, nodesById, rects),
        bounds: routeBounds(routes.values()),
        routes,
        ...(plan ? { plan } : {}),
      });
    }
    this.nodeRects = rects;
    this.nodeIds = nodeIds;
    this.lastRevision = input.revision;
    const modeReuse = dirtyGroups.filter((group) => {
      const hint = modeHints[group.id];
      return hint && merged.plans.some((plan) => plan.groupId === group.id && plan.mode === hint);
    }).length;
    return {
      outcome: merged,
      stats: {
        mode: 'incremental', groups: groups.length, reusedGroups: groups.length - dirtyGroups.length, solvedGroups: dirtyGroups.length,
        durationMs: performance.now() - started, ...(modeReuse ? { modeReuse } : {}), ...(reusable.size ? { reusedRoutes: reusable.size } : {}),
        ...(labelChange.reselected ? { labelReselected: labelChange.reselected } : {}), ...(labelChange.hidden ? { labelHidden: labelChange.hidden } : {}),
        ...(merged.failures.some((failure) => failure.reason === 'budget') ? { budgetFailures: merged.failures.filter((failure) => failure.reason === 'budget').length } : {}),
      },
    };
  }

  private hasLabelConflict(labels: readonly Rect[], fixed: readonly Rect[]): boolean {
    const all = [...fixed, ...labels];
    for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) {
      if (rectIntersects(all[i]!, all[j]!)) return true;
    }
    return false;
  }

  private coordinateOutcomeLabels(outcome: GroupSolveSuccess, input: GroupRouteCacheInput, beamWidth: number, changed?: ReadonlySet<string>): { reselected: number; hidden: number } {
    const protectedLabels: Rect[] = input.edges.flatMap((edge) => edge.fixed ? [{
      x: edge.fixed.label.x - edge.fixed.label.width / 2, y: edge.fixed.label.y - edge.fixed.label.height / 2,
      w: edge.fixed.label.width, h: edge.fixed.label.height,
    }] : []);
    const allRoutes = outcome.plans.flatMap((plan) => plan.routes);
    const targetRoutes = changed ? allRoutes.filter((route) => changed.has(route.edgeId)) : allRoutes;
    const fixed = changed
      ? [...protectedLabels, ...allRoutes.filter((route) => !changed.has(route.edgeId) && route.label).map((route) => route.label!.rect)]
      : protectedLabels;
    const visible = allRoutes.flatMap((route) => route.label ? [route.label.rect] : []);
    if (!this.hasLabelConflict(visible, protectedLabels)) return { reselected: 0, hidden: 0 };
    const placements = coordinateLabels(targetRoutes.map((route) => ({
      edgeId: route.edgeId, candidates: route.labelCandidates, required: route.labelRequired,
    })), fixed, beamWidth);
    let reselected = 0, hidden = 0;
    for (const plan of outcome.plans) for (const route of plan.routes) {
      if (changed && !changed.has(route.edgeId)) continue;
      const candidate = placements.get(route.edgeId);
      const previous = route.label;
      const hide = (cached: CachedRoute): CachedRoute => {
        const midpoint = route.points[Math.floor(route.points.length / 2)] ?? { x: 0, y: 0 };
        return {
          ...cached, label: { x: midpoint.x, y: midpoint.y, width: 0, height: 0 }, labelState: 'space-exhausted',
          ...(cached.text.trim() ? { labelFallback: fallbackLabel(cached.text, midpoint) } : {}),
        };
      };
      if (candidate) {
        route.label = candidate;
        route.labelState = candidate.state;
        if (!previous || previous.anchor.x !== candidate.anchor.x || previous.anchor.y !== candidate.anchor.y
          || previous.rect.w !== candidate.rect.w || previous.rect.h !== candidate.rect.h) reselected += 1;
      } else {
        delete route.label;
        route.labelState = 'space-exhausted';
        hidden += route.labelRequired ? 1 : 0;
      }
      const cached = outcome.routes.get(route.edgeId);
      if (!cached) continue;
      if (candidate) {
        const label = { x: candidate.anchor.x, y: candidate.anchor.y, width: candidate.rect.w, height: candidate.rect.h };
        if (cached.label.x !== label.x || cached.label.y !== label.y || cached.label.width !== label.width || cached.label.height !== label.height || cached.labelState !== candidate.state) {
          outcome.routes.set(route.edgeId, { ...cached, label, labelState: candidate.state, labelFallback: undefined });
        }
      } else if (cached.labelState !== 'space-exhausted' || cached.label.width !== 0 || cached.label.height !== 0) {
        outcome.routes.set(route.edgeId, hide(cached));
      }
    }

    // Safety gate over the complete route map, including routes outside plans
    // (for example a reused route inside a dirty group). This guarantees the
    // renderer never receives two overlapping visible labels.
    const occupied = [...fixed];
    for (const [edgeId, route] of [...outcome.routes].sort(([a], [b]) => a.localeCompare(b))) {
      if (route.label.width <= 0 || route.label.height <= 0) continue;
      const rect = { x: route.label.x - route.label.width / 2, y: route.label.y - route.label.height / 2, w: route.label.width, h: route.label.height };
      if (occupied.some((other) => rectIntersects(rect, other))) {
        const midpoint = route.points[Math.floor(route.points.length / 2)] ?? { x: 0, y: 0 };
        outcome.routes.set(edgeId, {
          ...route, label: { x: midpoint.x, y: midpoint.y, width: 0, height: 0 }, labelState: 'space-exhausted',
          ...(route.text.trim() ? { labelFallback: fallbackLabel(route.text, midpoint) } : {}),
        });
        hidden += 1;
      } else occupied.push(rect);
    }
    return { reselected, hidden };
  }

  private base(input: GroupRouteCacheInput) {
    return {
      nodes: input.nodes,
      projection: input.projection,
      ...(input.policy ? { policy: input.policy } : {}),
      ...(input.rules ? { rules: input.rules } : {}),
      ...(input.modes ? { modes: input.modes } : {}),
      ...(input.maxEdgesPerGroup ? { maxEdgesPerGroup: input.maxEdgesPerGroup } : {}),
      ...(input.laneStep ? { laneStep: input.laneStep } : {}),
      ...(input.trunkLength ? { trunkLength: input.trunkLength } : {}),
    };
  }

  private full(input: GroupRouteCacheInput, groups: readonly RouteGroup[], rects: Map<string, Rect>, nodeIds: string, started: number, fullReason: GroupFullReason): GroupRouteCacheUpdate {
    const edgeById = new Map(input.edges.map((edge) => [edge.id, edge]));
    const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
    let outcome: GroupSolveOutcome;
    try {
      outcome = this.solve({ ...this.base(input), edges: input.edges });
    } catch (error) {
      this.outcome = undefined;
      this.records.clear();
      return {
        stats: { mode: 'failed', groups: groups.length, reusedGroups: 0, solvedGroups: 0, durationMs: performance.now() - started, fullReason },
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!outcome.ok) {
      this.outcome = undefined;
      this.records.clear();
      return { outcome, stats: { mode: 'full', groups: groups.length, reusedGroups: 0, solvedGroups: 0, durationMs: performance.now() - started, fullReason } };
    }
    this.outcome = outcome;
    this.coordinateOutcomeLabels(outcome, input, 24);
    this.records.clear();
    for (const group of outcome.groups) {
      const routes = new Map<string, CachedRoute>();
      for (const id of group.edges) {
        const route = outcome.routes.get(id);
        if (route) routes.set(id, route);
      }
      if (routes.size !== group.edges.length) continue;
      const plan = outcome.plans.find((item) => item.groupId === group.id);
      this.records.set(group.id, {
        group,
        signature: groupSignature(group, input, edgeById, nodesById, rects),
        bounds: routeBounds(routes.values()),
        routes,
        ...(plan ? { plan } : {}),
      });
    }
    this.nodeRects = rects;
    this.nodeIds = nodeIds;
    this.lastRevision = input.revision;
    return {
      outcome,
      stats: { mode: 'full', groups: outcome.groups.length, reusedGroups: 0, solvedGroups: this.records.size, durationMs: performance.now() - started, fullReason },
    };
  }
}

