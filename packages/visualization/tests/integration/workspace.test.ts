import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';
import type { VisualizationBaseline } from '../../src/core/schema/baseline.ts';
import { createHierarchyNodes, toggleHierarchy } from '../../src/react/model/hierarchy.ts';
import { CARD_SIZE, groupSelection, worldPosition, type CanvasNode } from '../../src/react/model/grouping.ts';
import { captureContent, captureNodeViews, restoreNodeViews, ViewHistory, type CanvasWorkspaceView } from '../../src/react/model/workspace.ts';
import { createLocalStorageViewStorage } from '../../src/react/persistence/local-storage.ts';

const entity = (id: string, parentId: string | null, order: number): CanonicalNode => ({ id, parentId, kind: parentId === null ? 'root' : 'component', label: id, summary: `${id} source summary`, order, ports: [] });
const stage: StageSnapshot = { id: 'main', label: 'main', title: 'main', track: 'main', order: 0, graph: { rootId: 'root', revision: 'one', nodes: [entity('root', null, 0), entity('module', 'root', 1), entity('first', 'module', 2), entity('second', 'module', 3), entity('outside', 'root', 4)], edges: [] } };
const baseline = (snapshot = stage): VisualizationBaseline => ({ id: snapshot.id, stage: snapshot, nodeChanges: Object.fromEntries(snapshot.graph.nodes.filter((node) => node.parentId !== null).map((node) => [node.id, { kind: 'baseline', label: '基线' }])), edgeChanges: {} });
const fresh = (snapshot = stage) => createHierarchyNodes(snapshot, { module: { x: 300, y: 200 }, first: { x: 24, y: 72 }, second: { x: 360, y: 72 }, outside: { x: 1400, y: 200 }, introduced: { x: 900, y: 700 } });
const working = (): CanvasNode[] => {
  const expanded = toggleHierarchy(fresh(), 'module', stage).map((node) => ({ ...node, selected: node.id === 'first' || node.id === 'second' }));
  return groupSelection(expanded, 'user-group').map((node) => ({ ...node, selected: true, dragging: true, data: { ...node.data,
    ...(node.id === 'user-group' ? { title: '工作分组', contentWidth: 730, contentHeight: 330, fitOffset: { x: -12, y: -18 }, expansionSizes: { opened: { width: 730, height: 330 } } } : {}),
    ...(node.id === 'first' ? { layoutMode: 'locked' as const } : node.id === 'second' ? { layoutMode: 'fixed' as const } : {}),
    onToggle() {}, onRename() {}, onRenameCommit() {},
  } }));
};
const workspace = (nodes = working()): CanvasWorkspaceView => ({ version: 2, baselineId: stage.id, baselines: { [stage.id]: { revision: stage.graph.revision!, nodes: captureNodeViews(nodes), edgeRoutes: [], frozenGroups: [], viewport: { x: 81, y: -46, zoom: 0.75 } } } });

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('view capture excludes callbacks, selection and dragging while cloning durable geometry', () => {
  const nodes = working();
  const captured = captureNodeViews(nodes);
  const text = JSON.stringify(captured);
  assert.doesNotMatch(text, /onToggle|onRename|onRenameCommit|selected|dragging/);
  const grouped = captured.find((node) => node.id === 'user-group')!;
  assert.equal(grouped.data.title, '工作分组');
  assert.deepEqual(grouped.data.fitOffset, { x: -12, y: -18 });
  assert.deepEqual(grouped.data.expansionSizes, { opened: { width: 730, height: 330 } });
  const originalX = grouped.position.x;
  nodes.find((node) => node.id === 'user-group')!.position.x += 200;
  assert.equal(grouped.position.x, originalX);
});

test('local storage round trip restores groups, source metadata, layout modes, growth budget and viewport', async () => {
  const storage = createLocalStorageViewStorage(new MemoryStorage());
  assert.equal(await storage.load('workspace'), undefined);
  const original = workspace();
  await storage.save('workspace', original);
  const loaded = (await storage.load('workspace'))!;
  assert.deepEqual(loaded.baselines.main!.viewport, original.baselines.main!.viewport);
  const updated: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'two', nodes: stage.graph.nodes.map((node) => node.id === 'first' ? { ...node, label: '新节点标题', summary: '更新后的来源摘要' } : node) } };
  const restored = restoreNodeViews(baseline(updated), fresh(updated), loaded.baselines.main!.nodes);
  const group = restored.find((node) => node.id === 'user-group')!;
  assert.equal(group.data.title, '工作分组');
  assert.equal(group.data.contentWidth, 730);
  assert.deepEqual(group.data.expansionSizes, { opened: { width: 730, height: 330 } });
  for (const id of ['first', 'second', 'user-group']) assert.deepEqual(restored.find((node) => node.id === id)!.position, original.baselines.main!.nodes.find((node) => node.id === id)!.position);
  assert.equal(restored.find((node) => node.id === 'first')!.data.title, '新节点标题');
  assert.equal(restored.find((node) => node.id === 'first')!.data.summary, '更新后的来源摘要');
  assert.equal(restored.find((node) => node.id === 'first')!.data.layoutMode, 'locked');
  assert.equal(restored.find((node) => node.id === 'second')!.data.layoutMode, 'fixed');
  assert.ok(restored.every((node) => !node.selected && !node.dragging));
  assert.ok(restored.find((node) => node.id === 'first')!.data.groupOrigins?.['user-group'] === 'module');
});

