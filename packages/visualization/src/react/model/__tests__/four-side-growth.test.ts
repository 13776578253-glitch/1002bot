import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainNodeMoves } from '../constraints.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from '../grouping.ts';
import { containerInset, MAX_CONTAINER_EXTRA, MAX_CONTAINER_RATIO } from '../spacing.ts';

const card = (id: string, x: number, y: number, parentId: string): CanvasNode => ({
  id, type: 'card', parentId, position: { x, y }, ...CARD_SIZE, data: { title: id },
});
const frame = (id: string, type: 'structure' | 'cluster', x: number, y: number, width: number, height: number, parentId?: string): CanvasNode => ({
  id, type, position: { x, y }, width, height, ...(parentId ? { parentId } : {}),
  data: { title: id, contentWidth: width, contentHeight: height },
});
const find = (nodes: readonly CanvasNode[], id: string) => nodes.find((node) => node.id === id)!;
const world = (nodes: readonly CanvasNode[], id: string) => worldPosition(find(nodes, id), nodes);
const worldToLocal = (nodes: readonly CanvasNode[], id: string, target: { x: number; y: number }) => {
  const node = find(nodes, id);
  const origin = node.parentId ? world(nodes, node.parentId) : { x: 0, y: 0 };
  return { x: target.x - origin.x, y: target.y - origin.y };
};
const moveWorld = (nodes: CanvasNode[], targets: Record<string, { x: number; y: number }>, zoom = 1) => {
  const proposed = nodes.map((node) => targets[node.id] ? { ...node, position: worldToLocal(nodes, node.id, targets[node.id]!) } : node);
  return constrainNodeMoves(nodes, proposed, Object.keys(targets), zoom, new Set(nodes.map((node) => node.id)), []).nodes;
};
const fixture = (): CanvasNode[] => [
  frame('outer', 'structure', 100, 100, 600, 358),
  card('a', 24, 72, 'outer'),
  card('b', 336, 254, 'outer'),
];
const maximum = (base: number) => base + Math.min(base * MAX_CONTAINER_RATIO, MAX_CONTAINER_EXTRA);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
const sameWorld = (nodes: readonly CanvasNode[], id: string, expected: { x: number; y: number }) => {
  const actual = world(nodes, id);
  close(actual.x, expected.x);
  close(actual.y, expected.y);
};
function enclosed(nodes: readonly CanvasNode[], childId: string) {
  const child = find(nodes, childId), parent = find(nodes, child.parentId!);
  const inset = containerInset(parent);
  assert.ok(child.position.x >= inset.x - 0.001, `${childId} crosses left padding`);
  assert.ok(child.position.y >= inset.top - 0.001, `${childId} crosses header`);
  assert.ok(child.position.x + child.width! + inset.x <= parent.width! + 0.001, `${childId} crosses right padding`);
  assert.ok(child.position.y + child.height! + inset.bottom <= parent.height! + 0.001, `${childId} crosses bottom padding`);
}
function bounded(nodes: readonly CanvasNode[], original: readonly CanvasNode[], id: string) {
  const current = find(nodes, id), baseline = find(original, id);
  assert.ok(current.width! <= maximum(baseline.data.contentWidth!) + 0.001, `${id} exceeds width budget`);
  assert.ok(current.height! <= maximum(baseline.data.contentHeight!) + 0.001, `${id} exceeds height budget`);
}

test('dragging beyond the left and top edges moves the card into negative world space', () => {
  for (const axis of ['x', 'y'] as const) {
    const original = fixture(), start = world(original, 'a'), sibling = world(original, 'b');
    const nodes = moveWorld(original, { a: { ...start, [axis]: -5000 } });
    assert.ok(world(nodes, 'a')[axis] < 0, `${axis} movement was clamped at the old content edge`);
    assert.ok(world(nodes, 'outer')[axis] < world(original, 'outer')[axis]);
    sameWorld(nodes, 'b', sibling);
    enclosed(nodes, 'a');
    enclosed(nodes, 'b');
    bounded(nodes, original, 'outer');
  }
});

test('opposite edges share one fixed width or height budget', () => {
  for (const axis of ['x', 'y'] as const) {
    const original = fixture(), aStart = world(original, 'a'), bStart = world(original, 'b');
    let nodes = moveWorld(original, { a: { ...aStart, [axis]: -5000 } });
    const movedA = world(nodes, 'a');
    nodes = moveWorld(nodes, { b: { ...bStart, [axis]: 5000 } });
    sameWorld(nodes, 'a', movedA);
    enclosed(nodes, 'a');
    enclosed(nodes, 'b');
    bounded(nodes, original, 'outer');
  }
});

