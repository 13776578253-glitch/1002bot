import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGraphPatch,
  createCanvasSceneSync,
  diffSnapshots,
  indexGraph,
  projectGraph,
  validateGraph,
  type CanonicalGraph,
  type StageSnapshot,
} from '../src/index.ts';
import { canvasSceneToFlow } from '../src/react/canvas/projection-to-flow.ts';

function port(id: string, direction: 'in' | 'out' | 'bidirectional' = 'bidirectional') {
  return { id, direction, side: 'auto' as const, order: 0 };
}

function stage(id = 's1', parentId: string | null = null): StageSnapshot {
  const graph: CanonicalGraph = {
    rootId: 'system',
    revision: id,
    nodes: [
      { id: 'system', parentId: null, kind: 'root', label: 'System', ports: [], order: 0 },
      { id: 'runtime', parentId: 'system', kind: 'group', label: 'Runtime', ports: [], order: 1 },
      { id: 'controller', parentId: parentId ?? 'runtime', kind: 'component', label: 'Controller', summary: 'Control loop', ports: [port('out', 'out')], order: 1 },
      { id: 'scheduler', parentId: 'runtime', kind: 'component', label: 'Scheduler', ports: [port('out', 'out')], order: 2 },
      { id: 'agent', parentId: 'system', kind: 'component', label: 'Agent', ports: [port('in', 'in'), port('out', 'out')], order: 2 },
      { id: 'session', parentId: 'system', kind: 'store', label: 'Session', ports: [port('in', 'in')], order: 3 },
    ],
    edges: [
      { id: 'controller-agent', source: { nodeId: 'controller', portId: 'out' }, target: { nodeId: 'agent', portId: 'in' }, relation: 'control', direction: 'directed', label: 'dispatch', order: 0 },
      { id: 'scheduler-agent', source: { nodeId: 'scheduler', portId: 'out' }, target: { nodeId: 'agent', portId: 'in' }, relation: 'event', direction: 'directed', label: 'tick', order: 1 },
      { id: 'agent-session', source: { nodeId: 'agent', portId: 'out' }, target: { nodeId: 'session', portId: 'in' }, relation: 'storage', direction: 'directed', label: 'append', order: 2 },
    ],
  };
  return { id, label: id.toUpperCase(), track: 'main', order: 1, title: 'Architecture', graph };
}

test('graph validator keeps identity and hierarchy explicit', () => {
  const snapshot = stage();
  const graph = indexGraph(snapshot);
  assert.equal(graph.byId.get('controller')?.parentId, 'runtime');
  assert.equal(graph.pathOf('controller'), 'system/runtime/controller');
  assert.deepEqual(graph.childrenOf.get('runtime'), ['controller', 'scheduler']);
  assert.equal(validateGraph(snapshot.graph).length, 0);
});

test('graph patch applies incrementally by revision', () => {
  const snapshot = stage();
  const next = applyGraphPatch(snapshot.graph, {
    baseRevision: 's1',
    nextRevision: 's2',
    operations: [{ kind: 'reparentNode', id: 'controller', parentId: 'system' }],
  });
  assert.equal(next.revision, 's2');
  assert.equal(next.nodes.find((node) => node.id === 'controller')?.parentId, 'system');
  assert.throws(() => applyGraphPatch(snapshot.graph, { baseRevision: 'wrong', nextRevision: 's3', operations: [] }));
});

test('projection uses stable IDs and boundary ports', () => {
  const projection = projectGraph(stage(), []);
  assert.deepEqual(projection.nodes.map((node) => node.id).sort(), ['agent', 'runtime', 'session'].sort());
  const folded = projection.edges.find((edge) => edge.canonicalEdgeId === 'controller-agent');
  assert.ok(folded);
  assert.equal(folded.folded, true);
  assert.match(folded.source.portId ?? '', /^boundary:/);
});

test('projection reveals nested nodes only when their group is expanded', () => {
  const projection = projectGraph(stage(), ['runtime']);
  assert.ok(projection.nodes.some((node) => node.id === 'controller' && node.parentId === 'runtime'));
  const edge = projection.edges.find((item) => item.canonicalEdgeId === 'controller-agent');
  assert.equal(edge?.source.nodeId, 'controller');
  assert.equal(edge?.source.portId, 'out');
});

test('evolution diff uses stable IDs across reparenting', () => {
  const before = stage('s1');
  const after = stage('s2', 'system');
  after.order = 2;
  const delta = diffSnapshots(before, after);
  assert.equal(delta.nodes.find((node) => node.id === 'controller')?.kind, 'moved');
});

test('scene is the sole assembly result with nested layout and routed edges', () => {
  const scene = createCanvasSceneSync({ stage: stage(), expanded: ['runtime'], sceneVersion: 7 });
  assert.equal(scene.sceneVersion, 7);
  assert.equal(scene.stageId, 's1');
  assert.ok(scene.nodes.some((node) => node.id === 'runtime' && node.expanded));
  assert.ok(scene.nodes.some((node) => node.id === 'controller' && node.parentId === 'runtime'));
  assert.ok(scene.edges.every((edge) => edge.route?.points && edge.route.points.length >= 2));
  assert.ok(scene.layout.nodes.every((node) => node.worldRect.w > 0 && node.worldRect.h > 0));
});

test('React Flow adapter preserves stable IDs and parent-local coordinates', () => {
  const scene = createCanvasSceneSync({ stage: stage(), expanded: ['runtime'] });
  const flow = canvasSceneToFlow(scene);
  const runtime = flow.nodes.find((node) => node.id === 'node:runtime');
  const controller = flow.nodes.find((node) => node.id === 'node:controller');
  assert.ok(runtime);
  assert.equal(controller?.parentId, 'node:runtime');
  assert.equal(controller?.extent, 'parent');
  assert.ok(flow.edges.every((edge) => edge.id.startsWith('edge:')));
});

test('scene request sequence fields identify the graph revision and metrics revision', () => {
  const scene = createCanvasSceneSync({ stage: stage(), expanded: [], sceneVersion: 3, metricsRevision: 2 });
  assert.equal(scene.graphRevision, 's1');
  assert.equal(scene.metricsRevision, 2);
});
