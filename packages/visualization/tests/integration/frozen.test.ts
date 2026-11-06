import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';
import { createHierarchyNodes, syncHierarchyExpansion, toggleHierarchy } from '../../src/react/model/layout/hierarchy.ts';
import { worldPosition, type CanvasNode } from '../../src/react/model/layout/node.ts';
import { freezeSelection, restoreFrozenGroups, toggleFrozenExpansion, unfreezeGroup } from '../../src/react/model/freeze/frozen.ts';

function entity(id: string, parentId: string | null, order: number, kind: CanonicalNode['kind'] = parentId === null ? 'root' : 'component'): CanonicalNode {
  return { id, parentId, kind, label: id, summary: id, order, ports: [] };
}

function link(id: string, source: string, target: string, order = 0): CanonicalEdge {
  return { id, source: { nodeId: source }, target: { nodeId: target }, relation: 'data', direction: 'directed', order };
}

const stage: StageSnapshot = {
  id: 'main', label: 'main', title: 'main', track: 'main', order: 0,
  graph: {
    rootId: 'root', revision: 'r1',
    nodes: [entity('root', null, 0), entity('module', 'root', 1, 'group'), entity('first', 'module', 2), entity('second', 'module', 3), entity('outside', 'root', 4)],
    edges: [link('inside', 'first', 'second'), link('cross', 'first', 'outside', 1)],
  },
};

const positions = { module: { x: 300, y: 200 }, first: { x: 24, y: 72 }, second: { x: 360, y: 72 }, outside: { x: 900, y: 200 } };
const expanded = (): CanvasNode[] => toggleHierarchy(createHierarchyNodes(stage, positions), 'module', stage);

test('freezing a canonical subtree fixes the root, locks descendants and records boundary ports', () => {
  const result = freezeSelection({ nodes: expanded(), rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.group.rootId, 'module');
  assert.deepEqual(result.group.memberIds.sort(), ['first', 'second']);
  assert.deepEqual(result.group.boundaryPorts.map((port) => port.edgeId), ['cross']);
  const root = result.nodes.find((node) => node.id === 'module')!;
  assert.equal(root.data.layoutMode, 'fixed');
  assert.equal(root.data.frozen, true);
  for (const id of ['first', 'second']) {
    const member: CanvasNode = result.nodes.find((node) => node.id === id)!;
    assert.equal(member.data.layoutMode, 'locked');
    assert.equal(member.data.frozen, true);
  }
});

test('moving a frozen root translates every member and preserved route origin without local drift', () => {
  const result = freezeSelection({ nodes: expanded(), rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const moved = result.nodes.map((node) => node.id === 'module' ? { ...node, position: { x: node.position.x + 120, y: node.position.y + 80 } } : node);
  for (const id of ['first', 'second']) {
    const before = worldPosition(result.nodes.find((node) => node.id === id)!, result.nodes);
    const after = worldPosition(moved.find((node) => node.id === id)!, moved);
    assert.deepEqual(after, { x: before.x + 120, y: before.y + 80 });
  }
});

test('frozen read-only expansion keeps the frame size and never reflows children', () => {
  const result = freezeSelection({ nodes: expanded(), rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const root = result.nodes.find((node) => node.id === 'module')!;
  const collapsed = toggleFrozenExpansion(result.nodes, 'module', false);
  const closed = collapsed.find((node) => node.id === 'module')!;
  assert.equal(closed.type, 'card');
  assert.equal(closed.width, root.width);
  assert.equal(closed.height, root.height);
  const reopened = toggleFrozenExpansion(collapsed, 'module', true).find((node) => node.id === 'module')!;
  assert.equal(reopened.type, 'structure');
  assert.equal(reopened.width, root.width);
  assert.equal(reopened.height, root.height);
});

test('freezing rejects overlapping groups and unfreezing restores editable layout modes', () => {
  const firstFreeze = freezeSelection({ nodes: expanded(), rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(firstFreeze.ok, true);
  if (!firstFreeze.ok) return;
  const overlap = freezeSelection({ nodes: firstFreeze.nodes, rootIds: ['first'], groupId: 'freeze:first', stage, frozenGroups: [firstFreeze.group] });
  assert.equal(overlap.ok, false);
  const thawed = unfreezeGroup(firstFreeze.nodes, firstFreeze.group);
  for (const id of ['module', 'first', 'second']) {
    const node = thawed.find((item) => item.id === id)!;
    assert.equal(node.data.layoutMode, 'free');
    assert.equal(node.data.frozen, undefined);
  }
});

test('cross-baseline expansion sync never reflows a frozen container', () => {
  const result = freezeSelection({ nodes: expanded(), rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const root = result.nodes.find((node) => node.id === 'module')!;
  const collapsedSource = createHierarchyNodes(stage, positions);
  const synced = syncHierarchyExpansion(result.nodes, collapsedSource, stage);
  const after = synced.find((node) => node.id === 'module')!;
  assert.equal(after.data.expanded, root.data.expanded);
  assert.equal(after.width, root.width);
  assert.equal(after.height, root.height);
});

test('multi-selection preserves its ledger and reports a missing member', () => {
  const nodes = expanded();
  const result = freezeSelection({ nodes, rootIds: ['first', 'outside'], groupId: 'freeze:multi', stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.group.rootId, 'freeze:multi');
  assert.ok(result.group.memberIds.includes('first'));
  assert.ok(result.group.memberIds.includes('outside'));
  const restored = restoreFrozenGroups(result.nodes.filter((node) => node.id !== 'outside'), [result.group]);
  assert.equal(restored.groups.length, 1);
  assert.deepEqual(restored.conflicts[0]!.entityIds, ['outside']);
  assert.equal(restored.nodes.find((node) => node.id === 'first')!.data.frozen, true);
});

test('unfreezing restores pre-existing fixed and locked modes', () => {
  const original = expanded().map((node) => node.id === 'first' ? { ...node, data: { ...node.data, layoutMode: 'fixed' as const } } : node.id === 'second' ? { ...node, data: { ...node.data, layoutMode: 'locked' as const } } : node);
  const result = freezeSelection({ nodes: original, rootIds: ['module'], groupId: 'freeze:module', stage });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const thawed = unfreezeGroup(result.nodes, result.group);
  assert.equal(thawed.find((node) => node.id === 'first')!.data.layoutMode, 'fixed');
  assert.equal(thawed.find((node) => node.id === 'second')!.data.layoutMode, 'locked');
});
