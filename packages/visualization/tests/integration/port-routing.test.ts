import { resolveRoutes } from '../../src/react/model/routing/resolve-routes.ts';
import { GroupRouteCache } from '../../src/react/model/routing/group-route-cache.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../../src/core/projection/index.ts';
import type { StageSnapshot } from '../../src/core/schema/types.ts';
import type { CanvasNode } from '../../src/react/model/layout/node.ts';
import { createDiagramGeometry, pathIsClear, routeDiagramGeometry, type ReservedRoute } from '../../src/react/model/routing/routing.ts';
import { aggregateProjectedEdges } from '../../src/react/model/routing/display-edges.ts';
import { captureDisplayRoutes, retainedDisplayRoutes } from '../../src/react/model/routing/display-route-snapshots.ts';
import { applyStoredRoutes, retainedCanonicalRoutes, routeSnapshotForEdge, validateStoredRoutes } from '../../src/react/model/routing/edge-routes.ts';
import { DiagramRouteCache } from '../../src/react/model/routing/route-cache.ts';
import { freezeSelection } from '../../src/react/model/freeze/frozen.ts';
import { captureFrozenSubgraph } from '../../src/react/model/freeze/blackbox-routes.ts';
import { resolveFrozenBoundaryRoute } from '../../src/react/model/routing/frozen-boundary.ts';
import type { EdgeRouteSnapshot, FrozenGroupSnapshot } from '../../src/react/model/contracts/snapshot-types.ts';

function card(id: string, x: number, y: number, width = 260, height = 92): CanvasNode {
  return { id, type: 'card', position: { x, y }, width, height, data: { title: id } };
}

function geometry(nodes: CanvasNode[], reserved: ReservedRoute[] = []) {
  const stage: StageSnapshot = {
    id: 'stage', label: 'stage', title: 'stage', track: 'main', order: 0,
    graph: {
      rootId: 'root',
      nodes: [
        { id: 'root', parentId: null, kind: 'root', label: 'Root', ports: [], order: 0 },
        ...nodes.map((node, order) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, ports: [], order: order + 1 })),
      ],
      edges: [],
    },
  };
  return createDiagramGeometry(nodes, projectGraph(stage, new Set()), reserved);
}

const routeLength = (points: readonly { x: number; y: number }[]) => points.slice(1).reduce((length, point, index) =>
  length + Math.abs(point.x - points[index]!.x) + Math.abs(point.y - points[index]!.y), 0);

function overviewNodes(): CanvasNode[] {
  return [
    card('event', 640, 40), card('runtime', 640, 260), card('agent', 100, 560),
    card('provider', 460, 560), card('world', 820, 560), card('session', 1180, 560),
  ];
}

function scene(nodes: CanvasNode[], source: string, target: string) {
  const stage: StageSnapshot = { id: 'stage', label: 'stage', title: 'stage', track: 'main', order: 0, graph: {
    rootId: 'root',
    nodes: [{ id: 'root', parentId: null, kind: 'root', label: 'Root', ports: [], order: 0 },
      ...nodes.map((node, order) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, ports: [], order: order + 1 }))],
    edges: [{ id: 'link', source: { nodeId: source }, target: { nodeId: target }, relation: 'call', direction: 'directed', label: '调用', order: 0 }],
  } };
  const projection = projectGraph(stage, new Set());
  const edges = aggregateProjectedEdges(projection, { link: { kind: 'baseline', label: '基线' } });
  return { stage, projection, edges, inputs: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })) };
}

