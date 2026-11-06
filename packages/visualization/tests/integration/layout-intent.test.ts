import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptProject, resolveSourceStages, type ArchitectureProject, type ProjectManifest, type ProjectSourceCatalog, type ProjectStageSelection, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import type { StageSnapshot } from '../../src/core/schema/types.ts';
import { baselineNodes, toggleHierarchy } from '../../src/react/model/layout/hierarchy.ts';
import { contentPosition, recordPositionEdits, recordSizeEdits } from '../../src/react/model/layout/layout-intent.ts';
import { worldPosition, type CanvasNode } from '../../src/react/model/layout/node.ts';
import { endpointFingerprint } from '../../src/react/model/routing/edge-routes.ts';
import { mergeStageContent } from '../../src/react/model/stages/snapshot-inheritance.ts';
import { prepareStageNavigation } from '../../src/react/model/stages/stage-navigation.ts';
import { captureContent, restoreNodeViews } from '../../src/react/model/workspace/workspace.ts';
import { ViewHistory } from '../../src/react/model/workspace/history.ts';
import { type CanvasBaselineContent, type CanvasBaselineView, type CanvasWorkspaceView } from '../../src/react/model/contracts/snapshot-types.ts';
import { createProjectViewStorage } from '../../src/react/persistence/project-storage.ts';

const node = (id: string, x: number, y: number, parentId?: string): CanvasNode => ({
  id, type: 'card', position: { x, y }, width: 240, height: 82,
  ...(parentId ? { parentId } : {}), data: { title: id, layoutMode: 'free', layoutEdits: { version: 1 } },
});
const nodeView = (content: CanvasBaselineContent, id: string) => content.nodes.find((item) => item.id === id)!;
const graph: StageSnapshot = { id: 'stage', label: 'stage', title: 'stage', track: 'main', order: 1, graph: {
  rootId: 'root', nodes: [
    { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
    { id: 'parent', parentId: 'root', kind: 'group', label: 'parent', order: 1, ports: [] },
    { id: 'child', parentId: 'parent', kind: 'component', label: 'child', order: 2, ports: [] },
    { id: 'other', parentId: 'root', kind: 'component', label: 'other', order: 3, ports: [] },
  ], edges: [{ id: 'link', source: { nodeId: 'child' }, target: { nodeId: 'other' }, relation: 'data', direction: 'directed', order: 0 }],
} };
const content = (): CanvasBaselineContent => captureContent([
  { ...node('parent', 100, 100), type: 'structure', width: 500, height: 300, data: { title: 'parent', expanded: true, layoutEdits: { version: 1 } } },
  node('child', 24, 100, 'parent'), node('other', 900, 100),
]);
const userMove = (item: CanvasBaselineContent['nodes'][number], x: number, y: number) => {
  item.position = { x, y };
  item.data.layoutEdits = { ...item.data.layoutEdits, version: 1, position: { x, y, ...(item.parentId ? { parentId: item.parentId } : {}), origin: 'user' } };
};

function runtimeBaselines() {
  const directory = new URL('../../datasets/projects/runtime-evolution/', import.meta.url);
  const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, directory), 'utf8')) as T;
  const manifest = read<ProjectManifest>('project.json');
  const project: ArchitectureProject = {
    version: 1, id: manifest.id, title: manifest.title, revision: manifest.revision,
    source: { stages: resolveSourceStages(manifest.source.map((path) => read<ProjectSourceCatalog>(path)), manifest.stages.map((path) => read<ProjectStageSelection>(path))) },
    views: manifest.views.map((path) => read<ProjectViewDefinition>(path)),
  };
  return adaptProject(project);
}

test('ancestor refitting compensates local coordinates without inventing a child drag', () => {
  const before = [
    { ...node('parent', 100, 100), type: 'structure', data: { title: 'parent', expanded: true, layoutEdits: { version: 1 as const } } },
    node('child', 40, 100, 'parent'),
  ];
  const fitted = [
    { ...before[0]!, position: { x: 80, y: 70 }, data: { ...before[0]!.data, fitOffset: { x: -20, y: -30 } } },
    { ...before[1]!, position: { x: 60, y: 130 } },
  ];
  assert.deepEqual(contentPosition(before[1]!, before), contentPosition(fitted[1]!, fitted));
  assert.equal(recordPositionEdits(before, fitted, ['child'])[1]!.data.layoutEdits!.position, undefined);
  const moved = fitted.map((item) => item.id === 'parent' ? { ...item, position: { x: item.position.x + 60, y: item.position.y } } : item);
  const recorded = recordPositionEdits(fitted, moved, ['parent', 'child']);
  assert.equal(recorded[0]!.data.layoutEdits!.position!.origin, 'user');
  assert.equal(recorded[1]!.data.layoutEdits!.position, undefined);
  assert.deepEqual(contentPosition(recorded[1]!, recorded), contentPosition(before[1]!, before));
});

