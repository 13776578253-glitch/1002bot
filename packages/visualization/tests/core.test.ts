/**
 * Core engine tests: schema validation, graph indexing, projection,
 * and evolution semantics. Runs with node --experimental-strip-types --test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, assertValidSnapshot } from '../src/core/schema/validate.ts';
import type { StageSnapshot } from '../src/core/schema/types.ts';
import { indexGraph, edgesTouching } from '../src/core/graph/index.ts';
import { projectGraph, resolveVisibleEndpoint } from '../src/core/projection/index.ts';
import { diffSnapshots, applyEvolutionEvents } from '../src/core/evolution/index.ts';
import { createTidyLayout, LAYOUT_METRICS } from '../src/core/layout/tidy.ts';

const stageA: StageSnapshot = {
  id: 'a', label: 'A', track: 'main', order: 1, title: 'Stage A',
  root: {
    key: 'system', title: 'System',
    children: [
      { key: 'runtime', title: 'Runtime', children: [
        { key: 'admission', title: 'Admission' },
        { key: 'execution', title: 'Execution', ports: [{ id: 'provider' }] },
      ]},
      { key: 'provider', title: 'Provider' },
      { key: 'session', title: 'Session' },
    ],
  },
  edges: [
    { from: 'system/runtime/admission', to: 'system/runtime/execution', label: 'dispatch' },
    { from: 'system/runtime/execution#provider', to: 'system/provider', label: 'call model' },
    { from: 'system/runtime', to: 'system/session', label: 'append facts' },
  ],
};

const stageB: StageSnapshot = {
  id: 'b', label: 'B', track: 'main', order: 2, title: 'Stage B',
  root: {
    key: 'system', title: 'System',
    children: [
      { key: 'runtime', title: 'Runtime', children: [
        { key: 'admission', title: 'Admission' },
        { key: 'execution', title: 'Execution', ports: [{ id: 'provider' }] },
        { key: 'delivery', title: 'Delivery' },
      ]},
      { key: 'provider', title: 'Provider' },
      // session moved under a new aggregate
      { key: 'state', title: 'State', children: [
        { key: 'session', title: 'Session' },
      ]},
    ],
  },
  edges: [
    { from: 'system/runtime/admission', to: 'system/runtime/execution', label: 'dispatch' },
    { from: 'system/runtime/execution#provider', to: 'system/provider', label: 'call model' },
    { from: 'system/runtime', to: 'system/state/session', label: 'append facts' },
    { from: 'system/runtime/delivery', to: 'system/state/session', label: 'wait saved' },
  ],
};

test('validateSnapshot accepts a well-formed snapshot', () => {
  assert.deepEqual(validateSnapshot(stageA), []);
});

test('validateSnapshot reports duplicate keys and unknown edge endpoints', () => {
  const bad: StageSnapshot = {
    id: 'bad', label: 'Bad', track: 'main', order: 0, title: 'Bad',
    root: { key: 'system', title: 'S', children: [
      { key: 'dup', title: 'One' },
      { key: 'dup', title: 'Two' },
    ]},
    edges: [{ from: 'system/missing', to: 'system/dup' }],
  };
  const issues = validateSnapshot(bad);
  assert.ok(issues.some((i) => i.message.includes('duplicate key')));
  assert.ok(issues.some((i) => i.message.includes('unknown node')));
  assert.throws(() => assertValidSnapshot(bad));
});

test('validateSnapshot reports an undeclared edge port', () => {
  const badPort: StageSnapshot = {
    ...stageA,
    id: 'bad-port',
    edges: [{ from: 'system/runtime/execution#missing', to: 'system/provider' }],
  };
  const issues = validateSnapshot(badPort);
  assert.ok(issues.some((issue) => issue.message.includes('unknown port')));
});

test('indexGraph maps keys to paths and finds touching edges', () => {
  const g = indexGraph(stageA);
  assert.equal(g.byKey.get('execution'), 'system/runtime/execution');
  assert.equal(g.parentOf.get('system/runtime/admission'), 'system/runtime');
  assert.equal(edgesTouching(g, 'system/runtime').length, 3);
});

test('projection folds collapsed subtrees onto visible ancestors', () => {
  const folded = projectGraph(stageA, []);
  // Only first level visible: runtime, provider, session
  assert.deepEqual(folded.nodes.map((n) => n.path).sort(), ['system/provider', 'system/runtime', 'system/session']);
  // admission→execution folds to a self-loop on runtime and is dropped;
  // execution→provider folds to runtime→provider; runtime→session stays.
  assert.deepEqual(
    folded.edges.map((e) => `${e.from}>${e.to}`).sort(),
    ['system/runtime>system/provider', 'system/runtime>system/session'],
  );
  assert.ok(folded.edges.every((e) => e.folded || e.from === 'system/runtime'));
});

test('projection expands to internal interfaces and keeps ports', () => {
  const open = projectGraph(stageA, ['system/runtime']);
  assert.ok(open.nodes.some((n) => n.path === 'system/runtime/execution'));
  const providerEdge = open.edges.find((e) => e.to === 'system/provider');
  assert.equal(providerEdge?.from, 'system/runtime/execution#provider');
  assert.equal(providerEdge?.folded, false);
});

test('resolveVisibleEndpoint climbs to the nearest visible ancestor', () => {
  const g = indexGraph(stageA);
  const r = resolveVisibleEndpoint('system/runtime/execution#provider', g, new Set());
  assert.equal(r.endpoint, 'system/runtime');
  assert.equal(r.folded, true);
});

test('projection uses the deepest visible ancestor for nested folded endpoints', () => {
  const nested: StageSnapshot = {
    id: 'nested', label: 'Nested', track: 'main', order: 1, title: 'Nested',
    root: {
      key: 'system', title: 'System', children: [
        { key: 'a', title: 'A', children: [
          { key: 'b', title: 'B', children: [{ key: 'c', title: 'C' }] },
        ] },
        { key: 'z', title: 'Z' },
      ],
    },
    edges: [{ from: 'system/a/b/c', to: 'system/z' }],
  };
  const projection = projectGraph(nested, ['system/a']);
  assert.equal(projection.edges[0]?.from, 'system/a/b');
});

test('projection preserves parallel edges with distinct labels', () => {
  const parallel: StageSnapshot = {
    id: 'parallel', label: 'Parallel', track: 'main', order: 1, title: 'Parallel',
    root: { key: 'system', title: 'System', children: [
      { key: 'a', title: 'A' }, { key: 'b', title: 'B' },
    ] },
    edges: [
      { from: 'system/a', to: 'system/b', label: 'one' },
      { from: 'system/a', to: 'system/b', label: 'two' },
    ],
  };
  assert.deepEqual(
    projectGraph(parallel, []).edges.map((edge) => edge.edge.label),
    ['one', 'two'],
  );
});

test('diffSnapshots detects added, moved, removed and edge changes by key', () => {
  const delta = diffSnapshots(stageA, stageB);
  const byKey = new Map(delta.nodes.map((n) => [n.key, n]));
  assert.equal(byKey.get('delivery')?.kind, 'added');
  assert.equal(byKey.get('state')?.kind, 'added');
  // session moved from system/session to system/state/session
  assert.equal(byKey.get('session')?.kind, 'moved');
  assert.equal(byKey.get('runtime')?.kind, 'modified');
  // runtime→session edge survives (same keys), delivery→session is new
  assert.ok(delta.edges.some((e) => e.kind === 'added' && e.from === 'delivery' && e.to === 'session'));
  assert.ok(delta.edges.some((e) => e.kind === 'inherited' && e.from === 'runtime' && e.to === 'session'));
});

test('diffSnapshots marks port and source metadata changes as modified', () => {
  const after = JSON.parse(JSON.stringify(stageA)) as StageSnapshot;
  const runtime = after.root.children?.find((node) => node.key === 'runtime');
  const execution = runtime?.children?.find((node) => node.key === 'execution');
  assert.ok(execution);
  execution.ports = [{ id: 'different' }];
  execution.source = 'src/changed.ts';
  const delta = diffSnapshots(stageA, after);
  assert.equal(delta.nodes.find((node) => node.key === 'execution')?.kind, 'modified');
});

test('applyEvolutionEvents adds split and rewired semantics', () => {
  const delta = diffSnapshots(stageA, stageB);
  const merged = applyEvolutionEvents(delta, {
    stage: 'b',
    events: [
      { kind: 'moved', key: 'session', note: 'state ownership regrouped' },
      { kind: 'rewired', from: { from: 'runtime', to: 'session' }, to: { from: 'delivery', to: 'session' }, note: 'save confirmation now flows through delivery' },
    ],
  });
  const session = merged.nodes.find((n) => n.key === 'session');
  assert.equal(session?.kind, 'moved');
  assert.equal(session?.note, 'state ownership regrouped');
  const rewired = merged.edges.find((e) => e.kind === 'rewired' && e.from === 'delivery');
  assert.ok(rewired);
  assert.deepEqual(rewired.before, { from: 'runtime', to: 'session' });
});

test('baseline diff marks everything as baseline/added on the first stage', () => {
  const delta = diffSnapshots(undefined, stageA);
  assert.ok(delta.nodes.every((n) => n.kind === 'baseline'));
  assert.equal(delta.edges.length, 3);
});

test('expanded aggregates reserve their header, description, and padding', () => {
  const projection = projectGraph(stageA, ['system/runtime']);
  const layout = createTidyLayout().layout(
    projection.nodes.map((n) => ({ path: n.path, expanded: n.expanded })),
    projection.edges.map((e) => ({ from: e.from, to: e.to })),
  );
  const byPath = new Map(layout.nodes.map((n) => [n.path, n]));
  const aggregate = byPath.get('system/runtime')!;
  const children = ['system/runtime/admission', 'system/runtime/execution']
    .map((path) => byPath.get(path)!);

  assert.equal(aggregate.expanded, true);
  for (const child of children) {
    const relativeY = child.at.y - aggregate.at.y;
    assert.ok(relativeY >= LAYOUT_METRICS.aggregateContentTop);
    assert.ok(relativeY + child.size.h <= aggregate.size.h - LAYOUT_METRICS.aggregatePadding);
    assert.ok(
      child.at.x - aggregate.at.x >=
        LAYOUT_METRICS.aggregatePadding - LAYOUT_METRICS.grid / 2,
    );
  }
});
