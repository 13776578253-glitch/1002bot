/** Offline star-group routing: shared ports, four modes and repeatable candidates. */
import type { Projection } from '../../core/projection/index.ts';
import { obstacleFromRect, rectIntersects, routeOrthogonal, simplifyPoints, type Point, type PortSide, type Rect } from '../../core/layout/geometry.ts';
import { labelCandidatesForRoute, type LabelCandidate } from './label-candidates.ts';
import { scoreRoutes } from './route-quality.ts';
import { validateRoute } from '../../core/layout/legality.ts';
import {
  createNodePortAllocator, DEFAULT_SLOT_RULES, type NodePortAllocator, type NodePortGeometry, type PortSlot, type SlotGrant, type SlotRules,
} from '../../core/layout/node-port-allocator.ts';
import { createSolveBudget, DEFAULT_SOLVE_LIMITS, type SolveBudgetLimits } from '../../core/layout/search-limits.ts';
import type { PortPolicy } from '../../core/layout/port-policy.ts';
import { createDiagramGeometry, segmentCrossesRect, type DiagramGeometry, type ReservedRoute } from './routing.ts';
import type { CanvasNode } from './grouping.ts';
import type { CachedRoute } from './route-cache.ts';

export type GroupMode = 'fork' | 'trunk' | 'mixed' | 'lanes';
const MODES: readonly GroupMode[] = ['fork', 'trunk', 'mixed', 'lanes'];
const SIDE_NORMAL: Record<PortSide, Point> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, auto: { x: 1, y: 0 },
};
const SIDE_AXIS: Record<PortSide, 0 | 1> = { top: 1, bottom: 1, left: 0, right: 0, auto: 0 };

export interface GroupEdgeInput {
  id: string;
  source: string;
  target: string;
  text: string;
  fixed?: CachedRoute;
  priority?: 'auto' | 'pinned' | 'locked' | 'frozen';
  labelRequired?: boolean;
}

export interface RouteGroup {
  id: string;
  ownerNodeId: string;
  edges: string[];
  fixed: string[];
}

export interface GroupCandidate {
  edgeId: string;
  points: Point[];
  sourceSlot: PortSlot;
  targetSlot: PortSlot;
  sourceHandle: string;
  targetHandle: string;
  mode: GroupMode;
  score: number;
  trunkId?: string;
  trunkSegment?: { from: Point; to: Point };
  lane?: number;
  labelRequired: boolean;
  labelCandidates: LabelCandidate[];
  label?: LabelCandidate;
  labelState: 'normal' | 'adjusted' | 'space-exhausted';
}

export interface GroupPlan {
  groupId: string;
  ownerNodeId: string;
  mode: GroupMode;
  routes: GroupCandidate[];
  score: number;
}

export interface ModeEvaluationResult {
  mode: GroupMode;
  isComplete: boolean;
  totalEdges: number;
  successCount: number;
  routes: GroupCandidate[];
  failures: GroupFailure[];
  score: number;
  durationMs: number;
}

export interface GroupFailure {
  edgeId: string;
  reason: 'no-candidate' | 'budget' | 'port-capacity' | 'fixed-conflict';
}

export interface GroupSolveInput {
  nodes: readonly CanvasNode[];
  projection: Projection;
  edges: readonly GroupEdgeInput[];
  reserved?: readonly ReservedRoute[];
  rules?: Partial<SlotRules>;
  policy?: PortPolicy;
  budget?: SolveBudgetLimits;
  transactional?: boolean;
  modes?: readonly GroupMode[];
  maxEdgesPerGroup?: number;
  laneStep?: number;
  trunkLength?: number;
}

export interface GroupSolveSuccess {
  ok: true;
  groups: RouteGroup[];
  plans: GroupPlan[];
  routes: Map<string, CachedRoute>;
  fixedPorts: Map<string, SlotGrant[]>;
  failures: GroupFailure[];
  evaluations: ModeEvaluationResult[];
  rounds: number;
  candidates: number;
  elapsedMs: number;
}

export interface GroupSolveFailure {
  ok: false;
  reason: 'NO_COMPLETE_FEASIBLE_MODE';
  groups: RouteGroup[];
  failures: GroupFailure[];
}

export type GroupSolveOutcome = GroupSolveSuccess | GroupSolveFailure;

interface PlannedEdge {
  edge: GroupEdgeInput;
  source: SlotGrant;
  target: SlotGrant;
  lane?: number;
  laneCount?: number;
}

