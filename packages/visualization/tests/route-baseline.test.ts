import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../src/core/projection/index.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import type { CanvasNode } from '../src/react/model/grouping.ts';
import { DiagramRouteCache } from '../src/react/model/route-cache.ts';

const columns = 5, rows = 4;
const nodes: CanvasNode[] = [];
const links: { id: string; source: string; target: string }[] = [];
for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
  const id = `n${row}-${column}`;
  nodes.push({ id, type: 'card', position: { x: column * 340, y: row * 180 }, width: 260, height: 82, data: { title: id } });
  if (column + 1 < columns) links.push({ id: `${id}-right`, source: id, target: `n${row}-${column + 1}` });
  if (row + 1 < rows) links.push({ id: `${id}-down`, source: id, target: `n${row + 1}-${column}` });
}
const stage: StageSnapshot = {
  id: 'profile', label: 'profile', title: 'profile', track: 'main', order: 0,
  graph: {
    rootId: 'root',
    nodes: [
      { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
      ...nodes.map((node, index) => ({ id: node.id, parentId: 'root', kind: 'component' as const, label: node.id, order: index + 1, ports: [] })),
    ],
    edges: links.map((link, index) => ({
      id: link.id, source: { nodeId: link.source }, target: { nodeId: link.target },
      label: '关系', relation: 'call' as const, direction: 'directed' as const, order: index,
    })),
  },
};
const projection = projectGraph(stage, new Set());
const inputs = links.map((link) => ({ id: link.id, source: link.source, target: link.target, text: '关系' }));

test('baseline routing profile is bounded and fully accounted for', () => {
  const cache = new DiagramRouteCache();
  const started = performance.now();
  const routes = cache.update(nodes, projection, inputs, [], new Map(), { direction: 'auto' });
  const wall = performance.now() - started;
  const stats = cache.lastStats;
  console.log(`[route-baseline] nodes=${nodes.length} edges=${inputs.length} geometry=${stats.geometryMs.toFixed(2)}ms routing=${stats.routingMs.toFixed(2)}ms labels=${stats.labelMs.toFixed(2)}ms total=${wall.toFixed(2)}ms routed=${stats.routedEdges}`);
  assert.equal(routes.size, inputs.length);
  assert.equal(stats.totalEdges, inputs.length);
  assert.ok(stats.geometryMs >= 0 && stats.routingMs >= 0 && stats.labelMs >= 0);
  assert.ok(wall < 5000, `baseline routing took ${wall.toFixed(2)}ms`);
});
