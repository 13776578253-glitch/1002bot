import test from 'node:test';
import assert from 'node:assert/strict';
import { clipAlignmentGuides } from '../guides.ts';
import type { AlignmentGuide } from '../constraints.ts';

test('horizontal and vertical guides stop before padded card bounds', () => {
  const guides: AlignmentGuide[] = [
    { axis: 'y', value: 50, start: 0, end: 300 },
    { axis: 'x', value: 120, start: 0, end: 200 },
  ];
  assert.deepEqual(clipAlignmentGuides(guides, [{ x: 100, y: 30, w: 60, h: 40 }]), [
    { axis: 'y', value: 50, start: 0, end: 92 },
    { axis: 'y', value: 50, start: 168, end: 300 },
    { axis: 'x', value: 120, start: 0, end: 22 },
    { axis: 'x', value: 120, start: 78, end: 200 },
  ]);
});

test('overlapping blockers form a single hidden interval and tiny fragments are removed', () => {
  const guide: AlignmentGuide = { axis: 'y', value: 50, start: 0, end: 300 };
  const result = clipAlignmentGuides([guide], [
    { x: 80, y: 40, w: 50, h: 20 },
    { x: 100, y: 35, w: 100, h: 30 },
    { x: 212, y: 40, w: 30, h: 20 },
  ], 5);
  assert.deepEqual(result, [
    { ...guide, end: 75 },
    { ...guide, start: 247 },
  ]);
});

test('nonintersecting guides retain their original span', () => {
  const guide: AlignmentGuide = { axis: 'x', value: 50, start: -20, end: 300 };
  assert.deepEqual(clipAlignmentGuides([guide], [
    { x: 70, y: 40, w: 40, h: 30 },
    { x: 40, y: 350, w: 30, h: 30 },
  ]), [guide]);
  assert.deepEqual(clipAlignmentGuides([guide], []), [guide]);
});

test('fully obscured guides produce no segments', () => {
  assert.deepEqual(clipAlignmentGuides([
    { axis: 'x', value: 50, start: 10, end: 90 },
  ], [{ x: 40, y: 0, w: 20, h: 100 }]), []);
});
