import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageSnapshot } from '../../../core/schema/types.ts';
import { createHierarchyNodes, hierarchyProjection } from '../hierarchy.ts';
import { aggregateProjectedEdges } from '../display-edges.ts';
import { DiagramRouteCache } from '../route-cache.ts';
import { LabelLayoutCache } from '../label-layout.ts';
import { captureLabelledRoutes, labelIdentity, labelSeeds, sceneGeometryKey } from '../label-snapshots.ts';
import { retainedCanonicalRoutes, routeSnapshotForEdge } from '../edge-routes.ts';
import { captureContent, ViewHistory } from '../workspace.ts';
import { normalizeWorkspaceView } from '../../persistence/local-storage.ts';

function fixture() {
  const stage: StageSnapshot = { id: 'one', label: 'one', title: 'one', order: 0, track: 'main', graph: {
    rootId: 'root', nodes: [
      { id: 'root', parentId: null, label: 'root', kind: 'root', order: 0, ports: [] },
      ...['a', 'b'].map((id, order) => ({ id, parentId: 'root', label: id, kind: 'component' as const, order, ports: [] })),
    ], edges: [{ id: 'link', label: '调用', source: { nodeId: 'a' }, target: { nodeId: 'b' }, relation: 'call', direction: 'directed', order: 0 }],
  } };
  const nodes = createHierarchyNodes(stage, { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } });
  const projection = hierarchyProjection(nodes, stage);
  const edges = aggregateProjectedEdges(projection, { link: { kind: 'baseline', label: '基线' } });
  const inputs = edges.map((edge) => ({ ...edge, text: '调用', identity: labelIdentity(edge) }));
  const routes = new DiagramRouteCache().update(nodes, projection, inputs);
  const labels = new LabelLayoutCache().update(nodes, projection, inputs, routes).labels;
  const snapshots = captureLabelledRoutes(nodes, projection, edges, routes, labels, []);
  return { stage, nodes, projection, edges, inputs, routes, labels, snapshots };
}

test('independent label cache projects a saved attachment after a refresh and common translation', () => {
  const { stage, nodes, projection, inputs, edges, routes, labels, snapshots } = fixture();
  const original = labels.get('link')!.placement!;
  assert.ok(original);
  assert.equal(labelSeeds(snapshots, edges).size, 1);
  const moved = nodes.map((node) => ({ ...node, position: { x: node.position.x + 5, y: node.position.y + 3 } }));
  const nextRoutes = new DiagramRouteCache().update(moved, hierarchyProjection(moved, stage), inputs);
  const next = new LabelLayoutCache().update(moved, projection, inputs, nextRoutes, labelSeeds(snapshots, edges)).labels.get('link')!.placement!;
  assert.ok(next);
  assert.equal(next.x, original.x + 5);
  assert.equal(next.y, original.y + 3);
  assert.deepEqual(routes.get('link')!.points, snapshots[0]!.points);
});

test('cache geometry and canonical endpoint identity must match before an attachment is restored', () => {
  const { edges, snapshots } = fixture();
  const changed = structuredClone(snapshots);
  changed[0]!.points[0]!.x++;
  assert.equal(labelSeeds(changed, edges).size, 0);
  const rewired = structuredClone(edges);
  rewired[0]!.members[0]!.edge.source.portId = 'new-port';
  assert.equal(labelSeeds(snapshots, rewired).size, 0);
});

test('invalid automatic attachment metadata is disposable while route geometry stays intact', () => {
  const { nodes, snapshots } = fixture();
  const draft = { revision: 'one', ...captureContent(nodes), displayRoutes: snapshots };
  const raw = { version: 2 as const, baselineId: 'one', baselines: { one: draft } };
  const corrupt = structuredClone(raw);
  corrupt.baselines.one.displayRoutes[0]!.labelAttachment!.pathFraction = Number.NaN;
  const restored = normalizeWorkspaceView(corrupt).baselines.one!;
  assert.deepEqual(restored.displayRoutes![0]!.points, snapshots[0]!.points);
  assert.equal(restored.displayRoutes![0]!.labelAttachment, undefined);
  assert.ok(corrupt.baselines.one.displayRoutes[0]!.labelAttachment);
});

test('derived label caches do not add undo steps and path-only locks retain their exact points', () => {
  const { nodes, projection, edges, routes, snapshots } = fixture();
  const before = { ...captureContent(nodes), displayRoutes: snapshots };
  const after = structuredClone(before);
  after.displayRoutes[0]!.label.x += 10;
  assert.equal(new ViewHistory().record(before, after), false);
  const snapshot = routeSnapshotForEdge(edges[0]!, routes.get('link')!, 'locked', nodes, [])!;
  assert.equal(snapshot.label, undefined);
  const retained = retainedCanonicalRoutes(nodes, projection, edges, [snapshot], new Map());
  assert.deepEqual(retained.get('link')!.points, snapshot.points);
});

test('frame identity tracks final container fitting while ignoring selection-only changes', () => {
  const { nodes } = fixture();
  assert.equal(sceneGeometryKey(nodes), sceneGeometryKey(nodes.map((node) => ({ ...node, selected: true }))));
  const fitted = nodes.map((node, index) => index ? node : { ...node, width: node.width! + 10 });
  assert.notEqual(sceneGeometryKey(nodes), sceneGeometryKey(fitted));
});
