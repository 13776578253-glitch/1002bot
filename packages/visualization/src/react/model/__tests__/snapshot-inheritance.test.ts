import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { StageSnapshot } from '../../../core/schema/types.ts';
import { adaptProgressReports, type ReportDataset } from '../../../adapters/progress-reports/index.ts';
import { baselineNodes, createHierarchyNodes, hierarchyProjection } from '../hierarchy.ts';
import { aggregateProjectedEdges } from '../display-edges.ts';
import { captureDisplayRoutes, retainedDisplayRoutes } from '../display-route-snapshots.ts';
import { DiagramRouteCache } from '../route-cache.ts';
import { endpointFingerprint } from '../edge-routes.ts';
import { captureContent, type CanvasBaselineContent, type CanvasNodeView, type DisplayRouteSnapshot, type EdgeRouteSnapshot, type FrozenGroupSnapshot } from '../workspace.ts';
import { captureStageInheritance, mergeStageContent, needsStageRebase } from '../snapshot-inheritance.ts';

const node = (id: string, x: number, parentId?: string): CanvasNodeView => ({ id, type: 'card', position: { x, y: 30 }, width: 100, height: 50, data: { layoutMode: 'free' }, ...(parentId ? { parentId } : {}) });
const baseContent = (): CanvasBaselineContent => ({ nodes: [node('parent', 100), node('child', 20, 'parent'), node('other', 700)], edgeRoutes: [], frozenGroups: [] });
const graph = (): StageSnapshot => ({ id: 'stage', label: 'stage', title: 'stage', track: 'main', order: 1, graph: { rootId: 'root', revision: 'one', nodes: [
  { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
  { id: 'parent', parentId: 'root', kind: 'group', label: 'parent', order: 1, ports: [] },
  { id: 'child', parentId: 'parent', kind: 'component', label: 'child', order: 2, ports: [] },
  { id: 'other', parentId: 'root', kind: 'component', label: 'other', order: 3, ports: [] },
], edges: [{ id: 'link', source: { nodeId: 'child' }, target: { nodeId: 'other' }, relation: 'data', direction: 'directed', order: 0 }] } });
const world = (nodes: CanvasNodeView[], id: string): { x: number; y: number } => {
  const item = nodes.find((value) => value.id === id)!;
  const parent = item.parentId ? world(nodes, item.parentId) : { x: 0, y: 0 };
  return { x: parent.x + item.position.x, y: parent.y + item.position.y };
};

test('inheritance stores an independent base and detects same-revision parent edits', () => {
  const parentContent = baseContent(), targetStage = graph(), targetContent = baseContent();
  const base = captureStageInheritance({ parentId: 'parent-stage', parentRevision: 'r1', parentContent, targetStage, targetContent });
  assert.equal(needsStageRebase(base, { parentId: 'parent-stage', parentRevision: 'r1', parentContent, targetStage }), false);
  parentContent.nodes[0]!.position.x += 30;
  assert.equal(base.parentContent.nodes[0]!.position.x, 100);
  assert.equal(needsStageRebase(base, { parentId: 'parent-stage', parentRevision: 'r1', parentContent, targetStage }), true);
  const persisted = JSON.parse(JSON.stringify(base));
  assert.equal(needsStageRebase(persisted, { parentId: 'parent-stage', parentRevision: 'r1', parentContent: base.parentContent, targetStage }), false);
  assert.equal(needsStageRebase(persisted, { parentId: 'parent-stage', parentRevision: 'r1', parentContent: base.parentContent, targetStage: { ...targetStage, graph: { ...targetStage.graph, revision: 'two' } } }), true);
});

test('parent movement and a disjoint local edit merge using world coordinates', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  local.nodes.find((node) => node.id === 'child')!.data.layoutMode = 'fixed';
  incoming.nodes.find((node) => node.id === 'parent')!.position.x += 80;
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(world(result.content.nodes, 'parent'), { x: 180, y: 30 });
  assert.deepEqual(world(result.content.nodes, 'child'), { x: 200, y: 60 });
  assert.equal(result.content.nodes.find((node) => node.id === 'child')!.data.layoutMode, 'fixed');
});

