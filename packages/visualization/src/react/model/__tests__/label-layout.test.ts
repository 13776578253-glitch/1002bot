import test from 'node:test';
import assert from 'node:assert/strict';
import type { Projection } from '../../../core/projection/index.ts';
import { rectIntersects, type Point } from '../../../core/layout/geometry.ts';
import type { CanvasNode } from '../grouping.ts';
import { LabelLayoutCache, SWITCH_IMPROVEMENT, shouldSwitchLabel, shortenLabel, type LabelLayoutEdge, type LabelLayoutResult } from '../label-layout.ts';
import type { CachedRoute } from '../route-cache.ts';

const project = (nodes: readonly CanvasNode[]): Projection => {
  const visible = nodes.map((node) => ({ id: node.id, canonicalId: node.id, depth: 1, expanded: false, expandable: false }));
  return { rootId: 'root', nodes: visible, edges: [], nodeById: new Map(visible.map((node) => [node.id, node])), hiddenToVisible: new Map() };
};
const card = (id: string, x: number, y: number, width: number, height: number): CanvasNode => ({ id, type: 'card', position: { x, y }, width, height, data: { title: id } });
const route = (points: Point[], text = '调用'): CachedRoute => ({ sourceHandle: 'out', targetHandle: 'in', points, label: { x: 0, y: 0, width: 44, height: 24 }, text });
const rect = (item: { x: number; y: number; width: number; height: number }) => ({ x: item.x - item.width / 2, y: item.y - item.height / 2, w: item.width, h: item.height });
const line = (y = 0, length = 300) => [{ x: 0, y }, { x: length, y }];

test('places labels without modifying route geometry or handles', () => {
  const edges = [{ id: 'one', text: '事件分发' }], routes = new Map([['one', route(line())]]);
  const before = structuredClone(routes);
  const result = new LabelLayoutCache().update([], project([]), edges, routes);
  assert.ok(result.labels.get('one')?.placement);
  assert.deepEqual(routes, before);
  assert.equal(routes.get('one')?.sourceHandle, 'out');
  assert.equal(routes.get('one')?.targetHandle, 'in');
});

test('a blocked route produces a hidden label without an arbitrary fallback', () => {
  const nodes = [card('cover', -500, -500, 1000, 1000)];
  const result = new LabelLayoutCache().update(nodes, project(nodes), [{ id: 'one', text: '调用' }], new Map([['one', route(line())]]));
  assert.equal(result.labels.get('one')?.state, 'space-exhausted');
  assert.equal(result.labels.get('one')?.placement, undefined);
  assert.equal(result.stats.hidden, 1);
});

test('short display text retains the original relation text', () => {
  const text = '这里是一段需要完整保留的非常长的架构连接描述';
  const result = new LabelLayoutCache().update([], project([]), [{ id: 'one', text }], new Map([['one', route(line())]]));
  assert.equal(result.labels.get('one')?.fullText, text);
  assert.equal(result.labels.get('one')?.text, shortenLabel(text));
  assert.match(result.labels.get('one')!.text, /…$/);
});

test('fixed labels remain in place and invalid fixed labels are hidden', () => {
  const fixed = { x: 150, y: 0, width: 44, height: 24 };
  const edges = [{ id: 'one', text: '调用', fixed }], routes = new Map([['one', route(line())]]);
  const cache = new LabelLayoutCache();
  assert.deepEqual(cache.update([], project([]), edges, routes).labels.get('one')?.placement, fixed);
  const nodes = [card('blocker', 120, -30, 60, 60)];
  const hidden = cache.update(nodes, project(nodes), edges, routes).labels.get('one');
  assert.equal(hidden?.state, 'space-exhausted');
  assert.equal(hidden?.placement, undefined);
  assert.deepEqual(edges[0]!.fixed, fixed);
  assert.deepEqual(cache.update([], project([]), edges, routes).labels.get('one')?.placement, fixed);
});

test('competing labels never overlap, including fixed positions', () => {
  const edges: LabelLayoutEdge[] = [{ id: 'one', text: '调用', fixed: { x: 100, y: 0, width: 44, height: 24 } }, { id: 'two', text: '响应' }, { id: 'three', text: '数据' }];
  const routes = new Map(edges.map(({ id }) => [id, route(line(0, 200))]));
  const labels = [...new LabelLayoutCache().update([], project([]), edges, routes).labels.values()].flatMap((item) => item.placement ? [rect(item.placement)] : []);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.equal(rectIntersects(labels[i]!, labels[j]!), false);
});