interface ModeAttempt {
  evaluation: ModeEvaluationResult;
}

export const getGlobalPortKey = (nodeId: string, physicalId: string): string => `${nodeId}::${physicalId}`;

const sideOf = (from: Rect, to: Rect): PortSide => {
  const dx = to.x + to.w / 2 - from.x - from.w / 2;
  const dy = to.y + to.h / 2 - from.y - from.h / 2;
  return Math.abs(dx) > Math.abs(dy) * 1.15 ? dx > 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
};
const opposite = (side: PortSide): PortSide => side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left';
const offset = (point: Point, side: PortSide, distance: number): Point => ({ x: point.x + SIDE_NORMAL[side].x * distance, y: point.y + SIDE_NORMAL[side].y * distance });
const pointDistance = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function preferredPair(source: Rect, target: Rect, policy: PortPolicy): { source: PortSide; target: PortSide } {
  if (policy.direction === 'top-down' && target.y >= source.y) return { source: 'bottom', target: 'top' };
  const side = sideOf(source, target);
  return { source: side, target: opposite(side) };
}

function parseSlotHandle(handle: string | undefined): { side: PortSide; role: 'source' | 'target'; index: number } | undefined {
  if (!handle) return undefined;
  const [side, role, index] = handle.split(':');
  if (!['top', 'right', 'bottom', 'left'].includes(side ?? '') || (role !== 'source' && role !== 'target') || !/^\d+$/.test(index ?? '')) return undefined;
  return { side: side as PortSide, role, index: Number(index) };
}

export function allocateEdgePortsAtomic(
  allocator: NodePortAllocator,
  edge: { id: string; source: string; target: string },
  sourcePlan: { side: PortSide; idealFraction?: number; strict?: boolean },
  targetPlan: { side: PortSide; idealFraction?: number; strict?: boolean },
): { success: true; source: SlotGrant; target: SlotGrant } | { success: false; reason: string } {
  const source = allocator.request({
    edgeId: edge.id, nodeId: edge.source, role: 'source', priority: 'auto',
    ...(sourcePlan.strict ? { requiredSide: sourcePlan.side } : { preferredSides: [sourcePlan.side] }),
    ...(sourcePlan.idealFraction === undefined ? {} : { idealFraction: sourcePlan.idealFraction }),
  });
  if (!source) return { success: false, reason: `source_failed: ${allocator.failure(edge.id)?.reason ?? 'unknown'}` };
  const target = allocator.request({
    edgeId: edge.id, nodeId: edge.target, role: 'target', priority: 'auto',
    ...(targetPlan.strict ? { requiredSide: targetPlan.side } : { preferredSides: [targetPlan.side] }),
    ...(targetPlan.idealFraction === undefined ? {} : { idealFraction: targetPlan.idealFraction }),
  });
  if (!target) {
    allocator.release(edge.id);
    return { success: false, reason: `target_failed: ${allocator.failure(edge.id)?.reason ?? 'unknown'}` };
  }
  return { success: true, source, target };
}

export function selectModeResult(evaluations: readonly ModeEvaluationResult[], transactional: boolean): ModeEvaluationResult | undefined {
  const ordered = [...evaluations];
  if (transactional) return ordered.filter((item) => item.isComplete).sort((a, b) => a.score - b.score || MODES.indexOf(a.mode) - MODES.indexOf(b.mode))[0];
  return ordered.sort((a, b) => b.successCount - a.successCount || a.score - b.score || MODES.indexOf(a.mode) - MODES.indexOf(b.mode))[0];
}

export function classifyFailure(input: {
  previous?: CachedRoute;
  previousLegal: boolean;
  endpointsStable: boolean;
  transactional: boolean;
}): 'retain' | 'incomplete' | 'rollback' {
  if (input.previous && input.previousLegal && input.endpointsStable) return 'retain';
  if (input.transactional) return 'rollback';
  return 'incomplete';
}