test('explicit move and resize intents round-trip through workspace restore', () => {
  const [baseline] = runtimeBaselines();
  const before = baselineNodes(baseline!);
  const moved = before.map((item) => item.id === 'world' ? { ...item, position: { x: item.position.x - 100, y: item.position.y + 40 } } : item);
  const withMove = recordPositionEdits(before, moved, ['world']);
  const resized = withMove.map((item) => item.id === 'world' ? { ...item, width: item.width! + 70, height: item.height! + 35 } : item);
  const edited = recordSizeEdits(withMove, resized, ['world']);
  const saved = captureContent(edited);
  const restored = restoreNodeViews(baseline!, baselineNodes(baseline!), JSON.parse(JSON.stringify(saved.nodes)));
  const result = restored.find((item) => item.id === 'world')!;
  assert.equal(result.data.layoutEdits!.position!.origin, 'user');
  assert.deepEqual(result.data.layoutEdits!.sizes!.collapsed, { width: 310, height: 115, origin: 'user' });
  assert.deepEqual(result.position, resized.find((item) => item.id === 'world')!.position);
});

test('a user-sized collapsed card retains its dimensions after expand and collapse', () => {
  const [baseline] = runtimeBaselines();
  const before = baselineNodes(baseline!);
  const resized = before.map((item) => item.id === 'world' ? { ...item, width: 360, height: 106 } : item);
  const edited = recordSizeEdits(before, resized, ['world']);
  const expanded = toggleHierarchy(edited, 'world', baseline!.stage);
  assert.notEqual(expanded, edited);
  assert.equal(expanded.find((item) => item.id === 'world')!.data.expanded, true);
  const collapsed = toggleHierarchy(expanded, 'world', baseline!.stage);
  assert.notEqual(collapsed, expanded);
  const world = collapsed.find((item) => item.id === 'world')!;
  assert.deepEqual({ width: world.width, height: world.height }, { width: 360, height: 106 });
  assert.deepEqual(world.data.layoutEdits!.sizes!.collapsed, { width: 360, height: 106, origin: 'user' });

  const expandedAgain = toggleHierarchy(collapsed, 'world', baseline!.stage);
  const collapsedAgain = toggleHierarchy(expandedAgain, 'world', baseline!.stage);
  assert.deepEqual(collapsedAgain.find((item) => item.id === 'world')!.width, 360);
  assert.deepEqual(collapsedAgain.find((item) => item.id === 'world')!.height, 106);

  const largerCollapsed = collapsedAgain.map((item) => item.id === 'world' ? { ...item, width: 400, height: 120 } : item);
  const resizedCollapsed = recordSizeEdits(collapsedAgain, largerCollapsed, ['world']);
  const history = new ViewHistory();
  const previous = captureContent(collapsedAgain);
  const next = captureContent(resizedCollapsed);
  assert.equal(history.record(previous, next), true);
  assert.deepEqual(history.undo(next), previous);
  assert.deepEqual(history.redo(previous), next);

  const expandedResized = toggleHierarchy(resizedCollapsed, 'world', baseline!.stage);
  const collapsedResized = toggleHierarchy(expandedResized, 'world', baseline!.stage);
  assert.deepEqual(collapsedResized.find((item) => item.id === 'world')!.width, 400);
  assert.deepEqual(collapsedResized.find((item) => item.id === 'world')!.height, 120);
});

test('resize requests leave frozen and locked nodes unchanged', () => {
  for (const data of [{ frozen: true }, { layoutMode: 'locked' as const }]) {
    const before = [{ ...node('other', 10, 20), data: { ...node('other', 10, 20).data, ...data } }];
    const resized = [{ ...before[0]!, width: 400, height: 160 }];
    assert.deepEqual(recordSizeEdits(before, resized, ['other']), before);
  }
});

test('divergent automatic parent fits merge without moving the child anchor', () => {
  const base = content(), local = structuredClone(base), incoming = structuredClone(base);
  const fit = (target: CanvasBaselineContent, offset: number, width: number) => {
    const frame = nodeView(target, 'parent'), child = nodeView(target, 'child');
    frame.position.x -= offset; frame.width = width; frame.data.fitOffset = { x: -offset, y: 0 };
    child.position.x += offset;
  };
  fit(local, 20, 540); fit(incoming, 40, 580);
  const originals = structuredClone({ base, local, incoming });
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.conflicts));
  if (result.ok) assert.deepEqual(contentPosition(nodeView(result.content, 'child'), result.content.nodes), { x: 24, y: 100 });
  assert.deepEqual({ base, local, incoming }, originals);
});