test('a previous legal position remains stable through unrelated edits', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用' }], routes = new Map([['one', route(line())]]);
  const first = cache.update([], project([]), edges, routes);
  const repeated = cache.update([], project([]), edges, routes);
  assert.equal(repeated.labels, first.labels);
  assert.deepEqual(repeated.labels.get('one')?.placement, first.labels.get('one')?.placement);
  assert.equal(repeated.stats.reusedCandidates, 1);
  const nodes = [card('far', 3000, 3000, 100, 100)];
  const changed = cache.update(nodes, project(nodes), edges, routes);
  assert.deepEqual(changed.labels.get('one')?.placement, first.labels.get('one')?.placement);
  assert.equal(changed.stats.reusedCandidates, 1);
});

test('labels prefer a clear candidate over covering another path', () => {
  const edges = [{ id: 'horizontal', text: '调用' }, { id: 'crossing', text: '' }];
  const routes = new Map([['horizontal', route(line())], ['crossing', route([{ x: 150, y: -100 }, { x: 150, y: 100 }], '')]]);
  const placement = new LabelLayoutCache().update([], project([]), edges, routes).labels.get('horizontal')?.placement;
  assert.ok(placement);
  const bounds = rect(placement);
  assert.ok(bounds.x + bounds.w <= 150 || bounds.x >= 150 || bounds.y + bounds.h <= -100 || bounds.y >= 100);
});

test('output is deterministic for the same geometry regardless of input order', () => {
  const edges = [{ id: 'b', text: '响应' }, { id: 'a', text: '调用' }];
  const routes = new Map([['a', route(line())], ['b', route(line(0, 300))]]);
  const a = new LabelLayoutCache().update([], project([]), edges, routes).labels;
  const b = new LabelLayoutCache().update([], project([]), [...edges].reverse(), routes).labels;
  assert.deepEqual([...a].sort(([x], [y]) => x.localeCompare(y)), [...b].sort(([x], [y]) => x.localeCompare(y)));
});

test('a moved path does not retain an old position detached from its route', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用' }];
  const first = cache.update([], project([]), edges, new Map([['one', route(line())]])).labels.get('one')?.placement;
  const after = cache.update([], project([]), edges, new Map([['one', route(line(200))]])).labels.get('one')?.placement;
  assert.ok(first && after);
  assert.ok(Math.abs(first.y - after.y) > 100);
  assert.ok(Math.abs(after.y - 200) <= after.height / 2 + 24);
});

test('container headers and frame borders remain unobstructed', () => {
  const frame: CanvasNode = { id: 'frame', type: 'structure', position: { x: 0, y: 0 }, width: 400, height: 300, data: { title: 'frame', expanded: true } };
  const placement = new LabelLayoutCache().update([frame], project([frame]), [{ id: 'one', text: '调用' }], new Map([['one', route([{ x: 0, y: 150 }, { x: 400, y: 150 }])]])).labels.get('one')?.placement;
  assert.ok(placement);
  const bounds = rect(placement);
  assert.ok(bounds.x >= 8 && bounds.y >= 76 && bounds.x + bounds.w <= 392 && bounds.y + bounds.h <= 292);
});

test('a short segment hides rather than placing its text past an endpoint', () => {
  const result = new LabelLayoutCache().update([], project([]), [{ id: 'one', text: '调用' }], new Map([['one', route(line(0, 50))]]));
  assert.equal(result.labels.get('one')?.state, 'space-exhausted');
  assert.equal(result.labels.get('one')?.placement, undefined);
});

test('fixed labels that drift away or have empty size are hidden without modifying the pin', () => {
  const fixed = { x: 150, y: 1000, width: 44, height: 24 };
  const edges = [{ id: 'one', text: '调用', fixed }], routes = new Map([['one', route(line())]]);
  const result = new LabelLayoutCache().update([], project([]), edges, routes);
  assert.equal(result.labels.get('one')?.placement, undefined);
  assert.equal(fixed.y, 1000);
  const empty = new LabelLayoutCache().update([], project([]), [{ ...edges[0]!, fixed: { x: 150, y: 0, width: 0, height: 0 } }], routes);
  assert.equal(empty.labels.get('one')?.placement, undefined);
});