function buildGroups(edges: readonly GroupEdgeInput[], projection: Projection, maxEdges: number): RouteGroup[] {
  const visible = new Set(projection.nodeById.keys());
  const auto = edges.filter((edge) => !edge.fixed && (edge.priority ?? 'auto') === 'auto' && visible.has(edge.source) && visible.has(edge.target));
  const degree = new Map<string, number>();
  for (const edge of auto) for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const owned = new Map<string, string[]>();
  for (const edge of auto) {
    const a = edge.source, b = edge.target, da = degree.get(a) ?? 0, db = degree.get(b) ?? 0;
    const owner = da > db ? a : db > da ? b : a < b ? a : b;
    owned.set(owner, [...(owned.get(owner) ?? []), edge.id]);
  }
  const fixed = edges.filter((edge) => edge.fixed || (edge.priority ?? 'auto') !== 'auto').map((edge) => edge.id);
  return [...owned]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([owner, ids]) => {
      const sorted = [...ids].sort();
      const groups: RouteGroup[] = [];
      for (let index = 0; index < sorted.length; index += maxEdges) {
        groups.push({ id: `${owner}#${index / maxEdges}`, ownerNodeId: owner, edges: sorted.slice(index, index + maxEdges), fixed: fixed.filter((id) => {
          const edge = edges.find((item) => item.id === id);
          return edge && (edge.source === owner || edge.target === owner);
        }) });
      }
      return groups;
    });
}

function geometryNodes(geometry: DiagramGeometry): NodePortGeometry[] {
  return [...geometry.bounds].map(([id, rect]) => ({ id, x: rect.x, y: rect.y, width: rect.w, height: rect.h }));
}

function routeObstacles(geometry: DiagramGeometry) {
  return [...geometry.obstacles.values()];
}

function planMode(
  mode: GroupMode,
  group: RouteGroup,
  edges: readonly GroupEdgeInput[],
  geometry: DiagramGeometry,
  allocator: NodePortAllocator,
  policy: PortPolicy,
  laneStep: number,
  trunkLength: number,
): { planned: PlannedEdge[]; failures: GroupFailure[] } {
  const failures: GroupFailure[] = [];
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  const preferred = new Map<string, { source: PortSide; target: PortSide }>();
  for (const id of group.edges) {
    const edge = byId.get(id)!;
    preferred.set(id, preferredPair(geometry.bounds.get(edge.source)!, geometry.bounds.get(edge.target)!, policy));
  }
  const bundles = new Map<string, string[]>();
  if (mode === 'trunk' || mode === 'mixed') {
    for (const id of group.edges) {
      const edge = byId.get(id)!, sides = preferred.get(id)!;
      const target = geometry.bounds.get(edge.target)!, source = geometry.bounds.get(edge.source)!;
      const key = `${sides.source}|${sides.target}|${target.x + target.w / 2 > source.x + source.w / 2 ? 'r' : 'l'}`;
      bundles.set(key, [...(bundles.get(key) ?? []), id]);
    }
  }
  const trunkIds = new Set<string>();
  const orderedBundles = [...bundles].sort(([a, av], [b, bv]) => bv.length - av.length || a.localeCompare(b));
  for (const [, ids] of orderedBundles) {
    if (ids.length < 2) continue;
    if (mode === 'mixed' && trunkIds.size) continue;
    ids.forEach((id) => trunkIds.add(id));
  }
  const laneMeta = new Map<string, { index: number; count: number }>();
  if (mode === 'lanes') {
    const bySide = new Map<PortSide, string[]>();
    for (const id of group.edges) {
      const side = preferred.get(id)!.source;
      bySide.set(side, [...(bySide.get(side) ?? []), id]);
    }
    for (const [side, ids] of bySide) {
      const axis = side === 'top' || side === 'bottom' ? 'x' : 'y';
      const sorted = [...ids].sort((a, b) => {
        const ta = geometry.bounds.get(byId.get(a)!.target)!, tb = geometry.bounds.get(byId.get(b)!.target)!;
        const ca = axis === 'x' ? ta.x + ta.w / 2 : ta.y + ta.h / 2;
        const cb = axis === 'x' ? tb.x + tb.w / 2 : tb.y + tb.h / 2;
        return ca - cb || a.localeCompare(b);
      });
      sorted.forEach((id, index) => laneMeta.set(id, { index, count: sorted.length }));
    }
  }
  const planned: PlannedEdge[] = [];
  for (const id of group.edges) {
    const edge = byId.get(id)!, sides = preferred.get(id)!;
    const meta = laneMeta.get(id);
    const laneFraction = meta && meta.count > 1 ? 0.2 + 0.6 * (meta.index / (meta.count - 1)) : 0.5;
    const trunk = trunkIds.has(id) ? { id: `${group.id}:trunk:${sides.source}:${sides.target}` } : undefined;
    if (trunk) {
      const source = allocator.request({ edgeId: id, nodeId: edge.source, role: 'source', priority: 'auto', preferredSides: [sides.source], idealFraction: laneFraction, trunk });
      if (!source) {
        failures.push({ edgeId: id, reason: 'port-capacity' });
        continue;
      }
      const target = allocator.request({ edgeId: id, nodeId: edge.target, role: 'target', priority: 'auto', preferredSides: [sides.target], idealFraction: 0.5 });
      if (!target) {
        allocator.release(id);
        failures.push({ edgeId: id, reason: 'port-capacity' });
        continue;
      }
      planned.push({ edge, source, target, ...(meta ? { lane: meta.index, laneCount: meta.count } : {}) });
      continue;
    }
    const grants = allocateEdgePortsAtomic(allocator, edge, { side: sides.source, idealFraction: laneFraction }, { side: sides.target, idealFraction: 0.5 });
    if (!grants.success) {
      failures.push({ edgeId: id, reason: 'port-capacity' });
      continue;
    }
    planned.push({ edge, source: grants.source, target: grants.target, ...(meta ? { lane: meta.index, laneCount: meta.count } : {}) });
  }
  return { planned, failures };
}

