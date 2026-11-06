import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptProject, type ArchitectureProject, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { assertValidBaselines } from '../../src/core/schema/baseline.ts';
import { baselineNodes, toggleHierarchy } from '../../src/react/model/layout/hierarchy.ts';
import { groupSelection, ungroup } from '../../src/react/model/layout/grouping.ts';
import { worldPosition, type CanvasNode } from '../../src/react/model/layout/node.ts';
import { manualGeometryConflict, moveAuthoredNodes, moveAlignedAuthoredNodes } from '../../src/react/model/layout/manual-layout.ts';
import { captureContent, restoreNodeViews } from '../../src/react/model/workspace/workspace.ts';
import { planStageTransition } from '../../src/react/model/stages/stage-transition.ts';

function fixture() {
  const rootView: ProjectViewDefinition = {
    id: 'm0-view', stageId: 'M0', rootId: 'root',
    nodes: [
      { id: 'module', componentId: 'module', parentId: 'root', order: 1, frame: { x: 100, y: 100, width: 240, height: 80 }, expandedSize: { width: 740, height: 400 }, ports: [] },
      { id: 'first', componentId: 'first', parentId: 'module', order: 1, frame: { x: 64, y: 140, width: 200, height: 80 }, ports: [] },
      { id: 'second', componentId: 'second', parentId: 'module', order: 2, frame: { x: 350, y: 140, width: 200, height: 80 }, ports: [] },
      { id: 'outside', componentId: 'outside', parentId: 'root', order: 2, frame: { x: 1200, y: 100, width: 200, height: 80 }, ports: [] },
    ], relations: [],
  };
  const project: ArchitectureProject = {
    version: 1, id: 'manual-project', title: 'Manual project', revision: 'r1',
    source: { stages: [
      { id: 'M0', label: 'M0', title: 'Initial', upsert: { components: [
        { id: 'module', kind: 'group', label: 'Module', contractIds: [], sourceRefs: ['report.md#module'] },
        ...['first', 'second', 'outside'].map((id) => ({ id, kind: 'component' as const, label: id, contractIds: [], sourceRefs: [`report.md#${id}`] })),
      ], relations: [], contracts: [] }, remove: { componentIds: [], relationIds: [], contractIds: [] } },
      { id: 'M1', previousId: 'M0', label: 'M1', title: 'Increment', upsert: {
        components: [{ id: 'third', kind: 'component', label: 'third', contractIds: [], sourceRefs: ['report.md#third'] }], relations: [], contracts: [],
      }, remove: { componentIds: [], relationIds: [], contractIds: [] } },
    ] },
    views: [rootView, { ...structuredClone(rootView), id: 'm1-view', stageId: 'M1', nodes: [
      ...structuredClone(rootView.nodes),
      { id: 'third', componentId: 'third', parentId: 'module', order: 3, frame: { x: 64, y: 270, width: 200, height: 80 }, ports: [] },
    ] }],
  };
  return adaptProject(project);
}

function position(nodes: readonly CanvasNode[], id: string) {
  return nodes.find((node) => node.id === id)!.position;
}

function propose(nodes: readonly CanvasNode[], positions: Record<string, { x: number; y: number }>): CanvasNode[] {
  return nodes.map((node) => positions[node.id] ? { ...node, position: positions[node.id]! } : node);
}

test('authored cards snap within six screen pixels without resizing or moving neighbours', () => {
  const [baseline] = fixture();
  const nodes = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const visible = new Set(nodes.map((node) => node.id));
  const proposed = propose(nodes, { first: { x: 90, y: 135 } });
  const aligned = moveAlignedAuthoredNodes(nodes, proposed, ['first'], baseline!.stage, 1, visible);
  assert.deepEqual(position(aligned.nodes, 'first'), { x: 90, y: 140 });
  const peer = aligned.nodes.find((node) => node.id === 'second')!;
  assert.ok(aligned.guides.some((guide) => guide.axis === 'y' && guide.value === worldPosition(peer, aligned.nodes).y + peer.height! / 2));
  for (const node of nodes.filter((node) => node.id !== 'first')) assert.equal(aligned.nodes.find((item) => item.id === node.id), node);
  const far = moveAlignedAuthoredNodes(nodes, proposed, ['first'], baseline!.stage, 2, visible);
  assert.equal(position(far.nodes, 'first').y, 135);
  assert.deepEqual(far.guides, []);
  const restored = restoreNodeViews(baseline!, baselineNodes(baseline!), captureContent(aligned.nodes).nodes);
  assert.deepEqual(position(restored, 'first'), position(aligned.nodes, 'first'));
});

