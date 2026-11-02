import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCanvasRoutes } from '../src/react/model/route-selection.ts';
import type { CachedRoute } from '../src/react/model/route-cache.ts';
import type { GroupSolveOutcome } from '../src/react/model/route-groups.ts';

const route = (text: string): CachedRoute => ({
  sourceHandle: 'bottom:source:0', targetHandle: 'top:target:0',
  points: [{ x: 0, y: 0 }, { x: 0, y: 10 }], label: { x: 0, y: 5, width: 44, height: 24 },
  labelState: 'normal', text,
});

const legacy = new Map([['a', route('legacy-a')], ['b', route('legacy-b')]]);
const group = (routes: Map<string, CachedRoute>): GroupSolveOutcome => ({
  ok: true, groups: [], plans: [], routes, fixedPorts: new Map(), failures: [],
  evaluations: [], rounds: 1, candidates: 1, elapsedMs: 0,
});

test('a complete group solution replaces the legacy routes', () => {
  const routes = new Map([['a', route('group-a')], ['b', route('group-b')]]);
  const selected = selectCanvasRoutes(legacy, group(routes), ['a', 'b']);
  assert.equal(selected.engine, 'group');
  assert.equal(selected.routes, routes);
});

test('a partial group solution falls back to the same legacy map', () => {
  const selected = selectCanvasRoutes(legacy, group(new Map([['a', route('group-a')]])), ['a', 'b']);
  assert.equal(selected.engine, 'legacy');
  assert.equal(selected.routes, legacy);
});

test('a failed group transaction falls back to the legal legacy routes', () => {
  const failure: GroupSolveOutcome = { ok: false, reason: 'NO_COMPLETE_FEASIBLE_MODE', groups: [], failures: [] };
  const selected = selectCanvasRoutes(legacy, failure, ['a', 'b']);
  assert.equal(selected.engine, 'legacy');
  assert.equal(selected.routes, legacy);
});

test('no group solution keeps the legacy routes and engine', () => {
  const selected = selectCanvasRoutes(legacy, undefined, ['a', 'b']);
  assert.deepEqual(selected, { routes: legacy, engine: 'legacy' });
});
