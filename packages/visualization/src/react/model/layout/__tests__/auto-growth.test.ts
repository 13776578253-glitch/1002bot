import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainNodeMoves } from '../constraints.ts';
import { CARD_SIZE, type CanvasNode } from '../node.ts';
import { containerSizeLimits, MAX_CONTAINER_RATIO } from '../spacing.ts';

const frame = (id: string, width: number, height: number, parentId?: string): CanvasNode => ({ id, type: 'structure', position: { x: 24, y: 72 }, width, height, data: { title: id, contentWidth: width, contentHeight: height }, ...(parentId ? { parentId } : {}) });
const card = (parentId: string): CanvasNode => ({ id: 'child', type: 'card', parentId, position: { x: 24, y: 72 }, ...CARD_SIZE, data: { title: 'child' } });
const move = (nodes: CanvasNode[], x: number, y: number) => constrainNodeMoves(nodes, nodes.map((node) => node.id === 'child' ? { ...node, position: { x, y } } : node), ['child'], 1, new Set(nodes.map((node) => node.id)), []).nodes;

test('dragging an internal card grows the container and shares a fixed ceiling across repeated moves', () => {
  let nodes = [frame('parent', 400, 240), card('parent')];
  nodes = move(nodes, 200, 72);
  assert.equal(nodes[0]!.width, 464);
  const ceiling = 400 * (1 + MAX_CONTAINER_RATIO);
  for (let i = 0; i < 30; i++) nodes = move(nodes, nodes[1]!.position.x + 100, 72);
  assert.ok(Math.abs(nodes[0]!.width! - ceiling) < 0.01);
  assert.ok(Math.abs(nodes[1]!.position.x + CARD_SIZE.width + 24 - ceiling) < 0.01);
  assert.equal(nodes[0]!.data.contentWidth, 400);
});

test('nested internal dragging propagates limited growth through the parent chain', () => {
  let nodes = [frame('outer', 448, 300), frame('inner', 400, 200, 'outer'), card('inner')];
  nodes = move(nodes, 230, 100);
  assert.equal(nodes[1]!.width, 494);
  assert.equal(nodes[0]!.width, 542);
  assert.equal(nodes[2]!.parentId, 'inner');
  for (let i = 0; i < 5; i++) nodes = move(nodes, 1000, 1000);
  for (const node of nodes.filter((item) => item.type === 'structure')) {
    const limits = containerSizeLimits(node, nodes);
    assert.ok(node.width! <= limits.maxWidth);
    assert.ok(node.height! <= limits.maxHeight);
  }
});

test('root container growth moves an adjacent outside node beyond the new boundary', () => {
  const sibling: CanvasNode = { id: 'sibling', type: 'card', position: { x: 450, y: 72 }, ...CARD_SIZE, data: { title: 'sibling' } };
  const nodes = move([frame('parent', 400, 240), card('parent'), sibling], 1000, 72);
  assert.ok(Math.abs(nodes[0]!.width! - 400 * (1 + MAX_CONTAINER_RATIO)) < 0.01);
  const neighbor = nodes.find((node) => node.id === sibling.id)!;
  assert.ok(neighbor.position.x >= nodes[0]!.position.x + nodes[0]!.width! + 24 || neighbor.position.x + neighbor.width! + 24 <= nodes[0]!.position.x || neighbor.position.y >= nodes[0]!.position.y + nodes[0]!.height! + 24 || neighbor.position.y + neighbor.height! + 24 <= nodes[0]!.position.y);
});

test('dragging back refits the content bounds and a second outward drag keeps the same ceiling', () => {
  let nodes = [frame('parent', 288, 176), card('parent')];
  const initial = { width: nodes[0]!.width, height: nodes[0]!.height };
  nodes = move(nodes, 10000, 10000);
  const maximum = { width: nodes[0]!.width, height: nodes[0]!.height };
  assert.ok(maximum.width! > initial.width! && maximum.height! > initial.height!);
  for (let i = 0; i < 5; i++) {
    nodes = move(nodes, 24, 72);
    assert.deepEqual({ width: nodes[0]!.width, height: nodes[0]!.height }, initial);
    nodes = move(nodes, 10000, 10000);
    assert.deepEqual({ width: nodes[0]!.width, height: nodes[0]!.height }, maximum);
  }
});

