import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoute, type RouteObstacle } from '../src/core/layout/legality.ts';

const card = (id: string, x: number, y: number, w = 100, h = 60): RouteObstacle => ({
  id,
  bounds: { x, y, w, h },
  padded: { x: x - 10, y: y - 10, w: w + 20, h: h + 20 },
  card: true,
});

const route = (points: { x: number; y: number }[], obstacles: RouteObstacle[] = []) => ({
  points,
  sourceId: 's',
  targetId: 't',
  obstacles,
  requireOrthogonal: false,
});

test('a clear horizontal path has no legality issue', () => {
  assert.deepEqual(validateRoute(route([{ x: 0, y: 30 }, { x: 200, y: 30 }])), []);
});

test('cards block through traffic while their own endpoints use the frame bounds', () => {
  const obstacles = [card('blocker', 50, 0)];
  assert.equal(validateRoute(route([{ x: 0, y: 30 }, { x: 200, y: 30 }], obstacles))[0]?.kind, 'collision');
  const endpoint = [card('s', 0, 0)];
  assert.deepEqual(validateRoute({ ...route([{ x: 100, y: 30 }, { x: 250, y: 30 }], endpoint), sourceId: 's' }), []);
});

test('protected paths block unless they belong to the ignored edge', () => {
  const reserved = [{ edgeId: 'locked', rect: { x: 50, y: 20, w: 20, h: 20 } }];
  const input = { ...route([{ x: 0, y: 30 }, { x: 200, y: 30 }]), reserved };
  assert.equal(validateRoute(input)[0]?.kind, 'protected');
  assert.deepEqual(validateRoute({ ...input, ignoreEdgeId: 'locked' }), []);
});

test('attachment requires outward departure and arrival', () => {
  const outward = { ...route([{ x: 0, y: 30 }, { x: 200, y: 30 }]), sourceSide: 'right' as const, targetSide: 'left' as const, sourceAnchor: { x: 0, y: 30 }, targetAnchor: { x: 200, y: 30 }, requireAttachment: true };
  assert.deepEqual(validateRoute(outward), []);
  const inward = { ...outward, points: [{ x: 0, y: 30 }, { x: -20, y: 30 }], targetAnchor: { x: -20, y: 30 } };
  assert.equal(validateRoute(inward).some((issue) => issue.kind === 'attachment'), true);
});

test('degenerate and diagonal paths are rejected', () => {
  assert.equal(validateRoute({ points: [{ x: 0, y: 0 }], sourceId: 's', targetId: 't' })[0]?.kind, 'degenerate');
  assert.equal(validateRoute({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], sourceId: 's', targetId: 't' })[0]?.kind, 'orthogonal');
});