test('route label metadata never seeds or invalidates independent labeling', () => {
  const cache = new LabelLayoutCache(), edge = [{ id: 'one', text: '调用' }], restored = route(line());
  restored.label = { x: 80, y: 0, width: 44, height: 24 };
  const first = cache.update([], project([]), edge, new Map([['one', restored]]));
  assert.equal(first.labels.get('one')?.placement?.x, 150);
  const changed = { ...restored, label: { x: 210, y: 1000, width: 0, height: 0 }, text: 'outdated routing text' };
  const second = cache.update([], project([]), edge, new Map([['one', changed]]));
  assert.equal(second.labels, first.labels);
  assert.equal(second.stats.generated, 0);
});

test('one occupied label can be moved to make room for a constrained label', () => {
  const nodes = [card('above', 80, -80, 140, 54), card('below', 80, 26, 140, 54)];
  const edges: LabelLayoutEdge[] = [{ id: 'flexible', text: '调用', priority: 1 }, { id: 'short', text: '响应' }];
  const routes = new Map([['flexible', route(line())], ['short', route([{ x: 110, y: 0 }, { x: 190, y: 0 }])]]);
  const result = new LabelLayoutCache().update(nodes, project(nodes), edges, routes);
  const first = result.labels.get('flexible')?.placement, second = result.labels.get('short')?.placement;
  assert.ok(first && second);
  assert.equal(rectIntersects(rect(first), rect(second)), false);
});

test('selection changes reuse the entire result without a second label solve', () => {
  const nodes = [card('far', 1000, 1000, 100, 100)], edges = [{ id: 'one', text: '调用' }], routes = new Map([['one', route(line())]]);
  const cache = new LabelLayoutCache();
  const first = cache.update(nodes, project(nodes), edges, routes);
  const selected = nodes.map((node) => ({ ...node, selected: true }));
  const result = cache.update(selected, project(selected), edges, routes);
  assert.equal(result.labels, first.labels);
  assert.equal(result.stats.generated, 0);
});

function seeded(offset = 0, identity = 'edge:a>b'): LabelLayoutResult {
  return { text: '调用', fullText: '调用', identity, state: offset ? 'adjusted' : 'normal',
    placement: { x: 150, y: offset, width: 44, height: 24 },
    attachment: { from: { x: 0, y: 0 }, to: { x: 300, y: 0 }, projected: { x: 150, y: 0 }, fraction: 0.5,
      axis: 'horizontal', side: offset ? (offset < 0 ? 'negative' : 'positive') : 'inline', offset,
      pathStart: { x: 0, y: 0 }, pathEnd: { x: 300, y: 0 }, pathFraction: 0.5 } };
}

test('a labeling seed is restored only when exact semantic identity matches', () => {
  const previous = seeded(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }], routes = new Map([['one', route(line())]]);
  previous.attachment!.projected.x = 80;
  previous.attachment!.fraction = 80 / 300;
  previous.attachment!.pathFraction = 80 / 300;
  previous.placement!.x = 80;
  const restored = new LabelLayoutCache().update([], project([]), edges, routes, new Map([['one', previous]])).labels.get('one');
  assert.equal(restored?.placement?.x, 80);
  const changed = new LabelLayoutCache().update([], project([]), [{ ...edges[0]!, identity: 'edge:c>d' }], routes, new Map([['one', previous]])).labels.get('one');
  assert.equal(changed?.placement?.x, 150);
  assert.equal(changed?.identity, 'edge:c>d');
});

test('changing semantic identity invalidates a live cache for the same display ID', () => {
  const cache = new LabelLayoutCache(), seed = seeded(), routes = new Map([['one', route(line())]]);
  seed.attachment!.projected.x = 80;
  seed.attachment!.fraction = 80 / 300;
  seed.attachment!.pathFraction = 80 / 300;
  seed.placement!.x = 80;
  const first = cache.update([], project([]), [{ id: 'one', text: '调用', identity: 'edge:a>b' }], routes, new Map([['one', seed]]));
  assert.equal(first.labels.get('one')?.placement?.x, 80);
  const next = cache.update([], project([]), [{ id: 'one', text: '调用', identity: 'edge:c>d' }], routes, new Map([['one', seed]]));
  assert.equal(next.labels.get('one')?.placement?.x, 150);
});