test('authored alignment uses visible cards in world coordinates across containers', () => {
  const [baseline] = fixture();
  const nodes = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const proposed = propose(nodes, { outside: { x: 1200, y: 236 } });
  const visible = new Set(nodes.map((node) => node.id));
  const result = moveAlignedAuthoredNodes(nodes, proposed, ['outside'], baseline!.stage, 1, visible);
  assert.equal(position(result.nodes, 'outside').y, 240);
  const hidden = moveAlignedAuthoredNodes(nodes, proposed, ['outside'], baseline!.stage, 1, new Set(['outside', 'module']));
  assert.equal(position(hidden.nodes, 'outside').y, 236);
  assert.deepEqual(hidden.guides, []);
});

test('authored multi-selection alignment preserves one displacement and locked anchors', () => {
  const [baseline] = fixture();
  const nodes = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const visible = new Set(nodes.map((node) => node.id));
  const result = moveAlignedAuthoredNodes(nodes, propose(nodes, { first: { x: 90, y: 135 }, outside: { x: 1500, y: 400 } }), ['first', 'outside'], baseline!.stage, 1, visible);
  assert.deepEqual(position(result.nodes, 'first'), { x: 90, y: 140 });
  assert.deepEqual(position(result.nodes, 'outside'), { x: 1226, y: 100 });
  const locked = nodes.map((node) => node.id === 'first' ? { ...node, data: { ...node.data, layoutMode: 'locked' as const } } : node);
  const protectedMove = moveAlignedAuthoredNodes(locked, propose(locked, { first: { x: 90, y: 135 } }), ['first'], baseline!.stage, 1, visible);
  assert.deepEqual(position(protectedMove.nodes, 'first'), position(locked, 'first'));
  assert.deepEqual(protectedMove.guides, []);
});

test('authored overlap clamps to legal geometry and outward movement fits the parent', () => {
  const [baseline] = fixture();
  const nodes = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const visible = new Set(nodes.map((node) => node.id));
  const result = moveAlignedAuthoredNodes(nodes, propose(nodes, { first: { x: 360, y: 136 } }), ['first'], baseline!.stage, 1, visible);
  assert.equal(manualGeometryConflict(result.nodes, baseline!.stage), undefined);
  assert.ok(position(result.nodes, 'first').x > position(nodes, 'first').x);
  assert.ok(position(result.nodes, 'first').x + result.nodes.find((node) => node.id === 'first')!.width! <= position(nodes, 'second').x);
  assert.deepEqual(result.guides, []);
  const outward = moveAlignedAuthoredNodes(nodes, propose(nodes, { first: { x: 700, y: 136 } }), ['first'], baseline!.stage, 1, visible);
  assert.equal(manualGeometryConflict(outward.nodes, baseline!.stage), undefined);
  assert.ok(outward.nodes.find((node) => node.id === 'module')!.width! > nodes.find((node) => node.id === 'module')!.width!);
});

test('manual expansion and saved view restoration preserve the authored local geometry', () => {
  const [baseline] = fixture();
  const initial = baselineNodes(baseline!);
  const expanded = toggleHierarchy(initial, 'module', baseline!.stage);
  assert.equal(expanded.find((node) => node.id === 'module')!.data.expanded, true);
  assert.deepEqual(position(expanded, 'first'), { x: 64, y: 140 });
  assert.deepEqual(position(expanded, 'second'), { x: 350, y: 140 });
  const saved = captureContent(expanded);
  const restored = restoreNodeViews(baseline!, baselineNodes(baseline!), saved.nodes);
  assert.deepEqual(captureContent(restored).nodes, saved.nodes);
  const collapsed = toggleHierarchy(restored, 'module', baseline!.stage);
  const reopened = toggleHierarchy(collapsed, 'module', baseline!.stage);
  assert.deepEqual(position(reopened, 'first'), position(expanded, 'first'));
  assert.deepEqual(position(reopened, 'second'), position(expanded, 'second'));
  assert.equal(reopened.find((node) => node.id === 'module')!.width, expanded.find((node) => node.id === 'module')!.width);
  assert.equal(reopened.find((node) => node.id === 'module')!.height, expanded.find((node) => node.id === 'module')!.height);
});

test('collapsing a manually arranged container clears only selections that become hidden', () => {
  const [baseline] = fixture();
  const expanded = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const selected = expanded.map((node) => ({ ...node, selected: node.id === 'first' || node.id === 'outside' }));
  const collapsed = toggleHierarchy(selected, 'module', baseline!.stage);
  assert.equal(collapsed.find((node) => node.id === 'module')!.data.expanded, false);
  assert.equal(collapsed.find((node) => node.id === 'first')!.selected, false);
  assert.equal(collapsed.find((node) => node.id === 'outside')!.selected, true);
  assert.deepEqual(position(collapsed, 'first'), position(expanded, 'first'));
});

