import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainNodeMoves } from '../constraints.ts';
import { CARD_SIZE, type CanvasNode } from '../grouping.ts';
import { MIN_EDGE_GAP } from '../spacing.ts';

const card = (id: string, x: number, y: number): CanvasNode => ({ id, type: 'card', position: { x, y }, ...CARD_SIZE, data: { title: id } });
const move = (nodes: CanvasNode[], id: string, x: number, y: number, zoom = 1, links: { source: string; target: string }[] = []) => constrainNodeMoves(nodes, nodes.map((node) => node.id === id ? { ...node, position: { x, y } } : node), [id], zoom, new Set(nodes.map((node) => node.id)), links);

test('alignment snaps only within six screen pixels and releases beyond the threshold', () => {
  const nodes = [card('a', 0, 0), card('b', 400, 200)];
  const near = move(nodes, 'a', 0, 195);
  assert.equal(near.nodes[0]!.position.y, 200);
  assert.ok(near.guides.some((guide) => guide.axis === 'y'));
  const far = move(nodes, 'a', 0, 192);
  assert.equal(far.nodes[0]!.position.y, 192);
  assert.ok(!far.guides.some((guide) => guide.axis === 'y'));
  assert.equal(move(nodes, 'a', 0, 192, 0.5).nodes[0]!.position.y, 200);
  assert.equal(move(nodes, 'a', 0, 195, 2).nodes[0]!.position.y, 195);
});

test('connected cards retain enough vertical clearance for a capsule and arrow', () => {
  const nodes = [card('a', 0, 0), card('b', 0, CARD_SIZE.height + MIN_EDGE_GAP)];
  const result = move(nodes, 'a', 0, 45, 1, [{ source: 'a', target: 'b' }]);
  assert.equal(result.nodes[0]!.position.y, 0);
  assert.ok(nodes[1]!.position.y - result.nodes[0]!.position.y - CARD_SIZE.height >= MIN_EDGE_GAP);
});

test('dragging cannot overlap an unconnected sibling or escape its parent content area', () => {
  const frame: CanvasNode = { id: 'frame', type: 'structure', position: { x: 100, y: 100 }, width: 700, height: 400, data: { title: 'frame' } };
  const nodes = [frame, { ...card('a', 24, 72), parentId: 'frame' }, { ...card('b', 360, 72), parentId: 'frame' }];
  const result = move(nodes, 'a', 340, 72);
  const a = result.nodes.find((node) => node.id === 'a')!;
  assert.ok(a.position.x + a.width! + 20 <= 360);
  const boundary = move(nodes, 'a', -200, -100).nodes.find((node) => node.id === 'a')!;
  assert.equal(boundary.position.x, 24);
  assert.equal(boundary.position.y, 72);
});

test('cross-layer cards align in world coordinates without changing their ownership', () => {
  const parent: CanvasNode = { id: 'frame', type: 'structure', position: { x: 600, y: 100 }, width: 400, height: 350, data: { title: 'frame' } };
  const nodes = [card('outside', 0, 200), parent, { ...card('inside', 24, 100), parentId: 'frame' }];
  const result = move(nodes, 'outside', 0, 196);
  assert.equal(result.nodes[0]!.position.y, 200);
  assert.equal(result.nodes[2]!.parentId, 'frame');
});

test('a blocked multi-node drag preserves the relative layout of the whole selection', () => {
  const nodes = [card('a', 0, 0), card('b', 0, 220), card('obstacle', 400, 0)];
  const proposed = nodes.map((node) => node.id !== 'obstacle' ? { ...node, position: { x: node.position.x + 200, y: node.position.y } } : node);
  const result = constrainNodeMoves(nodes, proposed, ['a', 'b'], 1, new Set(nodes.map((node) => node.id)), []);
  assert.deepEqual(result.nodes[0]!.position, nodes[0]!.position);
  assert.deepEqual(result.nodes[1]!.position, nodes[1]!.position);
});
