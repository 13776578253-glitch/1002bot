import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../src/core/projection/index.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import type { CanvasNode } from '../src/react/model/grouping.ts';
import { solveRouteGroups, type GroupEdgeInput, type GroupSolveInput } from '../src/react/model/route-groups.ts';
import { GroupRouteCache, type GroupRouteCacheInput } from '../src/react/model/group-route-cache.ts';

const card = (id: string, x: number, y: number, width = 260, height = 92): CanvasNode => ({ id, type: 'card', position: { x, y }, width, height, data: { title: id } });

function fixture(nodes: CanvasNode[], edges: GroupEdgeInput[], maxEdgesPerGroup = 12): GroupRouteCacheInput {
  const stage: StageSnapshot = {
    id: 'cache', label: 'cache', title: 'cache', track: 'main', order: 0,
    graph: {
      rootId: 'root',
      nodes: [
        { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
        ...nodes.map((node, index) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, order: index + 1, ports: [] })),
      ],
      edges: edges.map((edge, index) => ({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, label: edge.text, relation: 'call' as const, direction: 'directed' as const, order: index })),
    },
  };
  return { nodes, projection: projectGraph(stage, new Set()), edges, maxEdgesPerGroup, revision: 0 };
}

const nodes = [
  card('hubA', 0, 0), card('a1', -300, 400, 120, 60), card('a2', 100, 400, 120, 60),
  card('hubB', 1600, 0), card('b1', 1300, 400, 120, 60), card('b2', 1700, 400, 120, 60),
];
const edges: GroupEdgeInput[] = [
  { id: 'hubA-a1', source: 'hubA', target: 'a1', text: 'A one' },
  { id: 'hubA-a2', source: 'hubA', target: 'a2', text: 'A two' },
  { id: 'hubB-b1', source: 'hubB', target: 'b1', text: 'B one' },
  { id: 'hubB-b2', source: 'hubB', target: 'b2', text: 'B two' },
];

test('group cache returns the same outcome and routes on unchanged input', () => {
  const input = fixture(nodes, edges);
  const cache = new GroupRouteCache();
  const first = cache.update(input);
  assert.equal(first.stats.mode, 'full');
  assert.equal(first.stats.fullReason, 'cold');
  assert.equal(first.outcome?.ok, true);
  const second = cache.update(input);
  assert.equal(second.stats.mode, 'hit');
  assert.equal(second.stats.reusedGroups, second.stats.groups);
  assert.equal(second.stats.solvedGroups, 0);
  assert.equal(second.outcome, first.outcome);
  assert.equal(second.outcome?.ok && second.outcome.routes, first.outcome?.ok && first.outcome.routes);
});

test('moving one star leaf re-solves only its group and keeps the other route objects', () => {
  const cache = new GroupRouteCache();
  const first = cache.update(fixture(nodes, edges));
  assert.equal(first.outcome?.ok, true);
  if (!first.outcome?.ok) return;
  const moved = nodes.map((node) => node.id === 'a1' ? { ...node, position: { x: -280, y: 430 } } : node);
  const second = cache.update(fixture(moved, edges));
  assert.equal(second.stats.mode, 'incremental');
  assert.equal(second.stats.solvedGroups, 1);
  assert.equal(second.stats.reusedGroups, 1);
  assert.equal(second.outcome?.ok, true);
  if (!second.outcome?.ok) return;
  assert.equal(second.outcome.routes.get('hubB-b1'), first.outcome.routes.get('hubB-b1'));
  assert.equal(second.outcome.routes.get('hubB-b2'), first.outcome.routes.get('hubB-b2'));
  assert.notEqual(second.outcome.routes.get('hubA-a1'), first.outcome.routes.get('hubA-a1'));
});

test('successive drag positions stay incremental without a revision bump', () => {
  const cache = new GroupRouteCache();
  const first = cache.update(fixture(nodes, edges));
  assert.equal(first.outcome?.ok, true);
  if (!first.outcome?.ok) return;
  const stepOne = nodes.map((node) => node.id === 'a1' ? { ...node, position: { x: -280, y: 430 } } : node);
  const second = cache.update(fixture(stepOne, edges));
  const stepTwo = stepOne.map((node) => node.id === 'a1' ? { ...node, position: { x: -260, y: 460 } } : node);
  const third = cache.update(fixture(stepTwo, edges));
  assert.equal(second.stats.mode, 'incremental');
  assert.equal(third.stats.mode, 'incremental');
  assert.equal(third.stats.solvedGroups, 1);
  assert.equal(third.stats.reusedGroups, 1);
  assert.equal(third.stats.fullReason, undefined);
  assert.equal(third.outcome?.ok, true);
  if (!third.outcome?.ok) return;
  assert.equal(third.outcome.routes.get('hubB-b1'), first.outcome.routes.get('hubB-b1'));
  assert.equal(third.outcome.routes.get('hubB-b2'), first.outcome.routes.get('hubB-b2'));
});

test('a failed incremental solve does not trigger a full reallocation or commit', () => {
  let failIncremental = false, fullCalls = 0;
  const cache = new GroupRouteCache((input: GroupSolveInput) => {
    if (input.groups) {
      if (failIncremental) return { ok: false, reason: 'NO_COMPLETE_FEASIBLE_MODE', groups: input.groups, failures: [] };
      return solveRouteGroups(input);
    }
    fullCalls += 1;
    return solveRouteGroups(input);
  });
  const first = cache.update(fixture(nodes, edges));
  assert.equal(first.stats.mode, 'full');
  failIncremental = true;
  const moved = nodes.map((node) => node.id === 'a1' ? { ...node, position: { x: -280, y: 430 } } : node);
  const failed = cache.update(fixture(moved, edges));
  assert.equal(failed.stats.mode, 'failed');
  assert.equal(failed.outcome?.ok, false);
  assert.equal(fullCalls, 1, 'incremental failure must not call the full solver');
  failIncremental = false;
  const recovered = cache.update(fixture(moved, edges));
  assert.equal(recovered.stats.mode, 'incremental');
  assert.equal(recovered.outcome?.ok, true);
  assert.equal(fullCalls, 1);
});

test('a revision bump forces a full optimization', () => {
  const cache = new GroupRouteCache();
  const input = fixture(nodes, edges);
  cache.update(input);
  const revised = cache.update({ ...input, revision: 1 });
  assert.equal(revised.stats.mode, 'full');
  assert.equal(revised.stats.fullReason, 'revision');
  assert.equal(revised.stats.solvedGroups, revised.stats.groups);
});

test('groups sharing a node are invalidated with their dirty neighbor', () => {
  const hubNodes = [card('hubA', 0, 0), card('a1', -300, 400, 120, 60), card('a2', 100, 400, 120, 60)];
  const hubEdges: GroupEdgeInput[] = [
    { id: 'hubA-a1', source: 'hubA', target: 'a1', text: 'A one' },
    { id: 'hubA-a2', source: 'hubA', target: 'a2', text: 'A two' },
  ];
  const cache = new GroupRouteCache();
  const first = cache.update(fixture(hubNodes, hubEdges, 1));
  assert.equal(first.stats.groups, 2);
  const moved = hubNodes.map((node) => node.id === 'a1' ? { ...node, position: { x: -280, y: 430 } } : node);
  const second = cache.update(fixture(moved, hubEdges, 1));
  assert.equal(second.stats.mode, 'incremental');
  assert.equal(second.stats.solvedGroups, 2);
  assert.equal(second.stats.reusedGroups, 0);
});