test('malformed persisted attachment metadata is ignored at the labeling boundary', () => {
  const invalid = JSON.parse(JSON.stringify(seeded())) as LabelLayoutResult;
  delete (invalid.attachment as Partial<NonNullable<LabelLayoutResult['attachment']>>).from;
  const result = new LabelLayoutCache().update([], project([]), [{ id: 'one', text: '调用', identity: 'edge:a>b' }], new Map([['one', route(line())]]), new Map([['one', invalid]])).labels.get('one');
  assert.equal(result?.placement?.x, 150);
});

test('continuous one-pixel motion carries the attachment without segment or side jumps', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }];
  for (let step = 0; step <= 30; step++) {
    const paths = new Map([['one', route(line(step))]]);
    const result = cache.update([], project([]), edges, paths).labels.get('one');
    assert.ok(result?.placement && result.attachment);
    assert.ok(Math.abs(result.placement.x - 150) < 0.001);
    assert.ok(Math.abs(result.placement.y - step) < 0.001);
    assert.equal(result.attachment.side, 'inline');
    assert.equal(result.attachment.axis, 'horizontal');
  }
});

test('collinear splitting, bend insertion and deletion match geometry instead of segment indices', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }];
  const first = cache.update([], project([]), edges, new Map([['one', route(line())]])).labels.get('one')!;
  const split = cache.update([], project([]), edges, new Map([['one', route([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }])]])).labels.get('one')!;
  assert.deepEqual(split.placement, first.placement);
  const bent = cache.update([], project([]), edges, new Map([['one', route([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 10 }, { x: 300, y: 10 }])]])).labels.get('one')!;
  assert.ok(bent.placement && bent.attachment);
  assert.equal(bent.attachment.axis, 'horizontal');
  assert.ok(Math.hypot(bent.placement.x - first.placement!.x, bent.placement.y - first.placement!.y) <= 12);
  const straight = cache.update([], project([]), edges, new Map([['one', route(line())]])).labels.get('one')!;
  assert.ok(straight.placement && Math.abs(straight.placement.y) <= 0.001);
  assert.ok(Math.abs(straight.placement.x - bent.placement.x) < 0.001);
});

test('a removed horizontal segment does not attach to a different vertical arm', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }];
  assert.ok(cache.update([], project([]), edges, new Map([['one', route(line())]])).labels.get('one')?.placement);
  const after = cache.update([], project([]), edges, new Map([['one', route([{ x: 150, y: -150 }, { x: 150, y: 150 }])]])).labels.get('one')!;
  assert.equal(after.state, 'space-exhausted');
  assert.equal(after.placement, undefined);
});

test('an unchanged segment wins over a nearby parallel arm after inserting a loop', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }];
  assert.equal(cache.update([], project([]), edges, new Map([['one', route(line())]])).labels.get('one')?.placement?.y, 0);
  const points = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 20 }, { x: 300, y: 20 }];
  const result = cache.update([], project([]), edges, new Map([['one', route(points)]])).labels.get('one')!;
  assert.equal(result.attachment?.projected.y, 0);
  assert.equal(result.attachment?.side, 'inline');
});

test('switch threshold includes an exact improvement at the boundary', () => {
  assert.equal(shouldSwitchLabel(100 - SWITCH_IMPROVEMENT, 100), true);
  assert.equal(shouldSwitchLabel(100 - SWITCH_IMPROVEMENT + 0.001, 100), false);
});

test('switch hysteresis prevents small score changes from moving a valid side attachment', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }];
  const seed = seeded(14);
  for (let step = 0; step < 12; step++) {
    const y = step % 2;
    const result = cache.update([], project([]), edges, new Map([['one', route(line(y))]]), step ? undefined : new Map([['one', seed]])).labels.get('one');
    assert.ok(result?.placement && result.attachment);
    assert.equal(result.attachment.side, 'positive');
    assert.ok(Math.abs(result.placement.y - y - 14) < 0.001);
  }
});

test('a material path crossing penalty can override hysteresis', () => {
  const cache = new LabelLayoutCache(), edge = { id: 'one', text: '调用', identity: 'edge:a>b' };
  const first = cache.update([], project([]), [edge], new Map([['one', route(line())]]), new Map([['one', seeded(14)]])).labels.get('one')!;
  assert.equal(first.attachment?.side, 'positive');
  const edges = [edge, { id: 'cross', text: '' }], routes = new Map([['one', route(line())], ['cross', route(line(20), '')]]);
  const second = cache.update([], project([]), edges, routes).labels.get('one')!;
  assert.ok(second.placement && second.attachment);
  assert.notEqual(second.attachment.side, 'positive');
});

