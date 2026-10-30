import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGraphPatch, assertValidSnapshot, indexGraph, projectGraph, validateGraph,
  type StageSnapshot,
} from '../src/index.ts';

function stage(): StageSnapshot {
  return {
    id: 'initial', label: 'Initial', title: 'Architecture', track: 'main', order: 0,
    graph: {
      rootId: 'architecture', revision: 'one',
      nodes: [
        { id: 'architecture', parentId: null, kind: 'root', label: 'Architecture', ports: [], order: 0 },
        { id: 'runtime', parentId: 'architecture', kind: 'group', label: 'Runtime', ports: [], order: 1 },
        { id: 'controller', parentId: 'runtime', kind: 'component', label: 'Controller', ports: [{ id: 'send', direction: 'out', side: 'right', order: 0 }], order: 0 },
        { id: 'worker', parentId: 'architecture', kind: 'component', label: 'Worker', ports: [{ id: 'receive', direction: 'in', side: 'left', order: 0 }], order: 2 },
      ],
      edges: [{ id: 'dispatch', source: { nodeId: 'controller', portId: 'send' }, target: { nodeId: 'worker', portId: 'receive' }, relation: 'control', direction: 'directed', label: 'dispatch', order: 0 }],
    },
  };
}

test('canonical validation and indexing keep explicit identity, hierarchy and ports', () => {
  const snapshot = stage();
  assert.doesNotThrow(() => assertValidSnapshot(snapshot));
  assert.deepEqual(validateGraph(snapshot.graph), []);
  const graph = indexGraph(snapshot);
  assert.equal(graph.byId.get('controller')?.parentId, 'runtime');
  assert.deepEqual(graph.childrenOf.get('runtime'), ['controller']);
  assert.equal(graph.edgesById.get('dispatch')?.source.portId, 'send');
  const duplicate = { ...snapshot.graph, nodes: [...snapshot.graph.nodes, snapshot.graph.nodes[1]!] };
  assert.ok(validateGraph(duplicate).some((issue) => issue.message.includes('duplicate node')));
  const invalidPort = { ...snapshot.graph, edges: [{ ...snapshot.graph.edges[0]!, source: { nodeId: 'controller', portId: 'absent' } }] };
  assert.ok(validateGraph(invalidPort).some((issue) => issue.message.includes('unknown source port')));
  const cycle = { ...snapshot.graph, nodes: snapshot.graph.nodes.map((node) => node.id === 'runtime' ? { ...node, parentId: 'controller' } : node) };
  assert.ok(validateGraph(cycle).some((issue) => issue.message.includes('cycle')));
});

test('graph patches validate revisions and preserve the previous snapshot', () => {
  const snapshot = stage();
  const serialized = JSON.stringify(snapshot);
  const graph = applyGraphPatch(snapshot.graph, { baseRevision: 'one', nextRevision: 'two', operations: [{ kind: 'reparentNode', id: 'controller', parentId: 'architecture' }] });
  assert.equal(graph.revision, 'two');
  assert.equal(graph.nodes.find((node) => node.id === 'controller')?.parentId, 'architecture');
  assert.equal(JSON.stringify(snapshot), serialized);
  assert.throws(() => applyGraphPatch(snapshot.graph, { baseRevision: 'wrong', nextRevision: 'two', operations: [] }), /revision mismatch/);
});

test('projection folds into the nearest visible ancestor while retaining canonical endpoint identity', () => {
  const snapshot = stage();
  const folded = projectGraph(snapshot, []);
  assert.deepEqual(folded.nodes.map((node) => node.id), ['runtime', 'worker']);
  assert.equal(folded.edges[0]?.source.nodeId, 'runtime');
  assert.equal(folded.edges[0]?.source.canonicalNodeId, 'controller');
  assert.equal(folded.edges[0]?.source.canonicalPortId, 'send');
  assert.match(folded.edges[0]?.source.portId ?? '', /^boundary:/);
  const expanded = projectGraph(snapshot, ['runtime']);
  assert.equal(expanded.edges[0]?.source.nodeId, 'controller');
  assert.equal(expanded.edges[0]?.source.portId, 'send');
  assert.equal(expanded.edges[0]?.canonicalEdgeId, 'dispatch');
});

test('projection parentage and depth are independent of input ordering or slashes in IDs', () => {
  const snapshot = stage();
  const graph = {
    ...snapshot.graph,
    nodes: [...snapshot.graph.nodes].reverse().map((node) => node.id === 'controller' ? { ...node, id: 'controller/primary' } : node),
    edges: snapshot.graph.edges.map((edge) => ({ ...edge, source: { ...edge.source, nodeId: 'controller/primary' } })),
  };
  const projection = projectGraph({ ...snapshot, graph }, ['runtime']);
  const controller = projection.nodeById.get('controller/primary');
  assert.equal(controller?.parentId, 'runtime');
  assert.equal(controller?.depth, 2);
  assert.equal(projection.edges[0]?.source.nodeId, 'controller/primary');
});