test('legacy geometry of ambiguous origin retains the target draft without a false manual conflict', () => {
  const base = content(), local = structuredClone(base), incoming = structuredClone(base);
  for (const snapshot of [base, local, incoming]) for (const item of snapshot.nodes) delete item.data.layoutEdits;
  nodeView(local, 'other').position.x = 1050;
  nodeView(incoming, 'other').position.x = 1150;
  nodeView(local, 'parent').width = 600;
  nodeView(incoming, 'parent').width = 700;
  const originals = structuredClone({ base, local, incoming });
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.conflicts));
  if (result.ok) {
    assert.equal(nodeView(result.content, 'other').position.x, 1050);
    assert.ok(nodeView(result.content, 'parent').width >= 600);
  }
  assert.deepEqual({ base, local, incoming }, originals);
});

test('opposing explicit user moves conflict atomically', () => {
  const base = content(), local = structuredClone(base), incoming = structuredClone(base);
  userMove(nodeView(local, 'other'), 1000, 100);
  userMove(nodeView(incoming, 'other'), 1100, 100);
  const originals = structuredClone({ base, local, incoming });
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.entityIds.includes('other')));
  assert.deepEqual({ base, local, incoming }, originals);
});

test('the same user anchor on both branches overrides differing automatic frame positions', () => {
  const base = content();
  userMove(nodeView(base, 'other'), 950, 100);
  const local = structuredClone(base), incoming = structuredClone(base);
  nodeView(local, 'other').position.x = 1010;
  nodeView(incoming, 'other').position.x = 1110;
  const originals = structuredClone({ base, local, incoming });
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.conflicts));
  if (result.ok) {
    assert.equal(nodeView(result.content, 'other').position.x, 950);
    assert.deepEqual(nodeView(result.content, 'other').data.layoutEdits!.position, { x: 950, y: 100, origin: 'user' });
  }
  assert.deepEqual({ base, local, incoming }, originals);
});

test('an upstream user move wins over unedited known-format automatic frame variation', () => {
  const base = content(), local = structuredClone(base), incoming = structuredClone(base);
  nodeView(local, 'other').position.x = 1000;
  userMove(nodeView(incoming, 'other'), 1100, 100);
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.conflicts));
  if (result.ok) {
    assert.equal(nodeView(result.content, 'other').position.x, 1100);
    assert.equal(nodeView(result.content, 'other').data.layoutEdits!.position!.origin, 'user');
  }
});

test('opposing explicit user size edits conflict without changing the snapshots', () => {
  const base = content(), local = structuredClone(base), incoming = structuredClone(base);
  for (const [snapshot, width] of [[local, 650], [incoming, 720]] as const) {
    const parent = nodeView(snapshot, 'parent');
    parent.width = width;
    parent.data.layoutEdits = { version: 1, sizes: { expanded: { width, height: 300, origin: 'user' } } };
  }
  const originals = structuredClone({ base, local, incoming });
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.entityIds.includes('parent')));
  assert.deepEqual({ base, local, incoming }, originals);
});

test('frozen structure and locked path survive unrelated geometry; conflicting frozen size is rejected', () => {
  const base = content();
  nodeView(base, 'parent').data.frozen = true;
  nodeView(base, 'child').data.frozen = true;
  base.frozenGroups = [{ id: 'frozen-parent', rootId: 'parent', memberIds: ['child'], worldBounds: { x: 100, y: 100, w: 500, h: 300 }, boundaryPorts: [], createdAt: '2026-11-03T00:00:00Z', frozenFrames: { parent: { width: 500, height: 300 }, child: { width: 240, height: 82 } } }];
  base.edgeRoutes = [{ canonicalEdgeId: 'link', state: 'locked', source: { nodeId: 'child' }, target: { nodeId: 'other' }, space: { kind: 'world' }, endpointFingerprint: endpointFingerprint(graph.graph.edges[0]!), points: [{ x: 364, y: 241 }, { x: 900, y: 241 }] }];
  const local = structuredClone(base), incoming = structuredClone(base);
  nodeView(local, 'other').width = 260; nodeView(incoming, 'other').width = 280;
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.conflicts));
  if (result.ok) {
    assert.deepEqual(result.content.frozenGroups, base.frozenGroups);
    assert.deepEqual(result.content.edgeRoutes, base.edgeRoutes);
  }
  nodeView(incoming, 'parent').data.layoutEdits = { version: 1, sizes: { expanded: { width: 600, height: 300, origin: 'user' } } };
  const originals = structuredClone({ base, local, incoming });
  const blocked = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.conflicts.some((item) => item.entityIds.includes('parent')));
  assert.deepEqual({ base, local, incoming }, originals);
});