test('new low-priority labels cannot displace a valid established label', () => {
  const nodes = [card('above', 80, -80, 140, 54), card('below', 80, 26, 140, 54)];
  const firstEdge = { id: 'flexible', text: '调用', priority: 1 }, shortEdge = { id: 'short', text: '响应', priority: 0 };
  const cache = new LabelLayoutCache(), firstRoute = route(line());
  const first = cache.update(nodes, project(nodes), [firstEdge], new Map([['flexible', firstRoute]])).labels.get('flexible')!;
  const second = cache.update(nodes, project(nodes), [firstEdge, shortEdge], new Map([['flexible', firstRoute], ['short', route([{ x: 110, y: 0 }, { x: 190, y: 0 }])]])).labels;
  assert.deepEqual(second.get('flexible')?.placement, first.placement);
  assert.equal(second.get('short')?.state, 'space-exhausted');
});

test('fixed and automatic labels touch their own paths within the two-pixel bound', () => {
  const routes = new Map([['one', route(line())]]);
  for (const y of [0, 12, 14]) {
    const result = new LabelLayoutCache().update([], project([]), [{ id: 'one', text: '调用', fixed: { x: 150, y, width: 44, height: 24 } }], routes).labels.get('one')!;
    assert.equal(result.state, 'fixed');
    assert.ok(result.placement && result.attachment);
    assert.ok(Math.abs(result.attachment.offset) < 0.001 || Math.abs(Math.abs(result.attachment.offset) - result.placement.height / 2) <= 2.001);
  }
  for (const y of [4, 15, 16, 36]) {
    const result = new LabelLayoutCache().update([], project([]), [{ id: 'one', text: '调用', fixed: { x: 150, y, width: 44, height: 24 } }], routes).labels.get('one')!;
    assert.equal(result.state, 'space-exhausted');
    assert.equal(result.placement, undefined);
  }
});

test('an automatically shifted vertical label stays within two pixels of its line', () => {
  const nodes = [card('blocker', -30, -100, 7, 500)];
  const routePoints = [{ x: 0, y: 0 }, { x: 0, y: 300 }];
  const label = new LabelLayoutCache().update(nodes, project(nodes), [{ id: 'one', text: '调用' }], new Map([['one', route(routePoints)]])).labels.get('one')!;
  assert.ok(label.placement && label.attachment);
  assert.equal(label.attachment.axis, 'vertical');
  assert.notEqual(label.attachment.side, 'inline');
  assert.ok(Math.abs(Math.abs(label.attachment.offset) - label.placement.width / 2) <= 2.0001);
});

test('an abandoned render draft does not change committed results or the next attachment', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }];
  const originalRoutes = new Map([['one', route(line())]]);
  const original = cache.update([], project([]), edges, originalRoutes);
  const draft = cache.fork();
  const abandoned = draft.update([], project([]), edges, new Map([['one', route(line(100))]]));
  assert.equal(abandoned.labels.get('one')?.placement?.y, 100);
  const unchanged = cache.update([], project([]), edges, originalRoutes);
  assert.equal(unchanged.labels, original.labels);
  assert.deepEqual(unchanged.labels.get('one'), original.labels.get('one'));
  const next = cache.update([], project([]), edges, new Map([['one', route(line(1))]]));
  assert.equal(next.labels.get('one')?.placement?.y, 1);
  assert.equal(next.labels.get('one')?.attachment?.pathStart.y, 1);
});

test('adopting a render draft publishes its result and isolates subsequent drafts', () => {
  const cache = new LabelLayoutCache(), edges = [{ id: 'one', text: '调用', identity: 'edge:a>b' }];
  cache.update([], project([]), edges, new Map([['one', route(line())]]));
  const draft = cache.fork(), routes = new Map([['one', route(line(30))]]);
  const rendered = draft.update([], project([]), edges, routes);
  cache.adopt(draft);
  const committed = cache.update([], project([]), edges, routes);
  assert.deepEqual(committed.labels, rendered.labels);
  assert.equal(committed.stats.generated, 0);
  assert.equal(committed.labels.get('one')?.attachment?.projected.y, 30);
  draft.update([], project([]), edges, new Map([['one', route(line(90))]]));
  assert.deepEqual(cache.update([], project([]), edges, routes).labels, rendered.labels);
});
