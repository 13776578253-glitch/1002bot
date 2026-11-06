import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageSnapshot } from '../../../../core/schema/types.ts';
import { projectGraph } from '../../../../core/projection/index.ts';
import { type CanvasNode } from '../../layout/node.ts';
import { DiagramRouteCache, type RouteInput } from '../route-cache.ts';
import { createDiagramGeometry, pathIsClear } from '../routing.ts';
import { SpatialIndex } from '../../layout/spatial-index.ts';

function card(id: string, x: number, y: number, parentId?: string): CanvasNode {
  return { id, type: 'card', position: { x, y }, width: 120, height: 60, data: { title: id }, ...(parentId ? { parentId } : {}) };
}

function project(nodes: readonly CanvasNode[], edges: readonly RouteInput[]) {
  const stage: StageSnapshot = {
    id: 'stage', label: 'stage', title: 'stage', track: 'main', order: 0,
    graph: {
      rootId: 'root',
      nodes: [{ id: 'root', parentId: null, kind: 'root', label: 'Root', order: 0, ports: [] }, ...nodes.map((node, order) => ({ id: node.id, parentId: node.parentId ?? 'root', kind: 'component' as const, label: node.data.title, order: order + 1, ports: [] }))],
      edges: edges.map((edge, order) => ({ id: edge.id, source: { nodeId: edge.source }, target: { nodeId: edge.target }, relation: 'call' as const, direction: 'directed' as const, label: edge.text, order })),
    },
  };
  return projectGraph(stage, new Set(nodes.filter((node) => node.data.expanded).map((node) => node.id)));
}

const edges: RouteInput[] = [
  { id: 'near', source: 'a', target: 'b', text: '调用' },
  { id: 'far', source: 'c', target: 'd', text: '存档' },
];
const nodes = () => [card('a', 0, 0), card('b', 500, 0), card('c', 0, 800), card('d', 500, 800), card('obstacle', 900, 350)];
const move = (input: readonly CanvasNode[], id: string, x: number, y: number) => input.map((node) => node.id === id ? { ...node, position: { x, y } } : node);

test('spatial index replaces entries and queries segments on cell boundaries', () => {
  const index = new SpatialIndex<string>(100);
  index.set('a', { x: 100, y: 0, w: 0, h: 200 }, 'vertical');
  index.set('b', { x: -150, y: -150, w: 20, h: 20 }, 'negative');
  assert.deepEqual(index.query({ x: 90, y: 95, w: 20, h: 0 }), ['vertical']);
  index.set('a', { x: 500, y: 500, w: 0, h: 100 }, 'moved');
  assert.deepEqual(index.query({ x: 90, y: 95, w: 20, h: 0 }), []);
  assert.deepEqual(index.query({ x: -140, y: -140, w: 0, h: 0 }), ['negative']);
});

test('selection and callback changes retain every cached route and perform no path or label work', () => {
  const input = nodes(), projection = project(input, edges), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, edges);
  const after = cache.update(input.map((node) => ({ ...node, selected: true, data: { ...node.data, onToggle: () => {} } })), projection, edges);
  assert.equal(after, before);
  assert.equal(cache.lastStats.routedEdges, 0);
});

test('moving one endpoint recomputes its edge while retaining an unrelated path and label', () => {
  const input = nodes(), projection = project(input, edges), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, edges);
  const moved = move(input, 'c', 0, 880);
  const after = cache.update(moved, projection, edges);
  assert.equal(after.get('near'), before.get('near'));
  assert.notEqual(after.get('far'), before.get('far'));
  assert.equal(cache.lastStats.routedEdges, 1);
  assert.ok(pathIsClear(after.get('far')!.points, createDiagramGeometry(moved, projection), 'c', 'd'));
});

test('changing a locked path invalidates only intersected cached paths', () => {
  const input = nodes(), projection = project(input, edges), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, edges);
  const obstacle = [{ edgeId: 'locked', points: [{ x: 300, y: -100 }, { x: 300, y: 100 }] }];
  const after = cache.update(input, projection, edges, obstacle);
  assert.equal(after.get('far'), before.get('far'));
  assert.equal(cache.lastStats.routedEdges, 1);
  assert.ok(pathIsClear(after.get('near')!.points, createDiagramGeometry(input, projection, obstacle), 'a', 'b'));
  const far = after.get('far');
  cache.update(input, projection, edges, [{ edgeId: 'locked', points: [{ x: 320, y: -100 }, { x: 320, y: 100 }] }]);
  assert.equal(cache.lastStats.totalEdges, 2);
  assert.equal(cache.update(input, projection, edges, [{ edgeId: 'locked', points: [{ x: 320, y: -100 }, { x: 320, y: 100 }] }]).get('far'), far);
});

