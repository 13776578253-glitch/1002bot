import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchBudget, DEFAULT_SEARCH_LIMITS } from '../src/core/layout/search-limits.ts';
import { routeOrthogonal } from '../src/core/layout/geometry.ts';

test('the search budget stops after the declared expansion count', () => {
  const budget = createSearchBudget({ maxExpansions: 2, deadlineMs: 0 });
  assert.equal(budget.consume(1), true);
  assert.equal(budget.consume(1), false);
  assert.equal(budget.expired, true);
});

test('bounded routing still returns a fallback path', () => {
  const points = routeOrthogonal(
    { x: 0, y: 0, w: 100, h: 60 },
    { x: 400, y: 0, w: 100, h: 60 },
    [{ left: 150, right: 250, top: -40, bottom: 100 }],
    { padding: 10, limits: { maxExpansions: 1, deadlineMs: 0 } },
  );
  assert.ok(points.length >= 2);
});

test('default limits are finite and positive', () => {
  assert.ok(DEFAULT_SEARCH_LIMITS.maxExpansions > 0);
  assert.ok(DEFAULT_SEARCH_LIMITS.maxStitchIterations > 0);
});
