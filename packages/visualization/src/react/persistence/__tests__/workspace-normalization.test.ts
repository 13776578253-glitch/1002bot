import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWorkspaceView, normalizeWorkspaceView } from '../local-storage.ts';

type LooseView = {
  version: 2;
  baselineId: string;
  viewMode?: string;
  baselines: { main: Record<string, unknown> };
  views?: Record<string, unknown>;
};

const node = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, type: 'card', position: { x: 0, y: 0 }, width: 240, height: 80, data: {}, ...extra,
});
const edgeRoute = () => ({ canonicalEdgeId: 'e1', state: 'auto', source: { nodeId: 'a' }, target: { nodeId: 'a' }, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], space: { kind: 'world' }, endpointFingerprint: 'a>a' });
const frozenGroup = () => ({ id: 'g1', rootId: 'a', memberIds: [], worldBounds: { x: 0, y: 0, w: 10, h: 10 }, boundaryPorts: [], createdAt: 'now' });
const overlay = () => ({ version: 1, addedNodes: [], addedEdges: [], hiddenSourceNodeIds: [], hiddenSourceEdgeIds: [], edgeOverrides: [] });
const pin = () => ({ id: 'pin', source: 'a', target: 'a', memberIds: ['e1'], label: { x: 0, y: 0, width: 1, height: 1 } });
const displayRoute = (): Record<string, unknown> => ({ id: 'e1', source: 'a', target: 'a', sourceHandle: 'out', targetHandle: 'in', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], memberIds: ['e1'], label: { x: 5, y: 0, width: 1, height: 1 }, text: 'x', sourceBounds: { x: 0, y: 0, w: 1, h: 1 }, targetBounds: { x: 0, y: 0, w: 1, h: 1 } });
const attachment = () => ({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, projected: { x: 5, y: 0 }, fraction: 0.5, axis: 'horizontal', side: 'inline', offset: 0, pathStart: { x: 0, y: 0 }, pathEnd: { x: 10, y: 0 }, pathFraction: 0.5 });
const baselines = () => ({ main: { revision: 'one', nodes: [node('a')], edgeRoutes: [], frozenGroups: [] } });
const view = (): LooseView => ({ version: 2, baselineId: 'main', baselines: baselines() });

test('node validation keeps duplicate-ID errors ahead of per-node shape errors', () => {
  const duplicate = view();
  duplicate.baselines.main.nodes = [node('a'), 42, node('a')];
  assert.throws(() => normalizeWorkspaceView(duplicate), /视图包含重复节点/);

  const shape = view();
  shape.baselines.main.nodes = [node('a'), 42];
  assert.throws(() => normalizeWorkspaceView(shape), /节点视图格式不正确/);

  const duplicateBeforeType = view();
  duplicateBeforeType.baselines.main.nodes = [node('a', { type: 'bogus' }), node('a')];
  assert.throws(() => normalizeWorkspaceView(duplicateBeforeType), /视图包含重复节点/);
});

test('node hierarchy rejects cycles and missing parents after shape validation', () => {
  const cycle = view();
  cycle.baselines.main.nodes = [node('a', { parentId: 'b' }), node('b', { parentId: 'a' })];
  assert.throws(() => normalizeWorkspaceView(cycle), /分组层级格式不正确/);

  const missing = view();
  missing.baselines.main.nodes = [node('a', { parentId: 'missing' })];
  assert.throws(() => normalizeWorkspaceView(missing), /分组层级格式不正确/);
});

test('readers preserve existing fields and reference behavior', () => {
  const raw = view();
  const rawNode = node('a', { extra: { keep: true } });
  const rawRoute = edgeRoute();
  const rawFrozen = frozenGroup();
  const rawOverlay = overlay();
  const rawPin = pin();
  const rawDisplay = displayRoute();
  raw.baselines.main.nodes = [rawNode];
  raw.baselines.main.edgeRoutes = [rawRoute];
  raw.baselines.main.frozenGroups = [rawFrozen];
  raw.baselines.main.overlay = rawOverlay;
  raw.baselines.main.labelPins = [rawPin];
  raw.baselines.main.displayRoutes = [rawDisplay];
  raw.baselines.main.extra = 'drop';

  const item = normalizeWorkspaceView(raw).baselines.main!;
  assert.equal(item.nodes[0], rawNode);
  assert.deepEqual((item.nodes[0] as unknown as { extra: unknown }).extra, { keep: true });
  assert.equal(item.edgeRoutes[0], rawRoute);
  assert.equal(item.frozenGroups[0], rawFrozen);
  assert.equal(item.overlay, rawOverlay);
  assert.notEqual(item.labelPins![0], rawPin);
  assert.notEqual(item.displayRoutes![0], rawDisplay);
  assert.equal('extra' in item, false);
});

