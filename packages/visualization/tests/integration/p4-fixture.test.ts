import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptProject } from '../../src/adapters/project/index.ts';
import { baselineNodes } from '../../src/react/model/layout/hierarchy.ts';
import { p4Project } from '../fixtures/project-p4.ts';
import { buildP4Content } from '../fixtures/p4-content.ts';
import { restoreFrozenGroups } from '../../src/react/model/freeze/frozen.ts';
import { restoreNodeViews } from '../../src/react/model/workspace/workspace.ts';
import { ViewHistory } from '../../src/react/model/workspace/history.ts';
import { type CanvasWorkspaceView } from '../../src/react/model/contracts/snapshot-types.ts';
import { worldPosition } from '../../src/react/model/layout/node.ts';
import { planStageTransition } from '../../src/react/model/stages/stage-transition.ts';
import { prepareStageNavigation } from '../../src/react/model/stages/stage-navigation.ts';
import { createProjectViewStorage } from '../../src/react/persistence/project-storage.ts';

const baselines = adaptProject(p4Project);
const at = (nodes: ReturnType<typeof baselineNodes>, id: string) => worldPosition(nodes.find((node) => node.id === id)!, nodes);

test('P4 fixture adapts three stages with nested containers and added relations', () => {
  assert.deepEqual(baselines.map((item) => item.id), ['s0', 's1', 's2']);
  assert.deepEqual(baselines.map((item) => item.previousStageId), [undefined, 's0', 's1']);
  assert.deepEqual(baselines.map((item) => item.stage.graph.edges.length), [3, 4, 5]);
  assert.equal(baselines[1]!.nodeChanges['archive-view']?.kind, 'added');
  assert.equal(baselines[2]!.edgeChanges['read-view']?.kind, 'added');
  const nodes = baselineNodes(baselines[0]!);
  assert.deepEqual(nodes.filter((node) => ['engine-view', 'inner-view', 'worker-view'].includes(node.id)).map((node) => [node.id, node.type, node.parentId]), [
    ['engine-view', 'structure', undefined],
    ['inner-view', 'structure', 'engine-view'],
    ['worker-view', 'card', 'inner-view'],
  ]);
});

test('P4 fixture carries pinned, locked and frozen state through content restore', () => {
  const fixture = buildP4Content();
  assert.ok(fixture.content.edgeRoutes.some((route) => route.canonicalEdgeId === 'invoke-view' && route.state === 'pinned'));
  assert.ok(fixture.content.edgeRoutes.some((route) => route.canonicalEdgeId === 'persist-view' && route.state === 'locked'));
  assert.deepEqual(fixture.content.frozenGroups.map((group) => group.id), ['freeze:inner']);
  assert.ok(fixture.content.displayRoutes?.length);
  const restored = restoreNodeViews(fixture.baseline, baselineNodes(fixture.baseline), fixture.content.nodes);
  const frozen = restoreFrozenGroups(restored, fixture.content.frozenGroups);
  assert.deepEqual(frozen.conflicts, []);
  assert.equal(frozen.nodes.find((node) => node.id === 'inner-view')!.data.frozen, true);
  assert.equal(frozen.nodes.find((node) => node.id === 'worker-view')!.data.layoutMode, 'locked');
});

test('P4 stage transitions preserve manual/frozen paths and anchors, then add the next relation', () => {
  const fixture = buildP4Content();
  const before = structuredClone(fixture.content);
  const first = planStageTransition({ source: baselines[0]!, target: baselines[1]!, sourceContent: fixture.content });
  assert.equal(first.ok, true, first.ok ? '' : JSON.stringify(first.conflicts));
  if (!first.ok) return;
  assert.ok(first.state.edgeRoutes.some((route) => route.canonicalEdgeId === 'invoke-view' && route.state === 'pinned'));
  assert.ok(first.state.edgeRoutes.some((route) => route.canonicalEdgeId === 'persist-view' && route.state === 'locked'));
  assert.deepEqual(first.state.frozenGroups.map((group) => group.id), ['freeze:inner']);
  for (const id of ['actor-view', 'engine-view', 'inner-view', 'worker-view', 'store-view']) {
    assert.deepEqual(at(first.state.nodes, id), at(fixture.nodes, id), `anchor ${id}`);
  }
  assert.ok(first.state.nodes.some((node) => node.id === 'archive-view'));
  assert.deepEqual(fixture.content, before, 'failed or successful planning must not mutate source content');

  const second = planStageTransition({ source: baselines[1]!, target: baselines[2]!, sourceContent: first.content });
  assert.equal(second.ok, true, second.ok ? '' : JSON.stringify(second.conflicts));
  if (!second.ok) return;
  assert.ok(second.state.nodes.some((node) => node.id === 'cache-view'));
  assert.ok(second.content.displayRoutes?.some((route) => route.id === 'read-view') ?? false);
  assert.deepEqual(second.state.frozenGroups.map((group) => group.id), ['freeze:inner']);
  for (const id of ['actor-view', 'engine-view', 'inner-view', 'worker-view', 'store-view', 'archive-view']) {
    assert.deepEqual(at(second.state.nodes, id), at(first.state.nodes, id), `anchor ${id}`);
  }
});