function selectLabels(routes: GroupCandidate[], edges: Map<string, GroupEdgeInput>, geometry: DiagramGeometry, occupied: Rect[]): void {
  const candidates = new Map<string, LabelCandidate[]>();
  for (const route of routes) {
    const edge = edges.get(route.edgeId);
    const required = edge?.labelRequired ?? Boolean(edge?.text.trim());
    route.labelRequired = required;
    const text = edge?.text ?? '';
    candidates.set(route.edgeId, required ? labelCandidatesForRoute(route.points, text, geometry, route.trunkId ? 1 : 0) : []);
  }
  interface State { placements: Map<string, LabelCandidate>; hidden: number; score: number }
  let beam: State[] = [{ placements: new Map(), hidden: 0, score: 0 }];
  const order = [...routes].sort((a, b) => (candidates.get(a.edgeId)?.length ?? 0) - (candidates.get(b.edgeId)?.length ?? 0) || a.edgeId.localeCompare(b.edgeId));
  for (const route of order) {
    const list = candidates.get(route.edgeId) ?? [];
    route.labelCandidates = list;
    const next: State[] = [];
    for (const state of beam) {
      for (const candidate of list) {
        const blocked = [...state.placements.values(), ...occupied.map((rect) => ({ rect }))].some((item) => rectIntersects(item.rect, candidate.rect));
        if (blocked) continue;
        const placements = new Map(state.placements);
        placements.set(route.edgeId, candidate);
        next.push({ placements, hidden: state.hidden, score: state.score + candidate.score });
      }
      next.push({ placements: state.placements, hidden: state.hidden + (route.labelRequired ? 1 : 0), score: state.score + (route.labelRequired ? 40 : 0) });
    }
    next.sort((a, b) => a.hidden - b.hidden || a.score - b.score);
    beam = next.slice(0, 4);
  }
  const best = beam[0]!;
  for (const route of routes) {
    const candidate = best.placements.get(route.edgeId);
    if (candidate) {
      route.label = candidate;
      route.labelState = candidate.state;
    } else {
      delete route.label;
      route.labelState = 'space-exhausted';
    }
  }
}

