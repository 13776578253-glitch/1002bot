import test from 'node:test';
import assert from 'node:assert/strict';
import { routingFallback } from '../src/react/model/routing/routing-status.ts';

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