test('top-down overview uses downward ports and symmetric concise routes for its six nodes', () => {
  const input = geometry(overviewNodes());
  const incoming = routeDiagramGeometry(input, 'event', 'runtime', 'event-runtime', { direction: 'top-down' });
  assert.equal(incoming.sourceHandle, 'out');
  assert.equal(incoming.targetHandle, 'in');
  assert.equal(incoming.points.length, 2);

  const routes = ['agent', 'provider', 'world', 'session'].map((target) => {
    const route = routeDiagramGeometry(input, 'runtime', target, `runtime-${target}`, { direction: 'top-down' });
    assert.equal(route.sourceHandle, 'out', target);
    assert.equal(route.targetHandle, 'in', target);
    assert.ok(pathIsClear(route.points, input, 'runtime', target, `runtime-${target}`), target);
    return route;
  });
  const provider = routes[1]!, world = routes[2]!;
  assert.equal(provider.points.length, world.points.length);
  assert.ok(provider.points.length <= 4, 'mirrored paths have at most two bends');
  assert.equal(routeLength(provider.points), routeLength(world.points));
});

test('automatic port policy follows horizontal geometry in both directions', () => {
  const input = geometry([card('left', 0, 0), card('right', 600, 0)]);
  const forward = routeDiagramGeometry(input, 'left', 'right', 'forward', { direction: 'auto' });
  const backward = routeDiagramGeometry(input, 'right', 'left', 'backward', { direction: 'auto' });
  assert.deepEqual([forward.sourceHandle, forward.targetHandle], ['return-out', 'left-in']);
  assert.deepEqual([backward.sourceHandle, backward.targetHandle], ['left-out', 'return']);
  assert.ok(pathIsClear(forward.points, input, 'left', 'right', 'forward'));
  assert.ok(pathIsClear(backward.points, input, 'right', 'left', 'backward'));
  assert.equal(routeLength(forward.points), routeLength(backward.points));
});

test('automatic diagonal side ports consider simple elbows around neighboring cards', () => {
  const input = geometry(overviewNodes());
  for (const target of ['agent', 'session']) {
    const route = routeDiagramGeometry(input, 'runtime', target, `runtime-${target}`, { direction: 'auto' });
    assert.ok(route.feasible);
    assert.equal(route.points.length - 2, 2, target);
    assert.ok(pathIsClear(route.points, input, 'runtime', target));
  }
});

test('an occupied preferred port falls back to another collision-free pair', () => {
  const input = geometry([card('source', 0, 0, 120, 60), card('blocker', -20, 65, 160, 60), card('target', 0, 300, 120, 60)]);
  const route = routeDiagramGeometry(input, 'source', 'target', 'edge', { direction: 'top-down' });
  assert.notEqual(route.sourceHandle, 'out');
  assert.ok(pathIsClear(route.points, input, 'source', 'target', 'edge'));
});

test('candidate selection treats a locked route as an obstacle', () => {
  const reserved = [{ edgeId: 'locked', points: [{ x: 60, y: 120 }, { x: 60, y: 240 }] }];
  const input = geometry([card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60)], reserved);
  const route = routeDiagramGeometry(input, 'source', 'target', 'edge', { direction: 'top-down' });
  assert.ok(pathIsClear(route.points, input, 'source', 'target', 'edge'));
});

test('a custom port-crowding priority can choose a less occupied feasible route', () => {
  const input = geometry([card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60)]);
  const initial = routeDiagramGeometry(input, 'source', 'target', 'first', { direction: 'top-down' });
  const occupied = [{ id: 'first', source: 'source', target: 'target', sourceHandle: initial.sourceHandle, targetHandle: initial.targetHandle, points: initial.points }];
  const preferred = routeDiagramGeometry(input, 'source', 'target', 'second', { direction: 'top-down' }, occupied);
  const distributed = routeDiagramGeometry(input, 'source', 'target', 'second', { direction: 'top-down', priority: ['portCrowding', 'overlap'] }, occupied);
  assert.ok(pathIsClear(distributed.points, input, 'source', 'target', 'second'));
  assert.ok(distributed.cost.portCrowding < preferred.cost.portCrowding);
  assert.ok(distributed.cost.overlap < preferred.cost.overlap);
});

test('a source enclosed by obstacles reports no feasible route', () => {
  const input = geometry([
    card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60),
    card('top', -20, -70, 160, 64), card('bottom', -20, 66, 160, 64),
    card('left', -70, -10, 64, 80), card('right', 126, -10, 64, 80),
  ]);
  const route = routeDiagramGeometry(input, 'source', 'target', 'edge', { direction: 'top-down' });
  assert.equal(route.feasible, false);
  assert.deepEqual(route.points, []);
});

