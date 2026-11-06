import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';
import { projectGraph } from '../../src/core/projection/index.ts';
import { createHierarchyNodes, toggleHierarchy } from '../../src/react/model/layout/hierarchy.ts';
import { aggregateProjectedEdges } from '../../src/react/model/routing/display-edges.ts';
import { DiagramRouteCache } from '../../src/react/model/routing/route-cache.ts';
import { createDiagramGeometry, pathIsClear, routeDiagramGeometry } from '../../src/react/model/routing/routing.ts';
import { captureFrozenSubgraph } from '../../src/react/model/freeze/blackbox-routes.ts';
import { freezeSelection } from '../../src/react/model/freeze/frozen.ts';
import { applyStoredRoutes, removeRoute, reservedLockedRoutes, routeSnapshotForEdge, routeStateFor, upsertRoute, validateStoredRoutes, worldRoutePoints } from '../../src/react/model/routing/edge-routes.ts';

function entity(id: string, parentId: string | null, order: number, kind: CanonicalNode['kind'] = parentId === null ? 'root' : 'component'): CanonicalNode {
  return { id, parentId, kind, label: id, summary: id, order, ports: [] };
}

function link(id: string, source: string, target: string, order = 0): CanonicalEdge {
  return { id, source: { nodeId: source }, target: { nodeId: target }, relation: 'data', direction: 'directed', label: id, order };
}

const stage: StageSnapshot = {
  id: 'main', label: 'main', title: 'main', track: 'main', order: 0,
  graph: {
    rootId: 'root', revision: 'r1',
    nodes: [entity('root', null, 0), entity('module', 'root', 1, 'group'), entity('first', 'module', 2), entity('second', 'module', 3), entity('outside', 'root', 4)],
    edges: [link('inside', 'first', 'second'), link('cross', 'first', 'outside', 1)],
  },
};

const positions = { module: { x: 300, y: 200 }, first: { x: 24, y: 72 }, second: { x: 360, y: 72 }, outside: { x: 900, y: 200 } };
const changes = { inside: { kind: 'baseline' as const, label: '基线' }, cross: { kind: 'baseline' as const, label: '基线' } };
const nodes = (): ReturnType<typeof createHierarchyNodes> => toggleHierarchy(createHierarchyNodes(stage, positions), 'module', stage);
const display = () => {
  const projection = projectGraph(stage, ['module']);
  return { projection, edges: aggregateProjectedEdges(projection, changes) };
};
const routesFor = () => {
  const { projection, edges } = display();
  const cache = new DiagramRouteCache();
  return { projection, edges, routes: cache.update(nodes(), projection, edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text }))) };
};