test('right and bottom growth reach the fixed limit and shrink after the card returns', () => {
  for (const axis of ['x', 'y'] as const) {
    const original = fixture(), start = world(original, 'a'), sibling = world(original, 'b');
    let nodes = moveWorld(original, { a: { ...start, [axis]: 5000 } });
    assert.ok(world(nodes, 'a')[axis] > start[axis]);
    const size = axis === 'x' ? 'width' : 'height';
    close(find(nodes, 'outer')[size]!, maximum(find(original, 'outer')[size]!));
    sameWorld(nodes, 'b', sibling);
    enclosed(nodes, 'a');
    bounded(nodes, original, 'outer');
    nodes = moveWorld(nodes, { a: start });
    sameWorld(nodes, 'outer', world(original, 'outer'));
    close(find(nodes, 'outer').width!, find(original, 'outer').width!);
    close(find(nodes, 'outer').height!, find(original, 'outer').height!);
  }
});

test('repeated outward drags do not increase the ceiling and returning restores the natural origin and size', () => {
  for (const axis of ['x', 'y'] as const) {
    const original = fixture(), start = world(original, 'a'), sibling = world(original, 'b');
    let nodes = original;
    for (let index = 0; index < 12; index++) {
      const current = world(nodes, 'a');
      nodes = moveWorld(nodes, { a: { ...current, [axis]: current[axis] - 1000 } });
      bounded(nodes, original, 'outer');
      sameWorld(nodes, 'b', sibling);
    }
    assert.ok(world(nodes, 'a')[axis] < start[axis]);
    nodes = moveWorld(nodes, { a: start });
    sameWorld(nodes, 'a', start);
    sameWorld(nodes, 'b', sibling);
    sameWorld(nodes, 'outer', world(original, 'outer'));
    close(find(nodes, 'outer').width!, find(original, 'outer').width!);
    close(find(nodes, 'outer').height!, find(original, 'outer').height!);
  }
});

test('nested structure and manual containers refit without shifting untouched siblings', () => {
  const original: CanvasNode[] = [
    frame('outer', 'structure', 100, 100, 1164, 704),
    frame('manual', 'cluster', 24, 72, 600, 346, 'outer'),
    card('a', 24, 60, 'manual'),
    card('b', 336, 242, 'manual'),
    card('outside', 900, 600, 'outer'),
  ];
  let nodes = moveWorld(original, { a: { x: -2000, y: -2000 } });
  assert.ok(world(nodes, 'a').x < 0);
  assert.ok(world(nodes, 'a').y < 0);
  for (const id of ['b', 'outside']) sameWorld(nodes, id, world(original, id));
  for (const id of ['a', 'b', 'manual', 'outside']) enclosed(nodes, id);
  for (const id of ['manual', 'outer']) bounded(nodes, original, id);
  nodes = moveWorld(nodes, { a: world(original, 'a') });
  for (const id of ['a', 'b', 'outside', 'manual', 'outer']) sameWorld(nodes, id, world(original, id));
  for (const id of ['manual', 'outer']) {
    close(find(nodes, id).width!, find(original, id).width!);
    close(find(nodes, id).height!, find(original, id).height!);
  }
});

test('world-space expansion limits are independent of viewport zoom', () => {
  const original = fixture(), start = world(original, 'a');
  const near = moveWorld(original, { a: { ...start, x: -5000, y: -5000 } }, 0.5);
  const far = moveWorld(original, { a: { ...start, x: -5000, y: -5000 } }, 2);
  assert.ok(world(near, 'a').x < 0 && world(near, 'a').y < 0);
  for (const id of ['outer', 'a', 'b']) sameWorld(near, id, world(far, id));
  close(find(near, 'outer').width!, find(far, 'outer').width!);
  close(find(near, 'outer').height!, find(far, 'outer').height!);
  bounded(near, original, 'outer');
});

test('multi-selection growth retains relative world positions after parent-origin compensation', () => {
  const original: CanvasNode[] = [
    frame('outer', 'structure', 100, 100, 288, 360),
    card('a', 24, 72, 'outer'),
    card('b', 24, 254, 'outer'),
  ];
  const first = world(original, 'a'), second = world(original, 'b');
  const nodes = moveWorld(original, {
    a: { x: first.x - 1000, y: first.y - 1000 },
    b: { x: second.x - 1000, y: second.y - 1000 },
  });
  const a = world(nodes, 'a'), b = world(nodes, 'b');
  assert.ok(a.x < first.x && a.y < first.y);
  close(b.x - a.x, second.x - first.x);
  close(b.y - a.y, second.y - first.y);
  enclosed(nodes, 'a');
  enclosed(nodes, 'b');
  bounded(nodes, original, 'outer');
});
