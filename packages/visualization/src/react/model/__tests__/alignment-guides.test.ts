import test from 'node:test';
import assert from 'node:assert/strict';
import { alignNodeRect } from '../constraints.ts';

test('alignment guides span card bounds without exterior extensions', () => {
  const anchor = { x: 10, y: 20, w: 100, h: 50 };
  const peer = { x: 12, y: 22, w: 100, h: 50 };
  const result = alignNodeRect(anchor, [peer], 1);
  const x = result.guides.find((guide) => guide.axis === 'x')!;
  const y = result.guides.find((guide) => guide.axis === 'y')!;
  assert.deepEqual({ start: x.start, end: x.end }, { start: 20, end: 72 });
  assert.deepEqual({ start: y.start, end: y.end }, { start: 10, end: 112 });
});