test('freezing captures internal routes as owner-relative locks and boundary routes as pinned world paths', () => {
  const before = nodes();
  const frozen = freezeSelection({ nodes: before, rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(frozen.ok, true);
  if (!frozen.ok) return;
  const { projection, edges, routes } = routesFor();
  const capture = captureFrozenSubgraph({ nodes: frozen.nodes, stage, group: frozen.group, groups: [frozen.group], displayEdges: edges, displayRoutes: routes, storedRoutes: [] });
  assert.ok(capture.ok);
  const captured = capture.routes;
  const inside = captured.find((route) => route.canonicalEdgeId === 'inside')!;
  const cross = captured.find((route) => route.canonicalEdgeId === 'cross')!;
  assert.equal(inside.state, 'locked');
  assert.deepEqual(inside.space, { kind: 'owner', ownerId: 'module' });
  assert.equal(cross.state, 'pinned');
  assert.deepEqual(cross.space, { kind: 'world' });
  const moved = frozen.nodes.map((node) => node.id === 'module' ? { ...node, position: { x: node.position.x + 100, y: node.position.y + 50 } } : node);
  const shifted = worldRoutePoints(inside, moved)!;
  const original = worldRoutePoints(inside, frozen.nodes)!;
  for (let index = 0; index < shifted.length; index += 1) {
    assert.deepEqual(shifted[index], { x: original[index]!.x + 100, y: original[index]!.y + 50 });
  }
  const movedRoutes = applyStoredRoutes(routes, edges, captured, moved, projection);
  assert.equal(inside.label, undefined);
  assert.deepEqual(movedRoutes.get('inside')!.points, shifted);
  assert.equal(validateStoredRoutes(frozen.nodes, moved, captured, projection), undefined);
  const detached = frozen.nodes.map((node) => node.id === 'first' ? { ...node, position: { ...node.position, x: node.position.x + 25 } } : node);
  assert.match(validateStoredRoutes(frozen.nodes, detached, captured, projection)!, /端点/);
  const firstSegment = worldRoutePoints(inside, frozen.nodes)!;
  const midpoint = { x: (firstSegment[0]!.x + firstSegment[1]!.x) / 2, y: (firstSegment[0]!.y + firstSegment[1]!.y) / 2 };
  const obstructed = frozen.nodes.map((node) => node.id === 'outside' ? { ...node, position: { x: midpoint.x - 20, y: midpoint.y - 20 } } : node);
  assert.match(validateStoredRoutes(frozen.nodes, obstructed, captured, projection)!, /遮挡/);
  assert.ok(pathIsClear(shifted, createDiagramGeometry(moved, projection, reservedLockedRoutes([inside], moved)), 'first', 'second', 'inside'));
});

test('routes with changed canonical ports are never applied to the new relation', () => {
  const { projection, edges, routes } = routesFor();
  const edge = edges.find((item) => item.id === 'inside')!;
  const snapshot = routeSnapshotForEdge(edge, routes.get('inside')!, 'locked', nodes(), [])!;
  const changed = { ...edge, members: edge.members.map((member) => ({ ...member, edge: { ...member.edge, source: { ...member.edge.source, portId: 'new-port' } } })) };
  const replacement = { ...routes.get('inside')!, points: [{ x: 1, y: 2 }, { x: 3, y: 2 }] };
  const map = new Map(routes); map.set('inside', replacement);
  assert.equal(applyStoredRoutes(map, [changed], [snapshot], nodes(), projection).get('inside'), replacement);
});

test('freezing does not save a projected boundary route as a canonical path', () => {
  const collapsed = createHierarchyNodes(stage, positions);
  const projection = projectGraph(stage, []);
  const edges = aggregateProjectedEdges(projection, changes);
  const cache = new DiagramRouteCache();
  const routes = cache.update(collapsed, projection, edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text })));
  const frozen = freezeSelection({ nodes: nodes(), rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(frozen.ok, true);
  if (!frozen.ok) return;
  const capture = captureFrozenSubgraph({ nodes: frozen.nodes, stage, group: frozen.group, groups: [frozen.group], displayEdges: edges, displayRoutes: routes, storedRoutes: [] });
  assert.ok(capture.ok);
  const cross = capture.routes.find((route) => route.canonicalEdgeId === 'cross')!;
  assert.equal(cross.source.nodeId, 'first');
  assert.ok(cross.frozenBoundaries?.length);
});

test('stored paths apply only to matching one-to-one visible endpoints', () => {
  const { projection, edges, routes } = routesFor();
  const edge = edges.find((item) => item.id === 'inside')!;
  const snapshot = routeSnapshotForEdge(edge, routes.get('inside')!, 'locked', nodes(), [])!;
  const applied = applyStoredRoutes(routes, edges, [snapshot], nodes(), projection);
  assert.deepEqual(applied.get('inside')!.points, routes.get('inside')!.points);
  assert.equal(routeStateFor([snapshot], 'inside'), 'locked');
  assert.equal(removeRoute([snapshot], 'inside').length, 0);
  assert.equal(upsertRoute([snapshot], { ...snapshot, state: 'pinned' })[0]!.state, 'pinned');
});

test('a pinned route with a moved endpoint falls back to the newly calculated path', () => {
  const { projection, edges, routes } = routesFor();
  const edge = edges.find((item) => item.id === 'inside')!;
  const snapshot = routeSnapshotForEdge(edge, routes.get('inside')!, 'pinned', nodes(), [])!;
  const moved = nodes().map((node) => node.id === 'second' ? { ...node, position: { ...node.position, x: node.position.x + 80 } } : node);
  const recalculated = new DiagramRouteCache().update(moved, projection, edges.map((item) => ({ id: item.id, source: item.source, target: item.target, text: item.text })));
  const applied = applyStoredRoutes(recalculated, edges, [snapshot], moved, projection);
  assert.equal(applied.get('inside'), recalculated.get('inside'));
  assert.notDeepEqual(applied.get('inside')!.points, routes.get('inside')!.points);
});

test('resizing a locked endpoint is rejected when its port would detach', () => {
  const before = nodes();
  const { projection, edges, routes } = routesFor();
  const edge = edges.find((item) => item.id === 'inside')!;
  const snapshot = routeSnapshotForEdge(edge, routes.get('inside')!, 'locked', before, [])!;
  const resized = before.map((node) => node.id === 'first' ? { ...node, width: node.width! + 40 } : node);
  assert.match(validateStoredRoutes(before, resized, [snapshot], projection)!, /端点/);
});

test('locked routes are hard obstacles while their own edge may ignore the reservation', () => {
  const { projection, edges, routes } = routesFor();
  const inside = edges.find((item) => item.id === 'inside')!;
  const snapshot = routeSnapshotForEdge(inside, routes.get('inside')!, 'locked', nodes(), [])!;
  const reserved = reservedLockedRoutes([snapshot], nodes());
  const geometry = createDiagramGeometry(nodes(), projection, reserved);
  const own = routes.get('inside')!.points;
  assert.equal(pathIsClear(own, geometry, 'first', 'second'), false);
  assert.ok(pathIsClear(own, geometry, 'first', 'second', 'inside'));
  const around = routeDiagramGeometry(geometry, 'outside', 'second');
  assert.ok(pathIsClear(around.points, geometry, 'outside', 'second'));
});
