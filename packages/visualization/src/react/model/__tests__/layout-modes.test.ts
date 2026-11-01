import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_SIZE, groupSelection, ungroup, separateSiblings, worldPosition, type CanvasNode, type LayoutMode } from '../grouping.ts';
import { constrainNodeMoves } from '../constraints.ts';
import { createHierarchyNodes, toggleHierarchy, syncHierarchyExpansion } from '../hierarchy.ts';
import type { StageSnapshot } from '../../../core/schema/types.ts';

const card = (id: string, x: number, y: number, layoutMode: LayoutMode = 'free'): CanvasNode => ({ id, type: 'card', position: { x, y }, ...CARD_SIZE, data: { title: id, layoutMode } });
const drag = (before: CanvasNode[], id: string, x: number, y: number) => constrainNodeMoves(before, before.map((node) => node.id === id ? { ...node, position: { x, y } } : node), [id], 1, new Set(before.map((node) => node.id)), []).nodes;
const stage: StageSnapshot = {
  id: 'layout', label: 'layout', title: 'layout', track: 'main', order: 0,
  graph: { rootId: 'root', nodes: [
    { id: 'root', parentId: null, label: 'root', kind: 'root', ports: [], order: 0 },
    { id: 'module', parentId: 'root', label: 'module', kind: 'group', ports: [], order: 1 },
    { id: 'first', parentId: 'module', label: 'first', kind: 'component', ports: [], order: 2 },
    { id: 'second', parentId: 'module', label: 'second', kind: 'component', ports: [], order: 3 },
    { id: 'neighbor', parentId: 'root', label: 'neighbor', kind: 'component', ports: [], order: 4 },
  ], edges: [] },
};
const initial = () => createHierarchyNodes(stage, { module: { x: 0, y: 0 }, first: { x: 24, y: 72 }, second: { x: 336, y: 72 }, neighbor: { x: 320, y: 0 } });

test('fixed cards move manually while locked cards reject a direct drag', () => {
  const fixed = [card('fixed', 0, 0, 'fixed')];
  assert.deepEqual(drag(fixed, 'fixed', 120, 240)[0]!.position, { x: 120, y: 240 });
  const locked = [card('locked', 0, 0, 'locked')];
  assert.deepEqual(drag(locked, 'locked', 120, 240)[0]!.position, locked[0]!.position);
});

test('automatic sibling separation treats fixed cards as obstacles instead of pushing them', () => {
  const before = [card('growing', 0, 0), card('fixed', 320, 0, 'fixed'), card('free', 560, 0)];
  const proposed = [{ ...before[0]!, width: 420 }, ...before.slice(1)];
  const next = separateSiblings(proposed, 'growing');
  assert.deepEqual(next.find((node) => node.id === 'fixed')!.position, before[1]!.position);
});

test('expansion tries a local free-child column without changing the fixed neighbor anchor', () => {
  const before = initial().map((node) => node.id === 'neighbor' ? { ...node, data: { ...node.data, layoutMode: 'fixed' as const } } : node);
  const next = toggleHierarchy(before, 'module', stage);
  assert.notEqual(next, before);
  assert.equal(next.find((node) => node.id === 'module')!.data.expanded, true);
  assert.deepEqual(next.find((node) => node.id === 'neighbor')!.position, before.find((node) => node.id === 'neighbor')!.position);
  assert.equal(next.find((node) => node.id === 'first')!.position.x, next.find((node) => node.id === 'second')!.position.x);
});

test('expansion rolls back atomically when fixed children and a fixed neighbor leave no legal space', () => {
  const before = initial().map((node) => ({ ...node, data: { ...node.data, layoutMode: 'fixed' as const } }));
  assert.equal(toggleHierarchy(before, 'module', stage), before);
  assert.equal(before.find((node) => node.id === 'module')!.data.expanded, false);
});