test('adding matching legacy size metadata does not change an unchanged frozen frame', () => {
  const base = content();
  nodeView(base, 'parent').data.frozen = true;
  nodeView(base, 'child').data.frozen = true;
  base.frozenGroups = [{ id: 'frozen-parent', rootId: 'parent', memberIds: ['child'], worldBounds: { x: 100, y: 100, w: 500, h: 300 }, boundaryPorts: [], createdAt: '2026-11-03T00:00:00Z', frozenFrames: { parent: { width: 500, height: 300 }, child: { width: 240, height: 82 } } }];
  const local = structuredClone(base), incoming = structuredClone(base);
  nodeView(incoming, 'parent').data.layoutEdits = { version: 1, sizes: { expanded: { width: 500, height: 300, origin: 'legacy' } } };
  const result = mergeStageContent({ base, local, incoming, targetStage: graph });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.conflicts));
  if (result.ok) {
    assert.deepEqual(result.content.frozenGroups, base.frozenGroups);
    assert.deepEqual({ width: nodeView(result.content, 'parent').width, height: nodeView(result.content, 'parent').height }, { width: 500, height: 300 });
  }
});

test('legacy confirmation and checkpoint remain identical after saving a new intent-bearing draft', async () => {
  const values = new Map<string, string>();
  const storage = createProjectViewStorage({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, 'example');
  const legacy = content(); for (const item of legacy.nodes) delete item.data.layoutEdits;
  const workspace: CanvasWorkspaceView = { version: 2, baselineId: 'M1', baselines: { M1: { revision: 'one', ...structuredClone(legacy), confirmed: structuredClone(legacy), confirmationId: 'confirmation-1', confirmedAt: '2026-11-03T01:00:00Z' } } };
  await storage.save('workspace', workspace);
  const originalText = values.get('workspace')!;
  const original = JSON.parse(originalText);
  const changed = structuredClone(legacy);
  userMove(nodeView(changed, 'other'), 1000, 100);
  const history = new ViewHistory();
  assert.equal(history.record(legacy, changed), true);
  assert.deepEqual(history.undo(changed), legacy);
  assert.deepEqual(history.redo(legacy), changed);
  await storage.save('workspace', { ...workspace, baselines: { M1: { ...workspace.baselines.M1!, ...changed } } });
  const actual = JSON.parse(values.get('workspace')!);
  assert.equal(values.get('workspace:before-layout-intent-v1'), originalText);
  assert.deepEqual(actual.stages.M1.confirmed, original.stages.M1.confirmed);
  assert.deepEqual(actual.stages.M1.checkpoints, original.stages.M1.checkpoints);
  const restored = (await storage.load('workspace'))!;
  assert.deepEqual(restored.baselines.M1!.nodes, changed.nodes);
  assert.deepEqual(restored.baselines.M1!.confirmed, legacy);
  await storage.save('workspace', { ...workspace, baselines: { M1: { ...workspace.baselines.M1!, ...legacy } } });
  assert.equal(values.get('workspace:before-layout-intent-v1'), originalText);
});

test('invalid persisted intent is rejected without replacing the existing workspace', async () => {
  const values = new Map<string, string>();
  const storage = createProjectViewStorage({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, 'example');
  const workspace: CanvasWorkspaceView = { version: 2, baselineId: 'M1', baselines: { M1: { revision: 'one', ...content() } } };
  await storage.save('workspace', workspace);
  const original = values.get('workspace');
  const invalid = structuredClone(workspace);
  nodeView(invalid.baselines.M1!, 'parent').data.layoutEdits = { version: 1, sizes: { expanded: { width: -1, height: 300, origin: 'user' } } };
  await assert.rejects(async () => storage.save('workspace', invalid), /布局尺寸编辑格式不正确/);
  assert.equal(values.get('workspace'), original);
});

test('real M1 and M2 rebase preserves a fixed target position and expanded container', () => {
  const [m1, m2] = runtimeBaselines();
  const originalParent = captureContent(baselineNodes(m1!));
  const first = prepareStageNavigation({ parent: m1!, target: m2!, parentContent: originalParent });
  assert.equal(first.ok, true, first.ok ? '' : JSON.stringify(first.conflicts));
  if (!first.ok) return;
  const expanded = toggleHierarchy(first.state.nodes, 'world', m2!.stage);
  assert.notEqual(expanded, first.state.nodes);
  const moved = expanded.map((item) => item.id === 'world' ? { ...item, position: { x: item.position.x - 100, y: item.position.y + 100 }, data: { ...item.data, layoutMode: 'fixed' as const } } : item);
  const edited = recordPositionEdits(expanded, moved, ['world']);
  const draft = captureContent(edited, first.state.edgeRoutes, first.state.frozenGroups);
  const fixedBefore = worldPosition(edited.find((item) => item.id === 'world')!, edited);
  const saved: CanvasBaselineView = { ...draft, revision: m2!.stage.graph.revision ?? m2!.stage.id, inheritance: first.inheritance!, sourceStage: m2!.stage, confirmed: structuredClone(first.content) };
  const parentUpdate = structuredClone(originalParent);
  userMove(nodeView(parentUpdate, 'event-caller'), 440, -76);
  const originals = structuredClone({ saved, parentUpdate });
  const result = prepareStageNavigation({ parent: m1!, target: m2!, parentContent: parentUpdate, saved });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.conflicts));
  if (result.ok) {
    const world = result.state.nodes.find((item) => item.id === 'world')!;
    const fixture = result.state.nodes.find((item) => item.id === 'fixture-world')!;
    assert.deepEqual(worldPosition(world, result.state.nodes), fixedBefore);
    assert.equal(world.data.layoutMode, 'fixed');
    assert.equal(world.data.expanded, true);
    assert.ok(fixture.position.x >= 0 && fixture.position.y >= 0);
    assert.ok(fixture.position.x + fixture.width! <= world.width! && fixture.position.y + fixture.height! <= world.height!);
  }
  assert.deepEqual({ saved, parentUpdate }, originals);
});

