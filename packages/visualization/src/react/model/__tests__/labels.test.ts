import test from 'node:test';
import assert from 'node:assert/strict';
import { placeEdgeLabel, type EdgeLabelPlacement } from '../labels.ts';
import type { Rect } from '../../../core/layout/geometry.ts';

const bounds = (label: EdgeLabelPlacement): Rect => ({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const padded = (rect: Rect): Rect => ({ x: rect.x - 8, y: rect.y - 8, w: rect.w + 16, h: rect.h + 16 });

test('a label near a crossed container border moves fully inside or outside with clearance', () => {
  const frame = { x: 100, y: 0, w: 300, h: 200 };
  const label = placeEdgeLabel([{ x: 20, y: 100 }, { x: 180, y: 100 }], '消息', [], [frame]);
  const rect = bounds(label);
  assert.ok(rect.x >= frame.x + 8 || rect.x + rect.w <= frame.x - 8);
  assert.equal(label.y, 100);
  assert.equal(label.height, 24);
});

test('a short horizontal crossing uses the free subsegment beside the border instead of moving off the line', () => {
  const frame = { x: 70, y: 0, w: 300, h: 200 };
  const blocker = { x: -80, y: 60, w: 80, h: 80 };
  const label = placeEdgeLabel([{ x: 0, y: 100 }, { x: 132, y: 100 }], '历史', [blocker], [frame]);
  assert.equal(label.y, 100);
  assert.equal(label.x, 40);
  assert.ok(!overlaps(bounds(label), padded(blocker)));
  assert.ok(bounds(label).x + label.width <= frame.x - 8);
});

test('a short gap does not squeeze a label between a card and its target arrow', () => {
  const blockers = [{ x: -80, y: -60, w: 160, h: 60 }, { x: -80, y: 38, w: 160, h: 60 }];
  const label = placeEdgeLabel([{ x: 0, y: 0 }, { x: 0, y: 38 }], '整理', blockers, []);
  const rect = bounds(label);
  assert.ok(blockers.every((blocker) => !overlaps(rect, padded(blocker))));
  assert.ok(!overlaps(rect, padded({ x: -8, y: 30, w: 16, h: 16 })));
});

test('a label uses an available longer straight segment instead of a short elbow', () => {
  const points = [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 240, y: 30 }, { x: 240, y: 50 }];
  const label = placeEdgeLabel(points, '上下文', [], []);
  assert.equal(label.y, 30);
  assert.ok(label.x - label.width / 2 >= 12);
  assert.ok(label.x + label.width / 2 <= 228);
});

test('a short middle segment uses a neighboring long segment before any sideways placement', () => {
  const points = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 38, y: 100 }, { x: 38, y: 200 }];
  const blockers = [{ x: -80, y: -82, w: 160, h: 82 }, { x: -42, y: 200, w: 160, h: 82 }];
  const label = placeEdgeLabel(points, '承载', blockers, []);
  assert.equal(label.x, 0);
  assert.equal(label.y, 76);
  assert.ok(blockers.every((blocker) => !overlaps(bounds(label), padded(blocker))));
});

test('when inline placement is blocked a horizontal label stays four pixels beside its line', () => {
  const blocker = { x: -100, y: 4, w: 500, h: 100 };
  const label = placeEdgeLabel([{ x: 0, y: 0 }, { x: 300, y: 0 }], '派发', [blocker], []);
  assert.equal(label.y, -16);
  assert.equal(bounds(label).y + label.height, -4);
  assert.ok(!overlaps(bounds(label), padded(blocker)));
});

test('vertical side placement measures a four-pixel gap from the capsule edge', () => {
  const blocker = { x: 4, y: -100, w: 100, h: 500 };
  const label = placeEdgeLabel([{ x: 0, y: 0 }, { x: 0, y: 300 }], '上下文', [blocker], []);
  assert.equal(label.x, -label.width / 2 - 4);
  assert.equal(bounds(label).x + label.width, -4);
  assert.ok(!overlaps(bounds(label), padded(blocker)));
});

test('sequential labels reserve their full capsule and clearance on a shared path', () => {
  const points = [{ x: 0, y: 100 }, { x: 400, y: 100 }];
  const first = placeEdgeLabel(points, '派发', [], []);
  const second = placeEdgeLabel(points, '发布', [], [], [bounds(first)]);
  assert.ok(!overlaps(bounds(second), padded(bounds(first))));
  assert.deepEqual(second, placeEdgeLabel(points, '发布', [], [], [bounds(first)]));
});

test('nested frame borders and headers remain clear for a cross-layer label', () => {
  const frames = [{ x: 20, y: 0, w: 600, h: 400 }, { x: 220, y: 100, w: 300, h: 240 }];
  const blockers = [{ x: 20, y: 0, w: 600, h: 60 }, { x: 220, y: 100, w: 300, h: 60 }, { x: 244, y: 180, w: 240, h: 82 }];
  const label = placeEdgeLabel([{ x: -80, y: 180 }, { x: 160, y: 180 }, { x: 160, y: 300 }, { x: 244, y: 300 }], '回报', blockers, frames);
  const rect = bounds(label);
  assert.ok(blockers.every((blocker) => !overlaps(rect, padded(blocker))));
  for (const frame of frames) {
    const fullyInside = rect.x >= frame.x + 8 && rect.y >= frame.y + 8 && rect.x + rect.w <= frame.x + frame.w - 8 && rect.y + rect.h <= frame.y + frame.h - 8;
    assert.ok(fullyInside || !overlaps(rect, padded(frame)));
  }
});

test('a fully obstructed route uses the nearest free boundary rather than a distant right-hand fallback', () => {
  const region = { x: -1000, y: -1000, w: 2000, h: 2000 };
  const label = placeEdgeLabel([{ x: 0, y: 0 }, { x: 10, y: 0 }], '上下文', [region], [region]);
  assert.ok(!overlaps(bounds(label), padded(region)));
  assert.equal(label.x, 5);
  assert.equal(label.y, -1020);
});