test('manual drags move only selected roots; parent translation preserves local descendants', () => {
  const [baseline] = fixture();
  const nodes = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const moved = moveAuthoredNodes(nodes, propose(nodes, { first: { x: 90, y: 160 } }), ['first'], baseline!.stage);
  assert.deepEqual(position(moved, 'first'), { x: 90, y: 160 });
  assert.deepEqual(position(moved, 'second'), position(nodes, 'second'));
  assert.deepEqual(position(moved, 'module'), position(nodes, 'module'));
  assert.equal(moved.find((node) => node.id === 'module')!.width, nodes.find((node) => node.id === 'module')!.width);
  const translation = moveAuthoredNodes(moved, propose(moved, { module: { x: 250, y: 130 } }), ['module'], baseline!.stage);
  assert.deepEqual(position(translation, 'module'), { x: 250, y: 130 });
  assert.deepEqual(position(translation, 'first'), position(moved, 'first'));
  assert.deepEqual(position(translation, 'second'), position(moved, 'second'));
  assert.deepEqual(position(translation, 'outside'), position(moved, 'outside'));
});

test('locked direct drags stay put while collision-limited drags preserve neighbors', () => {
  const [baseline] = fixture();
  const nodes = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const locked = nodes.map((node) => node.id === 'first' ? { ...node, data: { ...node.data, layoutMode: 'locked' as const } } : node);
  const refused = moveAuthoredNodes(locked, propose(locked, { first: { x: 90, y: 160 } }), ['first'], baseline!.stage);
  assert.deepEqual(position(refused, 'first'), position(locked, 'first'));
  const collision = moveAuthoredNodes(nodes, propose(nodes, { first: { x: 360, y: 140 } }), ['first'], baseline!.stage);
  assert.equal(manualGeometryConflict(collision, baseline!.stage), undefined);
  assert.deepEqual(position(collision, 'second'), position(nodes, 'second'));
  assert.deepEqual(position(collision, 'outside'), position(nodes, 'outside'));
  const outside = moveAuthoredNodes(nodes, propose(nodes, { first: { x: 700, y: 140 } }), ['first'], baseline!.stage);
  assert.equal(manualGeometryConflict(outside, baseline!.stage), undefined);
  assert.deepEqual(position(outside, 'first'), { x: 700, y: 140 });
  assert.ok(outside.find((node) => node.id === 'module')!.width! > nodes.find((node) => node.id === 'module')!.width!);
});

test('manual stage increment uses authored coordinates without expanding or moving the confirmed nodes', () => {
  const [initial, target] = fixture();
  const nodes = baselineNodes(initial!);
  const moved = moveAuthoredNodes(nodes, propose(nodes, { outside: { x: 1300, y: 200 } }), ['outside'], initial!.stage);
  const content = captureContent(moved);
  const serialized = JSON.stringify(content);
  const result = planStageTransition({ source: initial!, target: target!, sourceContent: content });
  assert.equal(result.ok, true, !result.ok ? JSON.stringify(result.conflicts) : '');
  assert.equal(JSON.stringify(content), serialized);
  if (!result.ok) return;
  assert.deepEqual(position(result.state.nodes, 'third'), { x: 64, y: 270 });
  assert.deepEqual(position(result.state.nodes, 'outside'), { x: 1300, y: 200 });
  assert.equal(result.state.nodes.find((node) => node.id === 'module')!.data.expanded, false);
  assert.deepEqual(result.record.expanded, []);
  assert.deepEqual(result.record.placements, [{ nodeId: 'third', mode: 'provided' }]);
});

test('manual groups and ungrouping preserve world positions and unrelated authored frames', () => {
  const [baseline] = fixture();
  const expanded = toggleHierarchy(baselineNodes(baseline!), 'module', baseline!.stage);
  const selected = expanded.map((node) => ({ ...node, selected: node.id === 'first' || node.id === 'second' }));
  const before = Object.fromEntries(selected.map((node) => [node.id, worldPosition(node, selected)]));
  const grouped = groupSelection(selected, 'group-one', true);
  assert.ok(grouped.some((node) => node.id === 'group-one'));
  assert.equal(manualGeometryConflict(grouped, baseline!.stage), undefined);
  for (const id of ['module', 'first', 'second', 'outside']) assert.deepEqual(worldPosition(grouped.find((node) => node.id === id)!, grouped), before[id]);
  const restored = ungroup(grouped, 'group-one', true);
  for (const id of ['module', 'first', 'second', 'outside']) assert.deepEqual(worldPosition(restored.find((node) => node.id === id)!, restored), before[id]);
  assert.equal(restored.find((node) => node.id === 'module')!.width, expanded.find((node) => node.id === 'module')!.width);
});

test('manual baseline validation rejects missing and invalid frames rather than generating a grid', () => {
  const [baseline] = fixture();
  const invalid = structuredClone(baseline!);
  delete (invalid.layout!.nodes as Record<string, unknown>).first;
  assert.throws(() => assertValidBaselines([invalid]), /authored frame.*first/);
  const noContainer = structuredClone(baseline!);
  delete (noContainer.layout!.nodes.module as { expandedSize?: unknown }).expandedSize;
  assert.throws(() => assertValidBaselines([noContainer]), /container size.*module/);
});
