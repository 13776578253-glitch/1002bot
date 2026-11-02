import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../src/core/projection/index.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import type { CanvasNode } from '../src/react/model/grouping.ts';
import { GroupRouteCache, type GroupRouteCacheInput } from '../src/react/model/group-route-cache.ts';
import { solveRouteGroups, type GroupEdgeInput, type GroupSolveInput } from '../src/react/model/route-groups.ts';
import { measureRoutes, type QualityRoute } from '../src/react/model/route-quality.ts';
import type { CachedRoute } from '../src/react/model/route-cache.ts';

const card = (id: string, x: number, y: number, width = 240, height = 80): CanvasNode => ({ id, type: 'card', position: { x, y }, width, height, data: { title: id } });
const nodes = [
  card('hubA', 0, 0), card('a1', -300, 400, 120, 60), card('a2', 100, 400, 120, 60),
  card('hubB', 1800, 0), card('b1', 1500, 400, 120, 60), card('b2', 1900, 400, 120, 60),
  card('hubC', 3600, 0), card('c1', 3300, 400, 120, 60), card('c2', 3700, 400, 120, 60),
];
const edges: GroupEdgeInput[] = [
  { id: 'a1', source: 'hubA', target: 'a1', text: 'A 一' }, { id: 'a2', source: 'hubA', target: 'a2', text: 'A 二' },
  { id: 'b1', source: 'hubB', target: 'b1', text: 'B 一' }, { id: 'b2', source: 'hubB', target: 'b2', text: 'B 二' },
  { id: 'c1', source: 'hubC', target: 'c1', text: 'C 一' }, { id: 'c2', source: 'hubC', target: 'c2', text: 'C 二' },
];

function fixture(inputNodes: readonly CanvasNode[], inputEdges: readonly GroupEdgeInput[]): GroupRouteCacheInput {
  const stage: StageSnapshot = {
    id: 'p5', label: 'p5', title: 'p5', track: 'main', order: 0,
    graph: {
      rootId: 'root',
      nodes: [
        { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
        ...inputNodes.map((node, index) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, order: index + 1, ports: [] })),
      ],
      edges: inputEdges.map((edge, index) => ({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, label: edge.text, relation: 'call' as const, direction: 'directed' as const, order: index })),
    },
    presentation: { portPolicy: { direction: 'top-down' }, relations: Object.fromEntries(inputEdges.map((edge) => [edge.id, { expanded: [], collapsed: [], sourceRelationIds: [] }])) },
  };
  return { nodes: inputNodes, projection: projectGraph(stage, new Set()), edges: inputEdges, policy: { direction: 'top-down' }, maxEdgesPerGroup: 12 };
}

function quality(routes: Map<string, CachedRoute>): ReturnType<typeof measureRoutes> {
  const rows: QualityRoute[] = [...routes].map(([edgeId, route]) => ({
    edgeId, points: route.points, label: route.label, labelRequired: Boolean(route.text.trim()),
    ...(route.labelState ? { labelState: route.labelState } : {}),
  }));
  return measureRoutes(rows);
}

test('multi-node moves invalidate only affected groups and preserve untouched route objects', () => {
  const cache = new GroupRouteCache();
  const first = cache.update(fixture(nodes, edges));
  assert.equal(first.outcome?.ok, true);
  if (!first.outcome?.ok) return;
  const moved = nodes.map((node) => ['a1', 'b1'].includes(node.id) ? { ...node, position: { x: node.position.x + 20, y: node.position.y + 10 } } : node);
  const second = cache.update(fixture(moved, edges));
  assert.equal(second.stats.mode, 'incremental');
  assert.equal(second.stats.solvedGroups, 2);
  assert.equal(second.stats.reusedGroups, 1);
  assert.equal(second.outcome?.ok, true);
  if (!second.outcome?.ok) return;
  assert.equal(second.outcome.routes.get('c1'), first.outcome.routes.get('c1'));
  assert.equal(second.outcome.routes.get('c2'), first.outcome.routes.get('c2'));
  const metrics = quality(second.outcome.routes);
  assert.equal(metrics.labelOverlaps, 0);
  assert.equal(metrics.labelOwnerMisses, 0);
});

test('node-set changes force a full solve and leave no stale records', () => {
  const cache = new GroupRouteCache();
  cache.update(fixture(nodes, edges));
  const extra = [...nodes, card('hubD', 5400, 0), card('d1', 5100, 400, 120, 60)];
  const extraEdges = [...edges, { id: 'd1', source: 'hubD', target: 'd1', text: 'D 一' }];
  const changed = cache.update(fixture(extra, extraEdges));
  assert.equal(changed.stats.mode, 'full');
  assert.equal(changed.stats.fullReason, 'node-set');
  assert.equal(changed.outcome?.ok, true);
  if (!changed.outcome?.ok) return;
  assert.equal(changed.outcome.routes.size, extraEdges.length);
  assert.ok(changed.outcome.routes.has('d1'));
});

test('injected budget, path, port and fixed failures stay atomic and recover incrementally', () => {
  for (const reason of ['budget', 'no-candidate', 'port-capacity', 'fixed-conflict'] as const) {
    let fail = false, fullCalls = 0;
    const cache = new GroupRouteCache((input: GroupSolveInput) => {
      if (!input.groups) { fullCalls += 1; return solveRouteGroups(input); }
      if (fail) return { ok: false, reason: 'NO_COMPLETE_FEASIBLE_MODE', groups: input.groups, failures: [{ edgeId: 'a1', reason }] };
      return solveRouteGroups(input);
    });
    const first = cache.update(fixture(nodes, edges));
    assert.equal(first.outcome?.ok, true);
    if (!first.outcome?.ok) continue;
    fail = true;
    const failed = cache.update(fixture(nodes.map((node) => node.id === 'a1' ? { ...node, position: { x: node.position.x + 10, y: node.position.y + 5 } } : node), edges));
    assert.equal(failed.stats.mode, 'failed');
    assert.equal(failed.outcome?.ok, false);
    if (failed.outcome?.ok === false) assert.equal(failed.outcome.failures[0]?.reason, reason);
    assert.equal(fullCalls, 1, `${reason} must not trigger a full solve`);
    assert.ok(first.outcome.routes.size > 0);
    fail = false;
    const recovered = cache.update(fixture(nodes.map((node) => node.id === 'a1' ? { ...node, position: { x: node.position.x + 12, y: node.position.y + 6 } } : node), edges));
    assert.equal(recovered.stats.mode, 'incremental');
    assert.equal(fullCalls, 1);
  }
});