test('changing the port policy invalidates only once, while selection changes keep cached paths', () => {
  const nodes = overviewNodes(), { projection, inputs } = scene(nodes, 'runtime', 'agent'), cache = new DiagramRouteCache();
  const before = cache.update(nodes, projection, inputs, [], new Map(), { direction: 'auto' }).get('link')!;
  assert.equal(before.sourceHandle, 'left-out');
  const after = cache.update(nodes, projection, inputs, [], new Map(), { direction: 'top-down' }).get('link')!;
  assert.equal(cache.lastStats.routedEdges, 1);
  assert.equal(after.sourceHandle, 'out');
  assert.notDeepEqual(after.points, before.points);
  const same = cache.update(nodes, projection, inputs, [], new Map(), { direction: 'top-down' }).get('link')!;
  assert.equal(cache.lastStats.routedEdges, 0);
  assert.equal(same, after);
  const selected = nodes.map(node => ({ ...node, selected: true }));
  assert.equal(cache.update(selected, projection, inputs, [], new Map(), { direction: 'top-down' }).get('link'), after);
  assert.equal(cache.lastStats.routedEdges, 0);
});

test('display snapshots are reused only under the same port policy, with legacy snapshots rerouted', () => {
  const nodes = overviewNodes(), { projection, edges, inputs } = scene(nodes, 'runtime', 'agent');
  const policy = { direction: 'auto' as const }, otherPolicy = { direction: 'top-down' as const };
  const routes = new DiagramRouteCache().update(nodes, projection, inputs, [], new Map(), policy);
  const snapshots = captureDisplayRoutes(nodes, projection, edges, routes, [], policy);
  assert.equal(snapshots.length, 1);
  assert.equal(retainedDisplayRoutes(nodes, projection, edges, snapshots, [], policy).size, 1);
  assert.equal(retainedDisplayRoutes(nodes, projection, edges, snapshots, [], otherPolicy).size, 0);
  const { policyKey: _oldPolicyKey, ...legacy } = snapshots[0]!;
  assert.equal(retainedDisplayRoutes(nodes, projection, edges, [legacy], [], policy).size, 0);
  const cache = new DiagramRouteCache();
  cache.update(nodes, projection, inputs, [], retainedDisplayRoutes(nodes, projection, edges, [legacy], [], policy), policy);
  assert.equal(cache.lastStats.routedEdges, 1);
});

test('a locked canonical path remains preserved after the port policy changes', () => {
  const nodes = overviewNodes(), { projection, edges, inputs } = scene(nodes, 'runtime', 'agent');
  const original = new DiagramRouteCache().update(nodes, projection, inputs, [], new Map(), { direction: 'auto' });
  const locked = routeSnapshotForEdge(edges[0]!, original.get('link')!, 'locked', nodes, [])!;
  const retained = retainedCanonicalRoutes(nodes, projection, edges, [locked], new Map());
  const next = new DiagramRouteCache().update(nodes, projection, inputs, [], retained, { direction: 'top-down' });
  const resolved = applyStoredRoutes(next, edges, [locked], nodes, projection);
  assert.deepEqual(resolved.get('link')!.points, original.get('link')!.points);
  assert.equal(resolved.get('link')!.sourceHandle, 'left-out');
});

test('an infeasible cached route remains blocked and is not persisted as display or canonical geometry', () => {
  const nodes = [card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60),
    card('top', -20, -70, 160, 64), card('bottom', -20, 66, 160, 64),
    card('left', -70, -10, 64, 80), card('right', 126, -10, 64, 80)];
  const { projection, edges, inputs } = scene(nodes, 'source', 'target');
  const routes = new DiagramRouteCache().update(nodes, projection, inputs, [], new Map(), { direction: 'top-down' });
  assert.equal(routes.get('link')!.feasible, false);
  assert.deepEqual(routes.get('link')!.points, []);
  assert.deepEqual(captureDisplayRoutes(nodes, projection, edges, routes, [], { direction: 'top-down' }), []);
  assert.equal(routeSnapshotForEdge(edges[0]!, routes.get('link')!, 'locked', nodes, []), undefined);
});