test('whole-group movement combines with an independent child move without losing either displacement', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  local.nodes.find((node) => node.id === 'parent')!.position.x += 80;
  incoming.nodes.find((node) => node.id === 'child')!.position.x += 25;
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(world(result.content.nodes, 'parent'), { x: 180, y: 30 });
  assert.deepEqual(world(result.content.nodes, 'child'), { x: 225, y: 60 });
});

test('a local new manual group follows its upstream moved parent and retains its child', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  local.nodes.push({ ...node('manual', 40, 'parent'), type: 'cluster', data: { title: 'Group' } });
  local.nodes.find((node) => node.id === 'child')!.parentId = 'manual';
  local.nodes.find((node) => node.id === 'child')!.position = { x: -20, y: 0 };
  incoming.nodes.find((node) => node.id === 'parent')!.position.x += 80;
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(world(result.content.nodes, 'manual'), { x: 220, y: 60 });
  assert.deepEqual(world(result.content.nodes, 'child'), { x: 200, y: 60 });
  assert.deepEqual(result.content.nodes.find((item) => item.id === 'child')!.position, { x: -20, y: 0 });
});

test('an upstream direct move of a target fixed anchor reports a conflict', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  base.nodes[0]!.data.layoutMode = 'fixed';
  local.nodes[0]!.data.layoutMode = 'fixed';
  incoming.nodes[0]!.data.layoutMode = 'fixed';
  incoming.nodes[0]!.position.x += 25;
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.entityIds.includes('parent') && item.message.includes('固定锚点')));
});

test('rebased child coordinates with unchanged world anchor do not appear as a user edit', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  local.nodes.find((node) => node.id === 'parent')!.position.x += 60;
  local.nodes.find((node) => node.id === 'child')!.position.x -= 60;
  incoming.nodes.find((node) => node.id === 'child')!.position.x += 25;
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(world(result.content.nodes, 'child'), { x: 145, y: 60 });
  assert.deepEqual(result.content.nodes.find((node) => node.id === 'child')!.position, { x: -15, y: 30 });
});

test('different concurrent edits to one world anchor fail without mutating input', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  local.nodes[1]!.position.x += 10;
  incoming.nodes[1]!.position.x += 20;
  local.nodes[1]!.data.layoutEdits = { version: 1, position: { ...local.nodes[1]!.position, parentId: 'parent', origin: 'user' } };
  incoming.nodes[1]!.data.layoutEdits = { version: 1, position: { ...incoming.nodes[1]!.position, parentId: 'parent', origin: 'user' } };
  const before = JSON.stringify({ base, local, incoming });
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.entityIds.includes('child') && item.message.includes('位置')));
  assert.equal(JSON.stringify({ base, local, incoming }), before);
});

test('upstream removal of a locally changed or fixed entity reports a conflict', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  local.nodes.find((node) => node.id === 'other')!.data.layoutMode = 'fixed';
  incoming.nodes = incoming.nodes.filter((node) => node.id !== 'other');
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.entityIds.includes('other')));
});

test('disjoint frozen and route edits survive; an incompatible source edge is a conflict', () => {
  const stage = graph(), base = baseContent();
  const route: EdgeRouteSnapshot = { canonicalEdgeId: 'link', state: 'locked', source: { nodeId: 'child' }, target: { nodeId: 'other' }, points: [{ x: 1, y: 2 }, { x: 9, y: 2 }], space: { kind: 'world' }, endpointFingerprint: endpointFingerprint(stage.graph.edges[0]!) };
  const frozen: FrozenGroupSnapshot = { id: 'frozen', rootId: 'parent', memberIds: ['child'], worldBounds: { x: 100, y: 30, w: 250, h: 120 }, boundaryPorts: [], createdAt: 'now' };
  base.edgeRoutes = [route]; base.frozenGroups = [frozen];
  const local = structuredClone(base), incoming = structuredClone(base);
  local.nodes.find((node) => node.id === 'other')!.data.layoutMode = 'fixed';
  const merged = mergeStageContent({ base, local, incoming, targetStage: stage });
  assert.equal(merged.ok, true);
  if (merged.ok) { assert.deepEqual(merged.content.edgeRoutes, [route]); assert.deepEqual(merged.content.frozenGroups, [frozen]); }
  const changed = { ...stage, graph: { ...stage.graph, edges: [{ ...stage.graph.edges[0]!, source: { nodeId: 'parent' } }] } };
  const conflict = mergeStageContent({ base, local, incoming, targetStage: changed });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.ok(conflict.conflicts.some((item) => item.entityIds.includes('link')));
  incoming.nodes = incoming.nodes.filter((item) => item.id !== 'child');
  incoming.frozenGroups = [];
  const removed = mergeStageContent({ base, local, incoming, targetStage: stage });
  assert.equal(removed.ok, false);
  if (!removed.ok) assert.ok(removed.conflicts.some((item) => item.entityIds.includes('frozen')));
});