test('display routes keep geometry and strip only invalid label attachment metadata', () => {
  const raw = view();
  const route = displayRoute();
  route.labelPolicyKey = 'policy';
  route.labelIdentity = 'identity';
  route.labelRouteKey = 'route';
  route.labelAttachment = attachment();
  route.extra = 'keep';
  raw.baselines.main.displayRoutes = [route];

  const item = normalizeWorkspaceView(raw).baselines.main!;
  assert.deepEqual(item.displayRoutes![0]!.points, route.points);
  assert.equal((item.displayRoutes![0] as unknown as { extra: unknown }).extra, 'keep');
  assert.ok(item.displayRoutes![0]!.labelAttachment);

  const corrupt = view();
  const badRoute = displayRoute();
  const badAttachment = attachment();
  badAttachment.pathFraction = Number.NaN;
  badRoute.labelPolicyKey = 'policy';
  badRoute.labelIdentity = 'identity';
  badRoute.labelRouteKey = 'route';
  badRoute.labelAttachment = badAttachment;
  corrupt.baselines.main.displayRoutes = [badRoute];

  const restored = normalizeWorkspaceView(corrupt).baselines.main!;
  assert.deepEqual(restored.displayRoutes![0]!.points, badRoute.points);
  assert.equal(restored.displayRoutes![0]!.labelAttachment, undefined);
  assert.ok(Number.isNaN((badRoute.labelAttachment as { pathFraction: number }).pathFraction));
});

test('v1 migration uses the Structure view and does not invent confirmation', () => {
  const raw = { version: 1 as const, baselineId: 'main', baselines: { main: { revision: 'one', nodes: [node('a')], viewport: { x: 1, y: 2, zoom: 1 } } } };
  const normalized = normalizeWorkspaceView(raw);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.viewMode, 'structure');
  assert.deepEqual(normalized.baselines.main!.edgeRoutes, []);
  assert.deepEqual(normalized.baselines.main!.frozenGroups, []);
  assert.equal(normalized.baselines.main!.confirmed, undefined);
  assert.deepEqual(normalized.views!.structure, normalized.baselines);
  assert.notEqual(normalized.views!.structure!.main, normalized.baselines.main);
});

test('v2 views must match the active alias and include the active mode', () => {
  const raw = view();
  raw.viewMode = 'structure';
  raw.views = { structure: structuredClone(raw.baselines) };
  assert.doesNotThrow(() => normalizeWorkspaceView(raw));

  const mismatch = structuredClone(raw);
  const structure = mismatch.views!.structure as Record<string, Record<string, unknown>>;
  (structure.main!.nodes as Array<Record<string, unknown>>)[0]!.position = { x: 99, y: 0 };
  assert.throws(() => normalizeWorkspaceView(mismatch), /当前工作视图与视图集合不一致/);

  const missing = view();
  missing.viewMode = 'overview';
  missing.views = { structure: structuredClone(missing.baselines) };
  assert.throws(() => normalizeWorkspaceView(missing), /当前工作视图缺少对应内容/);

  const empty = { version: 2 as const, baselineId: 'main', baselines: {}, viewMode: 'overview', views: { structure: {} } };
  assert.deepEqual(normalizeWorkspaceView(empty).views!.overview, {});
});

test('assertWorkspaceView validates and returns undefined on valid input', () => {
  assert.equal(assertWorkspaceView(view()), undefined);
  const invalid = view();
  invalid.baselines.main.nodes = [node('a', { width: -1 })];
  assert.throws(() => assertWorkspaceView(invalid), /节点视图格式不正确/);
});

test('overlay validation currently accepts unchecked element shapes', () => {
  // 已知缺口：Overlay 只校验顶层结构；元素级校验留到后续单独处理。
  const raw = view();
  raw.baselines.main.overlay = { version: 1, addedNodes: [42], addedEdges: [], hiddenSourceNodeIds: [], hiddenSourceEdgeIds: [], edgeOverrides: [] };
  assert.deepEqual(normalizeWorkspaceView(raw).baselines.main!.overlay!.addedNodes, [42]);
});