test('a manually moved parent carries locked descendants without changing their local coordinates', () => {
  const parent: CanvasNode = { id: 'parent', type: 'cluster', position: { x: 0, y: 0 }, width: 350, height: 250, data: { title: 'parent' } };
  const child = { ...card('child', 24, 72, 'locked'), parentId: 'parent' };
  const before = [parent, child];
  const next = drag(before, 'parent', 180, 160);
  assert.deepEqual(next[1]!.position, child.position);
  assert.deepEqual(worldPosition(next[1]!, next), { x: 204, y: 232 });
});

test('automatic container origin compensation preserves a fixed sibling world anchor', () => {
  const frame: CanvasNode = { id: 'frame', type: 'structure', position: { x: 200, y: 150 }, width: 700, height: 250, data: { title: 'frame', contentWidth: 700, contentHeight: 250 } };
  const before = [frame, { ...card('moving', 24, 72), parentId: 'frame' }, { ...card('fixed', 360, 72, 'fixed'), parentId: 'frame' }];
  const oldAnchor = worldPosition(before[2]!, before);
  const next = drag(before, 'moving', -160, -70);
  assert.ok(next[0]!.position.x < frame.position.x);
  assert.deepEqual(worldPosition(next[2]!, next), oldAnchor);
});

test('direct locked members cannot be grouped or dissolved but fixed nodes remain editable', () => {
  const locked = [{ ...card('one', 0, 0, 'locked'), selected: true }, { ...card('two', 360, 0), selected: true }];
  assert.equal(groupSelection(locked, 'blocked'), locked);
  const fixed = locked.map((node) => ({ ...node, data: { ...node.data, layoutMode: 'fixed' as const } }));
  const grouped = groupSelection(fixed, 'editable');
  assert.ok(grouped.some((node) => node.id === 'editable'));
  const dissolved = ungroup(grouped, 'editable');
  assert.ok(!dissolved.some((node) => node.id === 'editable'));
  const lockedGroup = grouped.map((node) => node.id === 'editable' ? { ...node, data: { ...node.data, layoutMode: 'locked' as const } } : node);
  assert.equal(ungroup(lockedGroup, 'editable'), lockedGroup);
});

test('dragging a child compensates a fixed expandable frame origin without moving its content anchor', () => {
  const frame: CanvasNode = { id: 'frame', type: 'structure', position: { x: 200, y: 150 }, width: 700, height: 250, data: { title: 'frame', expandable: true, expanded: true, layoutMode: 'fixed', contentWidth: 700, contentHeight: 250 } };
  const before = [frame, { ...card('moving', 24, 72), parentId: 'frame' }, { ...card('fixed', 360, 72, 'fixed'), parentId: 'frame' }];
  const next = drag(before, 'moving', -160, -70);
  const afterFrame = next.find(n => n.id === 'frame')!;
  assert.ok(afterFrame.position.x < frame.position.x);
  assert.deepEqual({ x: afterFrame.position.x - (afterFrame.data.fitOffset?.x ?? 0), y: afterFrame.position.y - (afterFrame.data.fitOffset?.y ?? 0) }, frame.position);
  assert.deepEqual(worldPosition(next.find(n => n.id === 'fixed')!, next), worldPosition(before[2]!, before));
});

test('an unchanged frame within the stage growth budget does not block unrelated manual movement', () => {
  const frame: CanvasNode = { id: 'stage-frame', type: 'structure', position: { x: 1000, y: 1000 }, width: 912, height: 672, data: { title: 'stage-frame', contentWidth: 912, contentHeight: 324 } };
  const before = [card('moving', 0, 0), frame];
  const next = drag(before, 'moving', 100, 80);
  assert.deepEqual(next[0]!.position, { x: 100, y: 80 });
  assert.equal(next[1]!.height, frame.height);
});

test('baseline expansion synchronization keeps target fixed modes and rejects its conflicting expansion', () => {
  const source = toggleHierarchy(initial(), 'module', stage);
  const target = initial().map((node) => ({ ...node, data: { ...node.data, layoutMode: 'fixed' as const } }));
  const next = syncHierarchyExpansion(target, source, stage);
  assert.equal(next.find((node) => node.id === 'module')!.data.expanded, false);
  assert.ok(next.every((node) => node.data.layoutMode === 'fixed'));
});
