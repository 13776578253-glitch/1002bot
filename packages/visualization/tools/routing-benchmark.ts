/** Deterministic P5 routing benchmark: cold and local-update samples by edge count. */
import { projectGraph } from '../src/core/projection/index.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import type { CanvasNode } from '../src/react/model/layout/node.ts';
import type { GroupEdgeInput, GroupSolveInput } from '../src/react/model/routing/route-groups.ts';
import { solveRouteGroups } from '../src/react/model/routing/route-groups.ts';
import { GroupRouteCache } from '../src/react/model/routing/group-route-cache.ts';
import { DiagramRouteCache, type CachedRoute } from '../src/react/model/routing/route-cache.ts';
import { LabelLayoutCache } from '../src/react/model/labels/label-layout.ts';
import { measureRoutes, type QualityRoute } from '../src/react/model/routing/route-quality.ts';
import { crossGroupCrossingHotspots } from '../src/react/model/routing/cross-group-quality.ts';

const HUBS = 5;
const HUB_GAP = 2600;
const LEAF_COLS = 6;
const LEAF_STEP_X = 220;
const LEAF_STEP_Y = 120;

interface ScaleFixture {
  edges: number;
  nodes: CanvasNode[];
  edgesInput: GroupEdgeInput[];
  projection: ReturnType<typeof projectGraph>;
}

function buildScale(edgeCount: number, crossed: boolean): ScaleFixture {
  const leavesPerHub = Math.ceil(edgeCount / HUBS);
  const nodes: CanvasNode[] = [];
  const edgesInput: GroupEdgeInput[] = [];
  const graphNodes: StageSnapshot['graph']['nodes'] = [{ id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] }];
  const graphEdges: StageSnapshot['graph']['edges'] = [];
  let order = 0;
  for (let hub = 0; hub < HUBS; hub += 1) {
    const hubId = `hub-${hub}`;
    nodes.push({ id: hubId, type: 'card', position: { x: hub * HUB_GAP, y: 0 }, width: 220, height: 80, data: { title: `Hub ${hub}` } });
    graphNodes.push({ id: hubId, parentId: 'root', kind: 'group', label: `Hub ${hub}`, order: order++, ports: [] });
  }
  for (let hub = 0; hub < HUBS; hub += 1) for (let leaf = 0; leaf < leavesPerHub; leaf += 1) {
    const id = `leaf-${hub}-${leaf}`;
    nodes.push({
      id, type: 'card',
      position: { x: hub * HUB_GAP + (leaf % LEAF_COLS) * LEAF_STEP_X, y: 220 + Math.floor(leaf / LEAF_COLS) * LEAF_STEP_Y },
      width: 180, height: 64, data: { title: `Leaf ${hub}.${leaf}` },
    });
    graphNodes.push({ id, parentId: 'root', kind: 'component', label: `Leaf ${hub}.${leaf}`, order: order++, ports: [] });
    edgesInput.push({ id: `hub-${hub}-leaf-${leaf}`, source: `hub-${hub}`, target: id, text: `密集关系 数据流 组件-${hub}-${leaf}` });
  }
  const all = [...edgesInput];
  if (crossed) for (let hub = 0; hub < HUBS - 1; hub += 1) {
    const target = `leaf-${hub + 1}-0`;
    all.push({ id: `cross-${hub}`, source: `hub-${hub}`, target, text: `跨星关系 依赖 组件-${hub}-${hub + 1}` });
  }
  const selected = crossed
    ? [...all.slice(0, edgeCount - (HUBS - 1)), ...all.slice(-(HUBS - 1))]
    : all.slice(0, edgeCount);
  for (const edge of selected) {
    graphEdges.push({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, label: edge.text, relation: 'call', direction: 'directed', order: graphEdges.length });
  }
  const stage: StageSnapshot = {
    id: `scale-${edgeCount}`, label: `scale-${edgeCount}`, title: `Scale ${edgeCount}`, track: 'main', order: 0,
    graph: { rootId: 'root', nodes: graphNodes, edges: graphEdges, revision: `scale-${edgeCount}` },
    presentation: {
      portPolicy: { direction: 'top-down' },
      relations: Object.fromEntries(graphEdges.map((edge) => [edge.id, { expanded: [], collapsed: [], sourceRelationIds: [] }])),
    },
  };
  return { edges: edgeCount, nodes, edgesInput: selected, projection: projectGraph(stage, new Set()) };
}

function samples<T>(count: number, run: () => T, warmup = 3): { value: T; ms: number[] } {
  const ms: number[] = [];
  let value: T | undefined;
  for (let index = 0; index < warmup; index += 1) value = run();
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    value = run();
    ms.push(performance.now() - started);
  }
  return { value: value!, ms };
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

function qualityRows(routes: Map<string, CachedRoute>): QualityRoute[] {
  return [...routes].map(([edgeId, route]) => ({
    edgeId, points: route.points,
  }));
}

function quality(routes: Map<string, CachedRoute>): ReturnType<typeof measureRoutes> {
  return measureRoutes(qualityRows(routes));
}