test('an edge excludes its own reservation when recalculating', () => {
  const input = nodes(), projection = project(input, edges), first = new DiagramRouteCache().update(input, projection, edges);
  const own = first.get('near')!;
  const cache = new DiagramRouteCache();
  const result = cache.update(input, projection, edges, [{ edgeId: 'near', points: own.points }]);
  assert.deepEqual(result.get('near')!.points, own.points);
});

test('repeated endpoint moves recompute paths without placing labels', () => {
  let input = nodes();
  const projection = project(input, edges), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, edges);
  const originalPath = structuredClone(before.get('near')!.points);
  for (let step = 1; step <= 25; step++) {
    input = move(input, 'a', step * 4, 0);
    const after = cache.update(input, projection, edges);
    assert.equal(cache.lastStats.routedEdges, 1);
    assert.ok(pathIsClear(after.get('near')!.points, createDiagramGeometry(input, projection), 'a', 'b'));
  }
  assert.deepEqual(before.get('near')!.points, originalPath);
});

test('an unconnected obstacle crossing a cached path invalidates only the obstructed edge', () => {
  const input = nodes(), projection = project(input, edges), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, edges);
  const moved = move(input, 'obstacle', 280, 0), geometry = createDiagramGeometry(moved, projection);
  assert.equal(pathIsClear(before.get('near')!.points, geometry, 'a', 'b'), false);
  const after = cache.update(moved, projection, edges);
  assert.equal(after.get('far'), before.get('far'));
  assert.equal(cache.lastStats.routedEdges, 1);
  assert.ok(pathIsClear(after.get('near')!.points, geometry, 'a', 'b'));
});

test('local obstacle collection expands when a detour reaches an obstacle outside the initial corridor', () => {
  const input = [card('a', 0, 0), card('b', 500, 0),
    { ...card('barrier', 200, -100), height: 260 }, card('outside', 340, -155)];
  const links = [edges[0]!], projection = project(input, links), cache = new DiagramRouteCache();
  const routes = cache.update(input, projection, links);
  assert.ok(pathIsClear(routes.get('near')!.points, createDiagramGeometry(input, projection), 'a', 'b'));
  assert.equal(cache.lastStats.routedEdges, 1);
});

test('moving an obstacle away from both paths leaves routing untouched', () => {
  const input = nodes(), projection = project(input, edges), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, edges), first = before.get('near')!;
  const moved = move(input, 'obstacle', 260, 45);
  const after = cache.update(moved, projection, edges);
  assert.equal(after.get('near')!.points, first.points);
  assert.equal(after.get('far'), before.get('far'));
  assert.equal(cache.lastStats.routedEdges, 0);
  assert.ok(pathIsClear(after.get('near')!.points, createDiagramGeometry(moved, projection), 'a', 'b'));
});

test('moving a parent translates its internal cached path and keeps child local coordinates intact', () => {
  const group: CanvasNode = { id: 'g', type: 'structure', position: { x: 0, y: 0 }, width: 600, height: 300, data: { title: 'Group', expanded: true, expandable: true } };
  const input = [group, card('a', 24, 72, 'g'), card('b', 380, 72, 'g'), card('c', 0, 800), card('d', 500, 800)];
  const projection = project(input, edges), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, edges);
  const moved = move(input, 'g', 80, 120);
  const after = cache.update(moved, projection, edges);
  assert.equal(cache.lastStats.routedEdges, 0);
  assert.equal(cache.lastStats.translatedEdges, 1);
  assert.deepEqual(after.get('near')!.points, before.get('near')!.points.map((point) => ({ x: point.x + 80, y: point.y + 120 })));
  assert.equal(after.get('far'), before.get('far'));
  assert.deepEqual(moved[1]!.position, input[1]!.position);
  assert.ok(pathIsClear(after.get('near')!.points, createDiagramGeometry(moved, projection), 'a', 'b'));
});

test('changed text keeps paths and handles without invoking routing or label placement', () => {
  const input = [card('a', 0, 0), card('b', 500, 0)];
  const links = [edges[0]!, { ...edges[0]!, id: 'parallel', text: '另一调用' }];
  const projection = project(input, links), cache = new DiagramRouteCache();
  const before = cache.update(input, projection, links), saved = structuredClone(before.get('near'));
  const after = cache.update(input, projection, [{ ...links[0]!, text: '更长的新增调用' }, links[1]!]);
  assert.equal(cache.lastStats.routedEdges, 0);
  assert.equal(after.get('parallel'), before.get('parallel'));
  assert.deepEqual(before.get('near'), saved);
  assert.equal(after.get('near')!.points, before.get('near')!.points);
  assert.equal(after.get('near')!.sourceHandle, before.get('near')!.sourceHandle);
  assert.equal(after.get('near')!.text, '更长的新增调用');
});