test('concurrent independent routes merge by canonical identity', () => {
  const stage = graph(), base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  const original = stage.graph.edges[0]!;
  const route: EdgeRouteSnapshot = { canonicalEdgeId: 'link', state: 'pinned', source: original.source, target: original.target, points: [{ x: 1, y: 2 }, { x: 9, y: 2 }], space: { kind: 'world' }, endpointFingerprint: endpointFingerprint(original) };
  local.edgeRoutes.push(route);
  incoming.nodes.push(node('new', 1000));
  const result = mergeStageContent({ base, local, incoming, targetStage: stage });
  assert.equal(result.ok, true);
  if (result.ok) { assert.deepEqual(result.content.edgeRoutes, [route]); assert.ok(result.content.nodes.some((item) => item.id === 'new')); }
});

test('display route source text changes merge with a local geometry edit', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  const route: DisplayRouteSnapshot = { id: 'link', source: 'child', target: 'other', memberIds: ['link'], sourceHandle: 'return-out', targetHandle: 'left-in', points: [{ x: 1, y: 2 }, { x: 30, y: 2 }], label: { x: 15, y: 2, width: 40, height: 18 }, text: '调用', sourceBounds: { x: 0, y: 0, w: 100, h: 50 }, targetBounds: { x: 300, y: 0, w: 100, h: 50 } };
  base.displayRoutes = [structuredClone(route)]; local.displayRoutes = [structuredClone(route)]; incoming.displayRoutes = [structuredClone(route)];
  local.displayRoutes[0]!.label.x += 10;
  incoming.displayRoutes[0]!.text = '调用 · 新增 1';
  incoming.displayRoutes[0]!.memberIds.push('additional-link');
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.content.displayRoutes![0]!.label.x, 25); assert.equal(result.content.displayRoutes![0]!.text, '调用 · 新增 1'); assert.deepEqual(result.content.displayRoutes![0]!.memberIds, ['link', 'additional-link']); }
  incoming.displayRoutes[0]!.points[1]!.x = 80;
  const hints = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(hints.ok, true);
  if (hints.ok) assert.equal(hints.content.displayRoutes![0]!.label.x, 25);
});