for (const origin of ['user', 'legacy', 'mixed'] as const) {
  test(`real M2 rebase keeps the ${origin} expanded size preference while deriving the container`, () => {
    const [m1, m2] = runtimeBaselines();
    const parentContent = captureContent(baselineNodes(m1!));
    const initial = prepareStageNavigation({ parent: m1!, target: m2!, parentContent });
    assert.equal(initial.ok, true, initial.ok ? '' : JSON.stringify(initial.conflicts));
    if (!initial.ok) return;
    const expanded = toggleHierarchy(initial.state.nodes, 'world', m2!.stage);
    assert.notEqual(expanded, initial.state.nodes);
    const larger = expanded.map((item) => item.id === 'world' ? { ...item, width: 700, height: 500 } : item);
    const intended = recordSizeEdits(expanded, larger, ['world']);
    const draft = captureContent(intended, initial.state.edgeRoutes, initial.state.frozenGroups);
    if (origin !== 'user') {
      for (const item of draft.nodes) delete item.data.layoutEdits;
    }
    const saved: CanvasBaselineView = { ...draft, revision: m2!.stage.graph.revision ?? m2!.stage.id, inheritance: initial.inheritance!, sourceStage: m2!.stage, confirmed: structuredClone(initial.content) };
    const nextParent = structuredClone(parentContent);
    if (origin === 'legacy') {
      for (const snapshot of [saved.confirmed!, saved.inheritance!.parentContent, saved.inheritance!.targetContent, nextParent]) {
        for (const item of snapshot.nodes) delete item.data.layoutEdits;
      }
    }
    userMove(nodeView(nextParent, 'event-caller'), 440, -76);
    const originals = structuredClone({ saved, nextParent });
    const result = prepareStageNavigation({ parent: m1!, target: m2!, parentContent: nextParent, saved });
    assert.equal(result.ok, true, result.ok ? '' : JSON.stringify({ conflicts: result.conflicts, local: saved.nodes.filter((item) => ['runtime', 'world'].includes(item.id)), base: initial.inheritance!.targetContent.nodes.filter((item) => ['runtime', 'world'].includes(item.id)), nodes: result.candidate.nodes.filter((item) => ['runtime', 'world'].includes(item.id)).map((item) => ({ id: item.id, position: item.position, width: item.width, height: item.height, fitOffset: item.data.fitOffset, edits: item.data.layoutEdits })) }));
    if (result.ok) {
      const world = result.state.nodes.find((item) => item.id === 'world')!;
      assert.equal(world.data.expanded, true);
      assert.ok(world.width! >= 700 && world.height! >= 500, `derived world size ${world.width} × ${world.height} should preserve the stored preference`);
      assert.equal(world.data.layoutEdits!.sizes!.expanded!.origin, origin === 'user' ? 'user' : 'legacy');
    }
    assert.deepEqual({ saved, nextParent }, originals);
  });
}