test('manual and structural ancestors both shrink after their deepest card is dragged back', () => {
  const manual: CanvasNode = { ...frame('manual', 288, 164, 'middle'), type: 'cluster' };
  const middle = frame('middle', 336, 260, 'outer');
  const outer = frame('outer', 384, 356);
  let nodes = [outer, middle, manual, { ...card('manual'), position: { x: 24, y: 60 } }];
  const initial = nodes.slice(0, 3).map((node) => ({ width: node.width, height: node.height }));
  nodes = move(nodes, 10000, 10000);
  assert.ok(nodes.slice(0, 3).every((node, i) => node.width! > initial[i]!.width! && node.height! > initial[i]!.height!));
  nodes = move(nodes, 24, 60);
  assert.deepEqual(nodes.slice(0, 3).map((node) => ({ width: node.width, height: node.height })), initial);
  assert.equal(nodes[3]!.parentId, 'manual');
});

test('outside reflow preserves capsule space between cards after pushing a chain of neighbors', () => {
  const outside = (id: string, y: number): CanvasNode => ({ id, type: 'card', position: { x: 24, y }, ...CARD_SIZE, data: { title: id } });
  const nodes = move([frame('parent', 400, 240), card('parent'), outside('first', 340), outside('second', 486)], 24, 10000);
  const first = nodes.find((node) => node.id === 'first')!, second = nodes.find((node) => node.id === 'second')!;
  assert.ok(first.position.y >= nodes[0]!.position.y + nodes[0]!.height! + 24);
  assert.ok(second.position.y >= first.position.y + first.height! + 64);
});

test('dragging back restores automatically displaced siblings so the outer frame can shrink fully', () => {
  const outer = frame('outer', 600, 274);
  const inner = frame('inner', 288, 178, 'outer');
  const sibling: CanvasNode = { id: 'sibling', type: 'card', parentId: 'outer', position: { x: 336, y: 72 }, ...CARD_SIZE, data: { title: 'sibling' } };
  let nodes = [outer, inner, card('inner'), sibling];
  nodes = move(nodes, 150, 72);
  assert.ok(nodes[0]!.width! > outer.width!);
  assert.ok(nodes.find((node) => node.id === 'sibling')!.position.x > sibling.position.x);
  nodes = move(nodes, 24, 72);
  assert.equal(nodes[0]!.width, outer.width);
  assert.deepEqual(nodes.find((node) => node.id === 'sibling')!.position, sibling.position);
  assert.equal(nodes.find((node) => node.id === 'sibling')!.data.reflowOrigin, undefined);
});

test('explicitly moving an automatically displaced card keeps the new user position on later shrink', () => {
  const outer = frame('outer', 600, 274), inner = frame('inner', 288, 178, 'outer');
  const sibling: CanvasNode = { id: 'sibling', type: 'card', parentId: 'outer', position: { x: 336, y: 72 }, ...CARD_SIZE, data: { title: 'sibling' } };
  let nodes = move([outer, inner, card('inner'), sibling], 150, 72);
  nodes = constrainNodeMoves(nodes, nodes.map((node) => node.id === 'sibling' ? { ...node, position: { x: 482, y: 274 } } : node), ['sibling'], 1, new Set(nodes.map((node) => node.id)), []).nodes;
  const placed = nodes.find((node) => node.id === 'sibling')!;
  assert.equal(placed.data.reflowOrigin, undefined);
  const position = { ...placed.position };
  nodes = move(nodes, 24, 72);
  assert.deepEqual(nodes.find((node) => node.id === 'sibling')!.position, position);
});