test('source revisions remove deleted IDs and empty groups and introduce free nodes from current source', () => {
  const saved = captureNodeViews(working());
  const revised: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'three', nodes: [...stage.graph.nodes.filter((node) => node.id !== 'first' && node.id !== 'second'), entity('introduced', 'module', 5)] } };
  const restored = restoreNodeViews(baseline(revised), fresh(revised), saved);
  assert.ok(!restored.some((node) => ['first', 'second', 'user-group'].includes(node.id)));
  const introduced = restored.find((node) => node.id === 'introduced')!;
  assert.equal(introduced.parentId, 'module');
  assert.equal(introduced.data.layoutMode ?? 'free', 'free');
  assert.deepEqual(introduced.position, { x: 900, y: 700 });
});

test('source migration rebases retained nodes into a new parent without shifting their world positions', () => {
  const initial = fresh();
  const saved = captureNodeViews(initial);
  const revised: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'reparented', nodes: [...stage.graph.nodes.filter((node) => node.id !== 'module').map((node) => node.parentId === 'module' ? { ...node, parentId: 'introduced' } : node), entity('introduced', 'root', 5)] } };
  const restored = restoreNodeViews(baseline(revised), fresh(revised), saved);
  const retained = restored.find((node) => node.id === 'first')!;
  assert.equal(retained.parentId, 'introduced');
  assert.deepEqual(worldPosition(retained, restored), worldPosition(initial.find((node) => node.id === 'first')!, initial));
});

test('source migration reports a saved manual group that conflicts with new source ancestry', () => {
  const saved = captureNodeViews(working());
  const revised: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'ancestry-changed', nodes: stage.graph.nodes.map((node) => node.id === 'module' ? { ...node, parentId: 'first' } : node.id === 'first' ? { ...node, parentId: 'root' } : node) } };
  assert.throws(() => restoreNodeViews(baseline(revised), fresh(revised), saved), /循环|冲突|层级/);
});

test('surviving source parents do not override a revised canonical ownership relation', () => {
  const initial = fresh(), saved = captureNodeViews(initial);
  const revised: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'existing-parent-changed', nodes: stage.graph.nodes.map((node) => node.id === 'first' ? { ...node, parentId: 'outside' } : node) } };
  const restored = restoreNodeViews(baseline(revised), fresh(revised), saved);
  const first = restored.find((node) => node.id === 'first')!;
  assert.equal(first.parentId, 'outside');
  assert.ok(restored.some((node) => node.id === 'module'));
  assert.deepEqual(worldPosition(first, restored), worldPosition(initial.find((node) => node.id === 'first')!, initial));
});

test('a saved expanded branch becoming a source leaf restores a normal movable card', () => {
  const expanded = toggleHierarchy(fresh(), 'module', stage).map((node) => node.id === 'module' ? { ...node, width: 600, height: 300, data: { ...node.data, layoutMode: 'fixed' as const } } : node);
  const revised: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'branch-to-leaf', nodes: stage.graph.nodes.filter((node) => node.id !== 'first' && node.id !== 'second').map((node) => node.id === 'module' ? { ...node, label: '来源中的叶子节点' } : node) } };
  const restored = restoreNodeViews(baseline(revised), fresh(revised), captureNodeViews(expanded));
  const leaf = restored.find((node) => node.id === 'module')!;
  assert.equal(leaf.type, 'card');
  assert.equal(leaf.data.expanded, false);
  assert.equal(leaf.dragHandle, undefined);
  assert.equal(leaf.width, CARD_SIZE.width);
  assert.equal(leaf.height, CARD_SIZE.height);
  assert.equal(leaf.data.layoutMode, 'fixed');
  assert.equal(leaf.data.title, '来源中的叶子节点');
});

test('one committed geometry action undoes and redoes the whole group and its descendants', () => {
  const original = working();
  const next = original.map((node) => node.id === 'module' || node.id === 'user-group' ? { ...node, position: { x: node.position.x + 160, y: node.position.y + 90 }, width: node.width! + 80 } : node);
  const before = captureContent(original), after = captureContent(next);
  const history = new ViewHistory();
  assert.equal(history.record(before, after), true);
  assert.deepEqual(history.undo(after), before);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(before), after);
  assert.equal(history.canRedo, false);
  assert.equal(history.record(after, captureContent(next.map((node) => ({ ...node, selected: !node.selected })))), false);
});