test('an infeasible route is recomputed when its enclosing locked paths are removed', () => {
  const nodes = [card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60)];
  const { projection, inputs } = scene(nodes, 'source', 'target');
  const reserved = [
    { edgeId: 'top', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }] },
    { edgeId: 'bottom', points: [{ x: 0, y: 60 }, { x: 120, y: 60 }] },
    { edgeId: 'left', points: [{ x: 0, y: 0 }, { x: 0, y: 60 }] },
    { edgeId: 'right', points: [{ x: 120, y: 0 }, { x: 120, y: 60 }] },
  ];
  const cache = new DiagramRouteCache();
  assert.equal(cache.update(nodes, projection, inputs, reserved).get('link')!.feasible, false);
  const recovered = cache.update(nodes, projection, inputs, []).get('link')!;
  assert.equal(cache.lastStats.routedEdges, 1);
  assert.equal(recovered.feasible, true);
  assert.ok(pathIsClear(recovered.points, createDiagramGeometry(nodes, projection), 'source', 'target', 'link'));
});

test('freezing an impossible cross-boundary route returns a conflict without mutating the inputs', () => {
  const nodes = [card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60),
    card('top', -20, -70, 160, 64), card('bottom', -20, 66, 160, 64),
    card('left', -70, -10, 64, 80), card('right', 126, -10, 64, 80)];
  const { stage, projection, edges, inputs } = scene(nodes, 'source', 'target');
  const frozen = freezeSelection({ nodes, rootIds: ['source'], groupId: 'freeze:source', stage });
  assert.equal(frozen.ok, true);
  if (!frozen.ok) return;
  const routes = new DiagramRouteCache().update(frozen.nodes, projection, inputs);
  assert.equal(routes.get('link')!.feasible, false);
  const before = structuredClone({ nodes: frozen.nodes, group: frozen.group, routes: [...routes] });
  const result = captureFrozenSubgraph({ nodes: frozen.nodes, stage, group: frozen.group, groups: [frozen.group], displayEdges: edges, displayRoutes: routes, storedRoutes: [] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.conflicts[0]!.kind, 'locked-route');
  assert.deepEqual({ nodes: frozen.nodes, group: frozen.group, routes: [...routes] }, before);
});

test('a one-sided frozen boundary resolves or reports conflict when the automatic fallback is blocked', () => {
  const nodes: CanvasNode[] = [
    { id: 'owner', type: 'structure', position: { x: 0, y: 0 }, width: 200, height: 200, data: { title: 'owner', expanded: true } },
    { ...card('source', 30, 100, 50, 50), parentId: 'owner' },
    card('target', 500, 100, 50, 50),
  ];
  const group: FrozenGroupSnapshot = { id: 'freeze', rootId: 'owner', memberIds: ['source'], worldBounds: { x: 0, y: 0, w: 200, h: 200 }, boundaryPorts: [], createdAt: '' };
  const snapshot: EdgeRouteSnapshot = {
    canonicalEdgeId: 'edge', state: 'pinned', source: { nodeId: 'source', handle: 'return-out' }, target: { nodeId: 'target', handle: 'left-in' },
    points: [{ x: 80, y: 125 }, { x: 200, y: 125 }, { x: 500, y: 125 }], space: { kind: 'world' }, endpointFingerprint: 'edge',
    frozenBoundaries: [{ ownerId: 'owner', endpoint: 'source', side: 'right', points: [{ x: 80, y: 125 }, { x: 200, y: 125 }] }],
  };
  const fallback = { feasible: false, sourceHandle: 'return-out', targetHandle: 'left-in', points: [], text: 'edge', label: { x: 0, y: 0, width: 0, height: 0 } };
  const before = structuredClone({ nodes, group, snapshot, fallback });
  const result = resolveFrozenBoundaryRoute('edge', snapshot, nodes, geometry(nodes), 'source', 'target', fallback, [group]);
  if (result.ok) {
    assert.equal(result.route.feasible, true);
    assert.deepEqual(result.route.points.slice(0, 2), snapshot.frozenBoundaries![0]!.points);
  } else assert.ok(result.message);
  assert.deepEqual({ nodes, group, snapshot, fallback }, before);
});