test('a locally edited display route is revalidated when upstream locked obstacles change', () => {
  const stage: StageSnapshot = { id: 'one', label: 'one', title: 'one', order: 0, track: 'main', graph: {
    rootId: 'root', nodes: [
      { id: 'root', parentId: null, label: 'root', kind: 'root', order: 0, ports: [] },
      ...['a', 'b'].map((id, order) => ({ id, parentId: 'root', label: id, kind: 'component' as const, order, ports: [] })),
    ], edges: [{ id: 'link', source: { nodeId: 'a' }, target: { nodeId: 'b' }, relation: 'call', direction: 'directed', order: 0 }],
  } };
  const nodes = createHierarchyNodes(stage, { a: { x: 0, y: 0 }, b: { x: 500, y: 0 } });
  const projection = hierarchyProjection(nodes, stage), edges = aggregateProjectedEdges(projection, { link: { kind: 'baseline', label: '基线' } });
  const routes = new DiagramRouteCache().update(nodes, projection, edges);
  const oldBarrier = [{ edgeId: 'locked', points: [{ x: 330, y: -100 }, { x: 330, y: 200 }] }];
  const newBarrier = [{ edgeId: 'locked', points: [{ x: 350, y: -100 }, { x: 350, y: 200 }] }];
  const base = captureContent(nodes), local = structuredClone(base), incoming = structuredClone(base);
  base.displayRoutes = captureDisplayRoutes(nodes, projection, edges, routes, oldBarrier);
  local.displayRoutes = structuredClone(base.displayRoutes);
  local.displayRoutes[0]!.label.x += 10;
  incoming.displayRoutes = captureDisplayRoutes(nodes, projection, edges, routes, newBarrier);
  const result = mergeStageContent({ base, local, incoming, targetStage: stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.content.displayRoutes![0]!.barrierKey, local.displayRoutes[0]!.barrierKey);
  assert.equal(retainedDisplayRoutes(nodes, projection, edges, result.content.displayRoutes, newBarrier).size, 0);
  const unedited = mergeStageContent({ base, local: base, incoming, targetStage: stage });
  assert.equal(unedited.ok, true);
  if (unedited.ok) assert.equal(unedited.content.displayRoutes![0]!.barrierKey, incoming.displayRoutes[0]!.barrierKey);
});

test('derived automatic routes follow upstream while frozen geometry remains protected', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  const route: DisplayRouteSnapshot = { id: 'link', source: 'child', target: 'other', memberIds: ['link'], sourceHandle: 'return-out', targetHandle: 'left-in', points: [{ x: 1, y: 2 }, { x: 30, y: 2 }], label: { x: 15, y: 2, width: 40, height: 18 }, text: '调用', sourceBounds: { x: 0, y: 0, w: 100, h: 50 }, targetBounds: { x: 300, y: 0, w: 100, h: 50 } };
  base.displayRoutes = [structuredClone(route)]; local.displayRoutes = [structuredClone(route)]; incoming.displayRoutes = [structuredClone(route)];
  incoming.displayRoutes[0]!.points[1]!.x += 30;
  const hints = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(hints.ok, true);
  if (hints.ok) assert.deepEqual(hints.content.displayRoutes![0]!.points, incoming.displayRoutes[0]!.points);
  incoming.displayRoutes = [structuredClone(route)];
  const frozen: FrozenGroupSnapshot = { id: 'frozen', rootId: 'parent', memberIds: ['child'], worldBounds: { x: 100, y: 30, w: 250, h: 120 }, boundaryPorts: [], createdAt: 'now' };
  base.frozenGroups = [structuredClone(frozen)]; local.frozenGroups = [structuredClone(frozen)]; incoming.frozenGroups = [structuredClone(frozen)];
  incoming.frozenGroups[0]!.worldBounds.w += 20;
  const frozenConflict = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(frozenConflict.ok, false);
  if (!frozenConflict.ok) assert.ok(frozenConflict.conflicts.some((item) => item.entityIds.includes('frozen')));
});

test('frozen ledger capture-time worldBounds translation is not mistaken for an internal edit', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  const frozen: FrozenGroupSnapshot = { id: 'frozen', rootId: 'parent', memberIds: ['child'], worldBounds: { x: 100, y: 30, w: 250, h: 120 }, protectedFrame: { x: 0, y: 0, width: 250, height: 120 }, boundaryPorts: [], createdAt: 'now' };
  base.frozenGroups = [structuredClone(frozen)]; local.frozenGroups = [structuredClone(frozen)]; incoming.frozenGroups = [structuredClone(frozen)];
  incoming.frozenGroups[0]!.worldBounds.x += 80;
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.content.frozenGroups[0]!.protectedFrame, frozen.protectedFrame);
});

test('independent frozen additions cannot merge into overlapping ownership', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  const frame = { x: 100, y: 30, w: 250, h: 120 };
  local.frozenGroups = [{ id: 'outer', rootId: 'parent', memberIds: ['child'], worldBounds: frame, boundaryPorts: [], createdAt: 'now' }];
  incoming.frozenGroups = [{ id: 'inner', rootId: 'child', memberIds: [], worldBounds: frame, boundaryPorts: [], createdAt: 'now' }];
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.message.includes('重叠')));
});