test('history keeps the newest 100 actions and new changes discard the redo branch', () => {
  const nodes = fresh(), history = new ViewHistory();
  const view = (offset: number) => captureContent(nodes.map((node) => ({ ...node, position: { x: node.position.x + offset, y: node.position.y } })));
  for (let index = 0; index < 105; index++) history.record(view(index), view(index + 1));
  let current = view(105), count = 0;
  while (history.canUndo) { current = history.undo(current); count++; }
  assert.equal(count, 100);
  assert.deepEqual(current, view(5));
  assert.equal(history.canRedo, true);
  history.record(current, view(200));
  assert.equal(history.canRedo, false);
});

test('v1 workspaces migrate into v2 drafts without inventing user confirmation', async () => {
  const memory = new MemoryStorage();
  memory.values.set('workspace', JSON.stringify({ version: 1, baselineId: stage.id, baselines: { [stage.id]: { revision: 'one', nodes: captureNodeViews(fresh()), viewport: { x: 1, y: 2, zoom: 1 } } } }));
  const loaded = (await createLocalStorageViewStorage(memory).load('workspace'))!;
  assert.equal(loaded.version, 2);
  assert.equal(loaded.baselines.main!.confirmedAt, undefined);
  assert.equal(loaded.baselines.main!.confirmed, undefined);
  assert.deepEqual(loaded.baselines.main!.edgeRoutes, []);
  assert.deepEqual(loaded.baselines.main!.frozenGroups, []);
});

test('v2 confirmed snapshots, edge routes and frozen ledgers survive a storage round trip', async () => {
  const storage = createLocalStorageViewStorage(new MemoryStorage());
  const routes = [{ canonicalEdgeId: 'edge:first-second', state: 'locked' as const, source: { nodeId: 'first' }, target: { nodeId: 'second' }, points: [{ x: 10, y: 20 }, { x: 120, y: 20 }], space: { kind: 'world' as const }, endpointFingerprint: 'first>second' }];
  const frozen = [{ id: 'freeze:group', rootId: 'user-group', memberIds: ['first', 'second'], worldBounds: { x: 0, y: 0, w: 400, h: 300 }, boundaryPorts: [], createdAt: '2026-01-01' }];
  const content = captureContent(working(), routes, frozen);
  const view: CanvasWorkspaceView = { version: 2, baselineId: stage.id, baselines: { [stage.id]: { revision: 'one', ...content, confirmedAt: '2026-01-01', confirmed: content, viewport: { x: 1, y: 2, zoom: 1 } } } };
  await storage.save('workspace', view);
  const loaded = (await storage.load('workspace'))!;
  assert.deepEqual(loaded.baselines.main!.edgeRoutes, routes);
  assert.deepEqual(loaded.baselines.main!.frozenGroups, frozen);
  assert.deepEqual(loaded.baselines.main!.confirmed, content);
  assert.equal(loaded.baselines.main!.confirmedAt, '2026-01-01');
});

test('invalid persisted records and storage failures are exposed without replacing the existing record', async () => {
  const memory = new MemoryStorage();
  memory.values.set('workspace', '{broken');
  const storage = createLocalStorageViewStorage(memory);
  await assert.rejects(async () => storage.load('workspace'), SyntaxError);
  assert.equal(memory.values.get('workspace'), '{broken');
  memory.values.set('workspace', JSON.stringify({ version: 1, baselineId: 'main', baselines: { main: { revision: 'one', nodes: [{ id: 'same' }, { id: 'same' }] } } }));
  await assert.rejects(async () => storage.load('workspace'), /重复节点/);
  const quota = new Error('quota exhausted');
  const rejecting = createLocalStorageViewStorage({ getItem: (key) => memory.getItem(key), setItem() { throw quota; } });
  await assert.rejects(async () => rejecting.save('workspace', workspace()), (error) => error === quota);
});

test('persisted geometry rejects non-finite dimensions, zoom and cyclic grouping', async () => {
  const memory = new MemoryStorage(), storage = createLocalStorageViewStorage(memory);
  const text = JSON.stringify(workspace());
  memory.values.set('workspace', text.replace(/"width":[\d.]+/, '"width":1e400'));
  await assert.rejects(async () => storage.load('workspace'), /格式不正确/);
  memory.values.set('workspace', text.replace('"zoom":0.75', '"zoom":1e400'));
  await assert.rejects(async () => storage.load('workspace'), /格式不正确/);
  const cyclic = workspace();
  cyclic.baselines.main!.nodes[0]!.parentId = cyclic.baselines.main!.nodes[0]!.id;
  memory.values.set('workspace', JSON.stringify(cyclic));
  await assert.rejects(async () => storage.load('workspace'), /分组层级/);
});