test('a shared frozen corridor is restored without allowing exterior locked crossings', () => {
  const nodes = [card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60)];
  const { projection, edges, inputs } = scene(nodes, 'source', 'target');
  const routes = new DiagramRouteCache().update(nodes, projection, inputs);
  const shared = [{ x: 60, y: 60 }, { x: 60, y: 120 }];
  const protectedRoutes = [{ edgeId: 'link', points: shared, frozenOwnerId: 'frame' }, { edgeId: 'shared-frozen', points: shared, frozenOwnerId: 'frame' }];
  const saved = captureDisplayRoutes(nodes, projection, edges, routes, protectedRoutes);
  assert.equal(retainedDisplayRoutes(nodes, projection, edges, saved, protectedRoutes).size, 1);
  const exterior = [...protectedRoutes, { edgeId: 'exterior', points: [{ x: -20, y: 200 }, { x: 140, y: 200 }] }];
  const invalid = captureDisplayRoutes(nodes, projection, edges, routes, exterior);
  assert.equal(retainedDisplayRoutes(nodes, projection, edges, invalid, exterior).size, 0);
});

test('scene routing accepts a complete Group solve and applies the same input policy to Legacy preview', () => {
  const nodes = [card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60)];
  const { projection, edges } = scene(nodes, 'source', 'target');
  const policy = { direction: 'top-down' } as const;
  const input = { nodes, projection, edges, policy };
  const legacy = new DiagramRouteCache(), group = new GroupRouteCache();
  const active = resolveRoutes(input, legacy, group);
  assert.equal(active.status.engine, 'group');
  assert.equal(active.failures.size, 0);
  assert.match(active.routes.get('link')!.sourceHandle, /^bottom:source:/);
  const locked = routeSnapshotForEdge(edges[0]!, active.routes.get('link')!, 'locked', nodes, []);
  assert.ok(locked);
  assert.equal(validateStoredRoutes(nodes, nodes, [locked], projection), undefined);
  const protectedScene = resolveRoutes({ ...input, stored: [locked] }, legacy, group);
  assert.equal(protectedScene.status.fallback?.reason, 'protected-routes');
  assert.equal(protectedScene.failures.size, 0);
  assert.deepEqual(protectedScene.routes.get('link')!.points, locked.points);
  const preview = resolveRoutes({ ...input, readOnly: true, seed: active.routes }, legacy, group);
  assert.equal(preview.status.fallback?.reason, 'preview');
  assert.equal(preview.failures.size, 0);
  assert.deepEqual(preview.routes.get('link')!.points, active.routes.get('link')!.points);
});

test('a restored route with the wrong port is replaced before it can be rendered', () => {
  const nodes = [card('source', 0, 0, 120, 60), card('target', 0, 300, 120, 60)];
  const { projection, edges } = scene(nodes, 'source', 'target');
  const input = { nodes, projection, edges };
  const first = resolveRoutes(input, new DiagramRouteCache());
  const snapshots = captureDisplayRoutes(nodes, projection, edges, first.routes);
  snapshots[0]!.sourceHandle = 'left-out';
  const restored = resolveRoutes({ ...input, displaySnapshots: snapshots }, new DiagramRouteCache());
  assert.equal(restored.failures.size, 0);
  assert.equal(restored.reusedPaths, 0);
  assert.equal(restored.routes.get('link')!.sourceHandle, first.routes.get('link')!.sourceHandle);
});