test('P4 transition conflict is atomic when a frozen member disappears', () => {
  const fixture = buildP4Content();
  const target = structuredClone(baselines[1]!);
  target.stage.graph.nodes = target.stage.graph.nodes.filter((node) => !['inner-view', 'worker-view'].includes(node.id));
  target.stage.graph.edges = target.stage.graph.edges.filter((edge) => edge.id !== 'execute-view');
  const before = JSON.stringify(fixture.content);
  const result = planStageTransition({ source: baselines[0]!, target, sourceContent: fixture.content });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(fixture.content), before);
});

test('P4 stage inheritance reuses a saved nested/frozen view and rejects divergent edits atomically', () => {
  const fixture = buildP4Content();
  const first = prepareStageNavigation({ parent: baselines[0]!, target: baselines[1]!, parentContent: fixture.content });
  assert.equal(first.ok, true, first.ok ? '' : JSON.stringify(first.conflicts));
  if (!first.ok) return;
  const saved = {
    ...structuredClone(first.content),
    revision: baselines[1]!.stage.graph.revision ?? baselines[1]!.stage.id,
    inheritance: first.inheritance!,
    sourceStage: baselines[1]!.stage,
  };
  const reused = prepareStageNavigation({ parent: baselines[0]!, target: baselines[1]!, parentContent: fixture.content, saved });
  assert.equal(reused.ok, true);
  assert.equal(reused.ok && reused.reused, true);
  const local = structuredClone(saved);
  local.nodes.find((node) => node.id === 'engine-view')!.position.x += 24;
  const incoming = structuredClone(fixture.content);
  incoming.nodes.find((node) => node.id === 'engine-view')!.position.x -= 24;
  const before = structuredClone(local);
  const conflict = prepareStageNavigation({ parent: baselines[0]!, target: baselines[1]!, parentContent: incoming, saved: local });
  assert.equal(conflict.ok, false);
  assert.deepEqual(local, before);
});

test('P4 confirmation, reload, refresh and undo keep route/layout values', async () => {
  const fixture = buildP4Content();
  const records = new Map<string, string>();
  const storage = createProjectViewStorage({
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => { records.set(key, value); },
  }, 'p4');
  const view: CanvasWorkspaceView = {
    version: 2,
    baselineId: 's0',
    baselines: {
      s0: {
        revision: baselines[0]!.stage.graph.revision ?? baselines[0]!.stage.id,
        ...structuredClone(fixture.content),
        confirmed: structuredClone(fixture.content),
        confirmedAt: '2026-11-01T00:00:00.000Z',
        confirmationId: 'p4-confirm',
        viewport: { x: 12, y: 24, zoom: 0.9 },
      },
    },
  };
  await storage.save('p4-key', view);
  const loaded = await storage.load('p4-key');
  assert.ok(loaded);
  const stage = loaded.baselines.s0!;
  assert.ok(stage.confirmed);
  assert.equal(stage.confirmationId, 'p4-confirm');
  assert.deepEqual(stage.edgeRoutes, fixture.content.edgeRoutes);
  assert.deepEqual(stage.displayRoutes, fixture.content.displayRoutes);
  assert.deepEqual(stage.frozenGroups, fixture.content.frozenGroups);
  const restored = restoreFrozenGroups(restoreNodeViews(baselines[0]!, baselineNodes(baselines[0]!), stage.nodes), stage.frozenGroups);
  for (const id of ['actor-view', 'engine-view', 'inner-view', 'worker-view', 'store-view']) {
    assert.deepEqual(at(restored.nodes, id), at(fixture.nodes, id), `reload ${id}`);
  }
  const history = new ViewHistory();
  const moved = structuredClone(fixture.content);
  moved.nodes.find((node) => node.id === 'engine-view')!.position.x += 80;
  assert.equal(history.record(fixture.content, moved), true);
  assert.deepEqual(history.undo(moved), fixture.content);
  assert.deepEqual(history.redo(fixture.content), moved);
  assert.deepEqual(fixture.content.edgeRoutes, stage.edgeRoutes);
});