export function solveRouteGroups(input: GroupSolveInput): GroupSolveOutcome {
  const started = performance.now();
  const rules: SlotRules = { ...DEFAULT_SLOT_RULES, ...input.rules };
  const policy = input.policy ?? {};
  const laneStep = input.laneStep ?? 8;
  const trunkLength = input.trunkLength ?? 32;
  const fixedReserved: ReservedRoute[] = [];
  for (const edge of input.edges) {
    if (!edge.fixed) continue;
    const hard = (edge.priority ?? 'pinned') === 'locked' || (edge.priority ?? 'pinned') === 'frozen';
    if (hard) fixedReserved.push({ edgeId: edge.id, points: edge.fixed.points });
  }
  const geometry = createDiagramGeometry(input.nodes, input.projection, [...(input.reserved ?? []), ...fixedReserved]);
  const allocator = createNodePortAllocator({ nodes: geometryNodes(geometry), rules });
  const groups = buildGroups(input.edges, input.projection, Math.max(1, input.maxEdgesPerGroup ?? 12));
  const byId = new Map(input.edges.map((edge) => [edge.id, edge]));
  const routes = new Map<string, CachedRoute>();
  const fixedPorts = new Map<string, SlotGrant[]>();
  for (const edge of input.edges) if (edge.fixed) routes.set(edge.id, edge.fixed);
  const failures: GroupFailure[] = [];
  let candidates = 0;

  allocator.begin();
  try {
    for (const edge of input.edges) {
      if (!edge.fixed) continue;
      const priority = edge.priority ?? 'pinned';
      const sourceHandle = edge.fixed.sourceHandle;
      const targetHandle = edge.fixed.targetHandle;
      const source = parseSlotHandle(sourceHandle);
      const target = parseSlotHandle(targetHandle);
      if (!source || !target || source.role !== 'source' || target.role !== 'target') throw new Error(`fixed route ${edge.id} requires logical slot handles`);
      const sourceGrant = allocator.request({ edgeId: edge.id, nodeId: edge.source, role: 'source', priority, storedHandle: sourceHandle });
      if (!sourceGrant || sourceGrant.slot.handleId !== sourceHandle) throw new Error(`fixed route ${edge.id} cannot reserve ${sourceHandle}`);
      const targetGrant = allocator.request({ edgeId: edge.id, nodeId: edge.target, role: 'target', priority, storedHandle: targetHandle });
      if (!targetGrant || targetGrant.slot.handleId !== targetHandle) {
        allocator.release(edge.id);
        throw new Error(`fixed route ${edge.id} cannot reserve ${targetHandle}`);
      }
      fixedPorts.set(edge.id, [sourceGrant, targetGrant]);
    }
    allocator.commit();
  } catch (error) {
    allocator.rollback();
    throw error;
  }

  const modes = input.modes ?? MODES;
  const plannerGroupMs = Math.min((input.budget?.groupMs ?? DEFAULT_SOLVE_LIMITS.groupMs) / Math.max(1, modes.length), 20);
  const plans: GroupPlan[] = [];
  const evaluations: ModeEvaluationResult[] = [];
  const rounds = groups.length ? 1 : 0;

  for (const group of groups) {
    const attempts: ModeAttempt[] = [];
    const preferred = new Map<string, { source: PortSide; target: PortSide }>();
    for (const id of group.edges) {
      const edge = byId.get(id)!;
      preferred.set(id, preferredPair(geometry.bounds.get(edge.source)!, geometry.bounds.get(edge.target)!, policy));
    }
    for (const mode of modes) {
      const modeStarted = performance.now();
      const budget = createSolveBudget({ ...input.budget, groupMs: plannerGroupMs });
      allocator.begin();
      const planned = planMode(mode, group, input.edges, geometry, allocator, policy, laneStep, trunkLength);
      const groupRoutes: GroupCandidate[] = [];
      const modeFailures: GroupFailure[] = [...planned.failures];
      for (const item of planned.planned) {
        const budgetEdge = budget.forEdge();
        if (budgetEdge.expired) {
          allocator.release(item.edge.id);
          modeFailures.push({ edgeId: item.edge.id, reason: 'budget' });
          continue;
        }
        const sourceAnchor = item.source.anchor, targetAnchor = item.target.anchor;
        const sourceSide = item.source.slot.side, targetSide = item.target.slot.side;
        const trunk = item.source.trunkId;
        let prefix: Point[] = [sourceAnchor];
        let start = offset(sourceAnchor, sourceSide, trunk ? trunkLength : 24);
        let startAxis: 0 | 1 = SIDE_AXIS[sourceSide];
        if (item.lane !== undefined && item.laneCount !== undefined) {
          const normal = offset(sourceAnchor, sourceSide, 24);
          const tangent = sourceSide === 'top' || sourceSide === 'bottom' ? { x: 1, y: 0 } : { x: 0, y: 1 };
          const shift = (item.lane - (item.laneCount - 1) / 2) * laneStep;
          const lanePoint = { x: normal.x + tangent.x * shift, y: normal.y + tangent.y * shift };
          prefix = [sourceAnchor, normal, lanePoint];
          start = lanePoint;
          startAxis = sourceSide === 'top' || sourceSide === 'bottom' ? 0 : 1;
        } else if (trunk) {
          prefix = [sourceAnchor, start];
        }
        const endStub = offset(targetAnchor, targetSide, 24);
        const obstacles = [
          ...routeObstacles(geometry).map((entry) => obstacleFromRect(entry.id === item.edge.source || entry.id === item.edge.target ? entry.endpointBounds ?? entry.bounds : entry.padded)),
          ...geometry.reserved.map((entry) => obstacleFromRect(entry.rect, 2)),
        ];
        const middle = routeOrthogonal({ ...start, w: 0, h: 0 }, { ...endStub, w: 0, h: 0 }, obstacles, { offset: 0, padding: 10, startAxis, endAxis: SIDE_AXIS[targetSide], limits: budgetEdge.astarLimits() });
        const points = simplifyPoints([...prefix, ...middle, targetAnchor]);
        const issues = validateRoute({
          points, sourceId: item.edge.source, targetId: item.edge.target,
          obstacles: routeObstacles(geometry), reserved: geometry.reserved,
          sourceAnchor, targetAnchor, sourceSide, targetSide, requireAttachment: true, requireOrthogonal: true,
        });
        candidates += 1;
        if (issues.length) {
          allocator.release(item.edge.id);
          modeFailures.push({ edgeId: item.edge.id, reason: budgetEdge.expired ? 'budget' : 'no-candidate' });
          continue;
        }
        const edgeInput = byId.get(item.edge.id);
        groupRoutes.push({
          edgeId: item.edge.id, points, sourceSlot: item.source.slot, targetSlot: item.target.slot,
          sourceHandle: item.source.slot.handleId, targetHandle: item.target.slot.handleId,
          mode, score: 0, ...(trunk ? { trunkId: trunk, trunkSegment: { from: sourceAnchor, to: start } } : {}),
          ...(item.lane === undefined ? {} : { lane: item.lane }),
          labelRequired: edgeInput?.labelRequired ?? Boolean(edgeInput?.text.trim()),
          labelCandidates: [], labelState: 'space-exhausted',
        });
      }
      const fixedLabels: Rect[] = input.edges.flatMap((edge) => edge.fixed ? [{ x: edge.fixed.label.x - edge.fixed.label.width / 2, y: edge.fixed.label.y - edge.fixed.label.height / 2, w: edge.fixed.label.width, h: edge.fixed.label.height }] : []);
      selectLabels(groupRoutes, byId, geometry, fixedLabels);
      const quality = scoreRoutes(groupRoutes.map((route) => ({
        edgeId: route.edgeId, points: route.points, sourceSlot: route.sourceSlot, targetSlot: route.targetSlot,
        ...(route.trunkId ? { trunkId: route.trunkId } : {}),
        ...(route.trunkSegment ? { trunkSegment: route.trunkSegment } : {}),
        ...(route.label ? { label: { x: route.label.anchor.x, y: route.label.anchor.y, width: route.label.rect.w, height: route.label.rect.h, score: route.label.score, segmentKind: route.label.segmentKind, distanceToTarget: route.label.distanceToTarget } } : {}),
        labelRequired: route.labelRequired,
        labelState: route.labelState,
      })), { preferred });
      const isComplete = groupRoutes.length === group.edges.length;
      const score = isComplete ? quality.score : Infinity;
      attempts.push({
        evaluation: {
          mode, isComplete, totalEdges: group.edges.length, successCount: groupRoutes.length,
          routes: groupRoutes, failures: modeFailures, score, durationMs: performance.now() - modeStarted,
        },
      });
      allocator.rollback();
    }
    evaluations.push(...attempts.map((item) => item.evaluation));
    const winner = selectModeResult(attempts.map((item) => item.evaluation), input.transactional ?? false);
    if (!winner) {
      const reasonFailures = attempts.flatMap((item) => item.evaluation.failures);
      if (input.transactional) return { ok: false, reason: 'NO_COMPLETE_FEASIBLE_MODE', groups, failures: reasonFailures };
      failures.push({ edgeId: group.id, reason: 'no-candidate' });
      continue;
    }
    allocator.begin();
    planMode(winner.mode, group, input.edges, geometry, allocator, policy, laneStep, trunkLength);
    allocator.commit();
    plans.push({ groupId: group.id, ownerNodeId: group.ownerNodeId, mode: winner.mode, routes: winner.routes, score: winner.score });
    failures.push(...winner.failures);
    for (const route of winner.routes) {
      const midpoint = route.points[Math.floor(route.points.length / 2)]!;
      routes.set(route.edgeId, {
        sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
        points: route.points,
        label: route.label
          ? { x: route.label.anchor.x, y: route.label.anchor.y, width: route.label.rect.w, height: route.label.rect.h }
          : { x: midpoint.x, y: midpoint.y, width: 0, height: 0 },
        labelState: route.labelState,
        text: byId.get(route.edgeId)?.text ?? '',
      });
    }
  }
  return { ok: true, groups, plans, routes, fixedPorts, failures, evaluations, rounds, candidates, elapsedMs: performance.now() - started };
}
