import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackLabel, labelIsVisible } from '../src/react/model/labels.ts';
import { routingFallback } from '../src/react/model/routing-status.ts';

test('space-exhausted labels only reveal on hover and keep a fallback box', () => {
  assert.equal(labelIsVisible('normal'), true);
  assert.equal(labelIsVisible('adjusted'), true);
  assert.equal(labelIsVisible('space-exhausted'), false);
  assert.equal(labelIsVisible('space-exhausted', true), true);
  const box = fallbackLabel('长关系名称', { x: 40, y: 80 });
  assert.equal(box.x, 40);
  assert.equal(box.y, 80);
  assert.ok(box.width >= 44);
  assert.equal(box.height, 24);
});

test('drag and preview fallbacks stay silent', () => {
  assert.equal(routingFallback('dragging').silent, true);
  assert.equal(routingFallback('preview').silent, true);
  assert.equal(routingFallback('protected-routes').silent, false);
  assert.match(routingFallback('protected-routes').message, /固定\/锁定路径/);
  assert.match(routingFallback('frozen-groups').message, /冻结组/);
  assert.match(routingFallback('aggregated-edges').message, /聚合/);
});

test('incomplete notices include the failed edge count', () => {
  const fallback = routingFallback('incomplete', [
    { edgeId: 'a', reason: 'no-candidate' },
    { edgeId: 'b', reason: 'port-capacity' },
  ]);
  assert.equal(fallback.reason, 'incomplete');
  assert.equal(fallback.failures.length, 2);
  assert.match(fallback.message, /2 条未完成/);
  assert.match(fallback.message, /已保留旧路由/);
});