function runScale(edgeCount: number, crossed: boolean): Record<string, unknown> {
  const fixture = buildScale(edgeCount, crossed);
  const input: GroupSolveInput = {
    nodes: fixture.nodes, projection: fixture.projection, edges: fixture.edgesInput,
    policy: { direction: 'top-down' }, maxEdgesPerGroup: 12,
  };
  const legacyInputs = fixture.edgesInput.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text }));
  const coldGroup = samples(30, () => solveRouteGroups(input));
  const coldCache = samples(30, () => new GroupRouteCache().update({ ...input }));
  const coldLegacy = samples(30, () => new DiagramRouteCache().update(fixture.nodes, fixture.projection, legacyInputs));
  const groupCache = new GroupRouteCache();
  const warmGroup = groupCache.update({ ...input });
  const groupIncrementalMs: number[] = [];
  const localFailures: Array<Record<string, unknown>> = [];
  let groupIncrementalStats = warmGroup.stats;
  let lastMoved = fixture.nodes;
  for (let index = -3; index < 30; index += 1) {
    const moved = fixture.nodes.map((node) => node.id === 'leaf-0-0' ? { ...node, position: { x: node.position.x - 12 - Math.max(0, index) * 4, y: node.position.y + 8 } } : node);
    lastMoved = moved;
    const started = performance.now();
    const update = groupCache.update({ ...input, nodes: moved });
    const elapsed = performance.now() - started;
    groupIncrementalStats = update.stats;
    if (index >= 0) {
      groupIncrementalMs.push(elapsed);
      if (!update.outcome?.ok) localFailures.push({
        frame: index, stats: update.stats, error: update.error,
        failures: update.outcome?.failures ?? [],
      });
    }
  }
  const legacyCache = new DiagramRouteCache();
  legacyCache.update(fixture.nodes, fixture.projection, legacyInputs);
  const legacyIncrementalMs: number[] = [];
  for (let index = -3; index < 30; index += 1) {
    const moved = fixture.nodes.map((node) => node.id === 'leaf-0-0' ? { ...node, position: { x: node.position.x - 12 - Math.max(0, index) * 4, y: node.position.y + 8 } } : node);
    const started = performance.now();
    legacyCache.update(moved, fixture.projection, legacyInputs);
    if (index >= 0) legacyIncrementalMs.push(performance.now() - started);
  }
  const commitGroup = samples(30, () => groupCache.update({ ...input, nodes: lastMoved }));
  const commitLegacy = samples(30, () => legacyCache.update(lastMoved, fixture.projection, legacyInputs));
  const cold = coldGroup.value;
  const coldCacheOutcome = coldCache.value.outcome;
  const groupRoutes = coldCacheOutcome?.ok ? coldCacheOutcome.routes : cold.ok ? cold.routes : new Map<string, CachedRoute>();
  const legacyRoutes = coldLegacy.value;
  const groupByEdge = new Map<string, string>();
  if (coldCacheOutcome?.ok) for (const plan of coldCacheOutcome.plans) for (const route of plan.routes) groupByEdge.set(route.edgeId, plan.groupId);
  const crossingHotspots = crossGroupCrossingHotspots(qualityRows(groupRoutes), groupByEdge, 5);
  return {
    variant: crossed ? 'crossed' : 'stars',
    edges: edgeCount,
    groups: cold.ok ? cold.groups.length : null,
    coldGroupMs: { p50: percentile(coldGroup.ms, 0.5), p95: percentile(coldGroup.ms, 0.95), samples: coldGroup.ms },
    coldGroupCacheMs: { p50: percentile(coldCache.ms, 0.5), p95: percentile(coldCache.ms, 0.95) },
    coldLegacyMs: { p50: percentile(coldLegacy.ms, 0.5), p95: percentile(coldLegacy.ms, 0.95), samples: coldLegacy.ms },
    localGroupMs: { p50: percentile(groupIncrementalMs, 0.5), p95: percentile(groupIncrementalMs, 0.95), samples: groupIncrementalMs },
    localLegacyMs: { p50: percentile(legacyIncrementalMs, 0.5), p95: percentile(legacyIncrementalMs, 0.95), samples: legacyIncrementalMs },
    commitGroupMs: { p50: percentile(commitGroup.ms, 0.5), p95: percentile(commitGroup.ms, 0.95) },
    commitLegacyMs: { p50: percentile(commitLegacy.ms, 0.5), p95: percentile(commitLegacy.ms, 0.95) },
    warmGroups: warmGroup.stats,
    localGroups: groupIncrementalStats,
    localFailureCount: localFailures.length,
    localFailures,
    crossingHotspots,
    labels: {
      group: new LabelLayoutCache().update(fixture.nodes, fixture.projection, legacyInputs, groupRoutes).stats,
      legacy: new LabelLayoutCache().update(fixture.nodes, fixture.projection, legacyInputs, legacyRoutes).stats,
    },
    quality: { group: quality(groupRoutes), legacy: quality(legacyRoutes) },
  };
}

for (const edges of [50, 100, 200]) for (const crossed of [false, true]) console.log(JSON.stringify(runScale(edges, crossed)));