test('temporarily hidden display paths survive a rebase while their canonical edge exists', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  const route: DisplayRouteSnapshot = { id: 'link', source: 'child', target: 'other', memberIds: ['link'], sourceHandle: 'return-out', targetHandle: 'left-in', points: [{ x: 1, y: 2 }, { x: 30, y: 2 }], label: { x: 15, y: 2, width: 40, height: 18 }, text: '调用', sourceBounds: { x: 0, y: 0, w: 100, h: 50 }, targetBounds: { x: 300, y: 0, w: 100, h: 50 } };
  base.displayRoutes = [structuredClone(route)]; local.displayRoutes = [structuredClone(route)]; incoming.displayRoutes = [];
  const hidden = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(hidden.ok, true);
  if (hidden.ok) assert.deepEqual(hidden.content.displayRoutes, [route]);
  const stage = graph();
  const deleted = mergeStageContent({ base, local, incoming, targetStage: { ...stage, graph: { ...stage.graph, edges: [] } } });
  assert.equal(deleted.ok, true);
  if (deleted.ok) assert.deepEqual(deleted.content.displayRoutes, []);
});

test('real report baseline merges independent local and upstream node movements', () => {
  const dataset = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/legacy-reports.json', import.meta.url), 'utf8')) as ReportDataset;
  const [, second] = adaptProgressReports(dataset);
  const base = captureContent(baselineNodes(second!));
  const local = structuredClone(base), incoming = structuredClone(base);
  const roots = base.nodes.filter((item) => !item.parentId);
  assert.ok(roots.length >= 2);
  local.nodes.find((node) => node.id === roots[0]!.id)!.position.x += 30;
  incoming.nodes.find((node) => node.id === roots[1]!.id)!.position.y += 40;
  const result = mergeStageContent({ base, local, incoming, targetStage: second!.stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(world(result.content.nodes, roots[0]!.id).x, roots[0]!.position.x + 30);
  assert.equal(world(result.content.nodes, roots[1]!.id).y, roots[1]!.position.y + 40);
});

test('source additions, removals and replacements merge when the old target entity was not edited', () => {
  const base = baseContent(), local = structuredClone(base), incoming = structuredClone(base);
  const old = incoming.nodes.find((node) => node.id === 'other')!;
  incoming.nodes = incoming.nodes.filter((node) => node.id !== 'other');
  incoming.nodes.push({ ...old, id: 'replacement' }, node('new', 900));
  const stage = graph();
  const revised = { ...stage, graph: { ...stage.graph, revision: 'two', nodes: [...stage.graph.nodes.filter((item) => item.id !== 'other'), { id: 'replacement', parentId: 'root', kind: 'component' as const, label: 'replacement', order: 3, ports: [] }, { id: 'new', parentId: 'root', kind: 'component' as const, label: 'new', order: 4, ports: [] }], edges: [] } };
  const result = mergeStageContent({ base, local, incoming, targetStage: revised });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.content.nodes.some((item) => item.id === 'other'), false);
    assert.deepEqual(world(result.content.nodes, 'replacement'), world(base.nodes, 'other'));
    assert.equal(result.content.nodes.some((item) => item.id === 'new'), true);
  }
  local.nodes.find((item) => item.id === 'other')!.position.x += 10;
  const edited = mergeStageContent({ base, local, incoming, targetStage: revised });
  assert.equal(edited.ok, false);
});

test('individually valid reparentings that combine into a cycle report a conflict', () => {
  const base: CanvasBaselineContent = { nodes: [node('a', 100), node('b', 400)], edgeRoutes: [], frozenGroups: [] };
  const local = structuredClone(base), incoming = structuredClone(base);
  local.nodes[0] = { ...local.nodes[0]!, parentId: 'b', position: { x: -300, y: 0 } };
  incoming.nodes[1] = { ...incoming.nodes[1]!, parentId: 'a', position: { x: 300, y: 0 } };
  const result = mergeStageContent({ base, local, incoming, targetStage: graph() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.message.includes('循环')));
});
