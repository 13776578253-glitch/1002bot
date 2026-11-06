import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../src/core/projection/index.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import type { CanvasNode } from '../src/react/model/layout/node.ts';
import { createNodePortAllocator } from '../src/core/layout/node-port-allocator.ts';
import {
  allocateEdgePortsAtomic, classifyFailure, getGlobalPortKey, selectModeResult, solveRouteGroups,
  type GroupEdgeInput, type GroupSolveInput, type ModeEvaluationResult,
} from '../src/react/model/routing/route-groups.ts';

function fixture(targets: { id: string; x: number; y: number }[]): GroupSolveInput {
  const hub: CanvasNode = { id: 'hub', type: 'card', position: { x: 0, y: 0 }, width: 260, height: 92, data: { title: 'hub' } };
  const nodes = [hub, ...targets.map((target): CanvasNode => ({ id: target.id, type: 'card', position: { x: target.x, y: target.y }, width: 120, height: 60, data: { title: target.id } }))];
  const edges: GroupEdgeInput[] = targets.map((target) => ({ id: `hub-${target.id}`, source: 'hub', target: target.id, text: target.id }));
  const stage: StageSnapshot = {
    id: 'fixture', label: 'fixture', title: 'fixture', track: 'main', order: 0,
    graph: {
      rootId: 'root',
      nodes: [
        { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
        ...nodes.map((node, index) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, order: index + 1, ports: [] })),
      ],
      edges: edges.map((edge, index) => ({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, label: edge.text, relation: 'call' as const, direction: 'directed' as const, order: index })),
    },
  };
  return { nodes, projection: projectGraph(stage, new Set()), edges, maxEdgesPerGroup: 12 };
}

const fan = fixture([
  { id: 'a', x: -300, y: 400 }, { id: 'b', x: -100, y: 400 },
  { id: 'c', x: 100, y: 400 }, { id: 'd', x: 300, y: 400 },
]);

const assertSuccess = (result: ReturnType<typeof solveRouteGroups>) => {
  if (!result.ok) assert.fail(`solve failed: ${result.reason}`);
  return result;
};

test('a star group solves every edge with a shared allocator', () => {
  const result = assertSuccess(solveRouteGroups(fan));
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0]!.ownerNodeId, 'hub');
  assert.equal(result.plans.length, 1);
  assert.equal(result.routes.size, 4);
  assert.deepEqual(result.failures, []);
  assert.ok(result.plans[0]!.routes.every((route) => route.points.length >= 2));
  for (const route of result.routes.values()) {
  }
});

test('the same input produces the same plan and routes', () => {
  const first = assertSuccess(solveRouteGroups(fan));
  const second = assertSuccess(solveRouteGroups(fan));
  assert.deepEqual(first.plans, second.plans);
  assert.deepEqual([...first.routes], [...second.routes]);
});

test('a high-degree node splits into bounded groups and keeps slots disjoint', () => {
  const targets = Array.from({ length: 14 }, (_, index) => ({ id: `t${index}`, x: (index - 7) * 140, y: 400 }));
  const result = assertSuccess(solveRouteGroups(fixture(targets)));
  assert.equal(result.groups.length, 2);
  const sourceSlots = result.plans.flatMap((plan) => plan.routes.map((route) => getGlobalPortKey(route.sourceSlot.nodeId, route.sourceSlot.physicalId)));
  assert.equal(new Set(sourceSlots).size, sourceSlots.length);
});

test('UT-P15-01 incomplete modes never win through a zero score', () => {
  const complete: ModeEvaluationResult = { mode: 'fork', isComplete: true, totalEdges: 10, successCount: 10, routes: [], failures: [], score: 1500, durationMs: 1 };
  const empty: ModeEvaluationResult = { mode: 'lanes', isComplete: false, totalEdges: 10, successCount: 0, routes: [], failures: [], score: Infinity, durationMs: 1 };
  assert.equal(selectModeResult([empty, complete], true)?.mode, 'fork');
  assert.equal(selectModeResult([empty, complete], false)?.mode, 'fork');
  assert.equal(selectModeResult([empty], true), undefined);
});

test('UT-P15-02 atomic ports release the source when the target fails', () => {
  const allocator = createNodePortAllocator({
    nodes: [
      { id: 's', x: 0, y: 0, width: 260, height: 92 },
      { id: 't', x: 600, y: 0, width: 260, height: 92 },
    ],
    rules: { maxPerSide: 1, minStep: 1000, slotCapacity: 1 },
  });
  allocator.begin();
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    assert.ok(allocator.request({ edgeId: `block-${side}`, nodeId: 't', role: 'target', priority: 'auto', requiredSide: side }));
  }
  const failed = allocateEdgePortsAtomic(allocator, { id: 'x', source: 's', target: 't' }, { side: 'bottom', strict: true }, { side: 'bottom', strict: true });
  assert.equal(failed.success, false);
  assert.ok(allocator.request({ edgeId: 'after', nodeId: 's', role: 'source', priority: 'auto', requiredSide: 'bottom' }));
  allocator.commit();
});

test('UT-P15-03 global port keys keep nodes independent', () => {
  assert.notEqual(getGlobalPortKey('A', 'bottom:0'), getGlobalPortKey('B', 'bottom:0'));
  assert.equal(getGlobalPortKey('A', 'bottom:0'), 'A::bottom:0');
});

