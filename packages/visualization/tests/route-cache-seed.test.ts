import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../src/core/projection/index.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import type { CanvasNode } from '../src/react/model/grouping.ts';
import { DiagramRouteCache, type CachedRoute } from '../src/react/model/route-cache.ts';

const card = (id: string, x: number, y: number, width = 240, height = 80): CanvasNode => ({ id, type: 'card', position: { x, y }, width, height, data: { title: id } });
const nodes = [card('a', 0, 0), card('b', 600, 0), card('c', 0, 400), card('d', 600, 400)];
const inputs = [
  { id: 'a-b', source: 'a', target: 'b', text: 'a to b' },
  { id: 'c-d', source: 'c', target: 'd', text: 'c to d' },
];
const stage: StageSnapshot = {
  id: 'seed', label: 'seed', title: 'seed', track: 'main', order: 0,
  graph: {
    rootId: 'root',
    nodes: [
      { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
      ...nodes.map((node, index) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, order: index + 1, ports: [] })),
    ],
    edges: inputs.map((edge, index) => ({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, label: edge.text, relation: 'call' as const, direction: 'directed' as const, order: index })),
  },
};
const projection = projectGraph(stage, new Set());

test('a seed replaces the legacy cache routes once and keeps their object identity afterwards', () => {
  const cache = new DiagramRouteCache();
  const first = cache.update(nodes, projection, inputs);
  const seededA: CachedRoute = { ...first.get('a-b')!, points: [{ x: 10, y: 20 }, { x: 10, y: 100 }, { x: 300, y: 100 }], label: { x: 100, y: 100, width: 60, height: 24 }, text: 'a to b' };
  const seededB: CachedRoute = { ...first.get('c-d')!, points: [{ x: 20, y: 400 }, { x: 20, y: 480 }, { x: 300, y: 480 }], label: { x: 100, y: 480, width: 60, height: 24 }, text: 'c to d' };
  const seed = new Map([['a-b', seededA], ['c-d', seededB]]);
  const next = cache.update(nodes, projection, inputs, [], new Map(), {}, seed);
  assert.equal(next.get('a-b'), seededA);
  assert.equal(next.get('c-d'), seededB);
  const retained = cache.update(nodes, projection, inputs);
  assert.equal(retained.get('a-b'), seededA);
  assert.equal(retained.get('c-d'), seededB);
  const moved = nodes.map((node) => node.id === 'a' ? { ...node, position: { x: 20, y: 0 } } : node);
  const after = cache.update(moved, projection, inputs);
  assert.notEqual(after.get('a-b'), seededA);
  assert.equal(after.get('c-d'), seededB);
});
