import test from 'node:test';
import assert from 'node:assert/strict';
import { createHierarchyNodes } from '../../layout/hierarchy.ts';
import { hierarchyProjection } from '../../layout/visibility.ts';
import { aggregateProjectedEdges } from '../display-edges.ts';
import { captureDisplayRoutes, retainedDisplayRoutes } from '../display-route-snapshots.ts';
import { DiagramRouteCache } from '../route-cache.ts';
import type { StageSnapshot } from '../../../../core/schema/types.ts';
import { createDiagramGeometry, pathIsClear } from '../routing.ts';

test('restored automatic paths respect locked barriers and reuse only collision-free geometry', () => {
  const stage: StageSnapshot = { id: 'one', label: 'one', title: 'one', order: 0, track: 'main', graph: {
    rootId: 'root', nodes: [
      { id: 'root', parentId: null, label: 'root', kind: 'root', order: 0, ports: [] },
      ...['a', 'b'].map((id, order) => ({ id, parentId: 'root', label: id, kind: 'component' as const, order, ports: [] })),
    ], edges: [{ id: 'link', source: { nodeId: 'a' }, target: { nodeId: 'b' }, relation: 'call', direction: 'directed', order: 0 }],
  } };
  const nodes = createHierarchyNodes(stage, { a: { x: 0, y: 0 }, b: { x: 500, y: 0 } });
  const projection = hierarchyProjection(nodes, stage), edges = aggregateProjectedEdges(projection, { link: { kind: 'baseline', label: '基线' } });
  const routes = new DiagramRouteCache().update(nodes, projection, edges);
  const barriers = [{ edgeId: 'permanent', points: [{ x: 350, y: -100 }, { x: 350, y: 200 }] }];
  const saved = captureDisplayRoutes(nodes, projection, edges, routes, barriers);
  const restored = retainedDisplayRoutes(nodes, projection, edges, saved, barriers);
  assert.equal(restored.size, 0);
  const cache = new DiagramRouteCache();
  const rerouted = cache.update(nodes, projection, edges, barriers, restored);
  assert.equal(cache.lastStats.routedEdges, 1);
  assert.ok(pathIsClear(rerouted.get('link')!.points, createDiagramGeometry(nodes, projection, barriers), 'a', 'b', 'link'));
  const validSaved = captureDisplayRoutes(nodes, projection, edges, rerouted, barriers);
  const validRetained = retainedDisplayRoutes(nodes, projection, edges, validSaved, barriers);
  assert.equal(validRetained.size, 1);
  cache.update(nodes, projection, edges, barriers, validRetained);
  assert.equal(cache.lastStats.routedEdges, 0);
  const moved = [{ ...barriers[0]!, points: barriers[0]!.points.map(point => ({ x: point.x + 20, y: point.y })) }];
  assert.equal(retainedDisplayRoutes(nodes, projection, edges, saved, moved).size, 0);
  const obstructed = nodes.map(node => node.id === 'b' ? { ...node, position: { x: 600, y: 0 } } : node);
  assert.equal(retainedDisplayRoutes(obstructed, projection, edges, saved, barriers).size, 0);
});