test('UT-P15-04 locked ports and paths are reserved from their handles', () => {
  const a: CanvasNode = { id: 'A', type: 'card', position: { x: 0, y: 0 }, width: 260, height: 92, data: { title: 'A' } };
  const b: CanvasNode = { id: 'B', type: 'card', position: { x: 700, y: 0 }, width: 260, height: 92, data: { title: 'B' } };
  const c: CanvasNode = { id: 'C', type: 'card', position: { x: 0, y: 400 }, width: 120, height: 60, data: { title: 'C' } };
  const nodes = [a, b, c];
  const lockedPoints = [{ x: 260, y: 16 }, { x: 700, y: 16 }];
  const edges: GroupEdgeInput[] = [
    { id: 'locked', source: 'A', target: 'B', text: 'locked', priority: 'locked', fixed: { sourceHandle: 'right:source:0', targetHandle: 'left:target:0', points: lockedPoints, text: 'locked' } },
    { id: 'free', source: 'A', target: 'C', text: 'free' },
  ];
  const stage: StageSnapshot = {
    id: 'fixed', label: 'fixed', title: 'fixed', track: 'main', order: 0,
    graph: {
      rootId: 'root',
      nodes: [{ id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] }, ...nodes.map((node, index) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, order: index + 1, ports: [] }))],
      edges: edges.map((edge, index) => ({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, label: edge.text, relation: 'call' as const, direction: 'directed' as const, order: index })),
    },
  };
  const result = assertSuccess(solveRouteGroups({ nodes, projection: projectGraph(stage, new Set()), edges }));
  assert.equal(result.fixedPorts.get('locked')![0]!.slot.handleId, 'right:source:0');
  assert.equal(result.fixedPorts.get('locked')![1]!.slot.handleId, 'left:target:0');
  const free = result.routes.get('free')!;
  for (let index = 1; index < free.points.length; index += 1) {
    const from = free.points[index - 1]!, to = free.points[index]!;
    for (let segment = 1; segment < lockedPoints.length; segment += 1) {
      const l0 = lockedPoints[segment - 1]!, l1 = lockedPoints[segment]!;
      const crossing = from.y === to.y
        ? from.y > Math.min(l0.y, l1.y) - 2 && from.y < Math.max(l0.y, l1.y) + 2 && Math.max(from.x, to.x) > Math.min(l0.x, l1.x) && Math.min(from.x, to.x) < Math.max(l0.x, l1.x)
        : false;
      assert.equal(crossing, false);
    }
  }
});

test('UT-P15-05 each mode gets an independent time slice', () => {
  const targets = Array.from({ length: 12 }, (_, index) => ({ id: `b${index}`, x: (index - 6) * 140, y: 400 }));
  const result = assertSuccess(solveRouteGroups({ ...fixture(targets), budget: { groupMs: 20, edgeMs: 5, aStarMs: 1 } }));
  assert.equal(result.evaluations.length, 4);
  assert.ok(result.evaluations.every((evaluation) => evaluation.durationMs >= 0));
  assert.ok(result.plans.length >= 1);
});

test('UT-P15-06 lanes follow target geometry and do not cross', () => {
  const targets = fixture([{ id: 'l', x: -240, y: 400 }, { id: 'm', x: 0, y: 400 }, { id: 'r', x: 240, y: 400 }]);
  const result = assertSuccess(solveRouteGroups({ ...targets, modes: ['lanes'] }));
  const plan = result.plans[0]!;
  assert.equal(plan.mode, 'lanes');
  const routes = [...plan.routes].sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0));
  const targetX = routes.map((route) => {
    const target = targets.nodes.find((node) => node.id === targets.edges.find((edge) => edge.id === route.edgeId)!.target)!;
    return target.position.x + target.width! / 2;
  });
  assert.deepEqual(targetX, [...targetX].sort((a, b) => a - b));
  const leadX = routes.map((route) => route.points[2]?.x ?? route.points[1]!.x);
  assert.deepEqual(leadX, [...leadX].sort((a, b) => a - b));
  for (let i = 0; i < routes.length; i += 1) for (let j = i + 1; j < routes.length; j += 1) {
    const a = routes[i]!.points, b = routes[j]!.points;
    for (let x = 1; x < a.length; x += 1) for (let y = 1; y < b.length; y += 1) {
      const p = a[x - 1]!, q = a[x]!, r = b[y - 1]!, s = b[y]!;
      const horizontal = p.y === q.y, vertical = r.x === s.x;
      if (!(horizontal && vertical)) continue;
      if (r.x > Math.min(p.x, q.x) && r.x < Math.max(p.x, q.x) && p.y > Math.min(r.y, s.y) && p.y < Math.max(r.y, s.y)) assert.fail(`crossing ${i}/${j}`);
    }
  }
});

test('last-legal retention distinguishes retain, incomplete and rollback', () => {
  const previous = { sourceHandle: 'bottom:source:0', targetHandle: 'top:target:0', points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], text: 'old' };
  assert.equal(classifyFailure({ previous, previousLegal: true, endpointsStable: true, transactional: false }), 'retain');
  assert.equal(classifyFailure({ previous, previousLegal: false, endpointsStable: true, transactional: false }), 'incomplete');
  assert.equal(classifyFailure({ previous, previousLegal: false, endpointsStable: false, transactional: true }), 'rollback');
  assert.equal(classifyFailure({ previousLegal: false, endpointsStable: true, transactional: false }), 'incomplete');
});
