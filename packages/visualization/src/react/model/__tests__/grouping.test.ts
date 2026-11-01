import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_SIZE, groupSelection, leafMembers, normalizeMarqueeSelection, selectionRoots, ungroup, worldPosition, type CanvasNode } from '../grouping.ts';
import { createHierarchyNodes, toggleHierarchy } from '../hierarchy.ts';
import { recursiveStage, initialPositions } from '../../../../tests/fixtures/recursive.ts';

const card = (id: string, x: number, y: number): CanvasNode => ({
  id, type: 'card', position: { x, y }, ...CARD_SIZE, data: { title: id }, selected: true,
});

test('grouping keeps card world positions and moving the frame translates both children', () => {
  const original = [card('entry', -40, 20), card('session', 290, 170)];
  const grouped = groupSelection(original, 'frame');
  assert.deepEqual(worldPosition(grouped[1]!, grouped), original[0]!.position);
  assert.deepEqual(worldPosition(grouped[2]!, grouped), original[1]!.position);
  const moved = grouped.map((node) => node.id === 'frame' ? { ...node, position: { x: node.position.x + 120, y: node.position.y - 35 } } : node);
  assert.deepEqual(worldPosition(moved[1]!, moved), { x: 80, y: -15 });
  assert.deepEqual(worldPosition(moved[2]!, moved), { x: 410, y: 135 });
  const dissolved = ungroup(moved, 'frame');
  assert.equal(dissolved.length, original.length);
  for (const node of dissolved) {
    assert.equal(node.parentId, undefined);
    assert.equal(node.extent, undefined);
    assert.deepEqual(node.position, worldPosition(moved.find((item) => item.id === node.id)!, moved));
  }
});

test('nested grouping moves a selected frame once and highlights its leaf descendants', () => {
  const inner = groupSelection([card('a', 10, 20), card('b', 10, 170)], 'inner');
  const selected: CanvasNode[] = inner.map((node) => ({ ...node, selected: true }));
  selected.push(card('c', 700, 100));
  assert.deepEqual(selectionRoots(selected).map((node) => node.id), ['inner', 'c']);
  const outer = groupSelection(selected, 'outer');
  for (const id of ['a', 'b', 'c']) {
    assert.deepEqual(worldPosition(outer.find((node) => node.id === id)!, outer), worldPosition(selected.find((node) => node.id === id)!, selected));
  }
  assert.deepEqual([...leafMembers(outer, new Set(['outer']))].sort(), ['a', 'b', 'c']);
});

test('reparenting a card from an existing frame preserves its world coordinates', () => {
  const nodes: CanvasNode[] = groupSelection([card('a', 10, 20), card('b', 10, 170)], 'first').map((node) => ({ ...node, selected: node.id === 'a' }));
  nodes.push(card('c', 700, 100));
  const grouped = groupSelection(nodes, 'second');
  assert.equal(grouped.find((node) => node.id === 'a')!.parentId, 'second');
  assert.deepEqual(worldPosition(grouped.find((node) => node.id === 'a')!, grouped), { x: 10, y: 20 });
  assert.equal(grouped.find((node) => node.id === 'b')!.parentId, 'first');
});

const structure = (id: string, x: number, y: number, parentId?: string): CanvasNode => ({
  id, type: 'structure', position: { x, y }, width: 1000, height: 700, data: { title: id, expanded: true },
  ...(parentId ? { parentId } : {}),
});

function assertParentOrder(nodes: CanvasNode[]) {
  for (const node of nodes) if (node.parentId) assert.ok(nodes.findIndex((item) => item.id === node.parentId) < nodes.indexOf(node));
}

function assertSeparated(first: CanvasNode, second: CanvasNode, nodes: CanvasNode[]) {
  const a = worldPosition(first, nodes), b = worldPosition(second, nodes);
  assert.ok(a.x + first.width! + 24 <= b.x || b.x + second.width! + 24 <= a.x
    || a.y + first.height! + 24 <= b.y || b.y + second.height! + 24 <= a.y, `${first.id} overlaps ${second.id}`);
}

function assertEnclosed(nodes: CanvasNode[]) {
  for (const parent of nodes.filter((node) => node.type === 'structure' || node.type === 'cluster')) {
    for (const child of nodes.filter((node) => node.parentId === parent.id)) {
      assert.ok(child.position.x >= 24 && child.position.y >= (parent.type === 'structure' ? 72 : 60), `${parent.id} header covers ${child.id}`);
      assert.ok(child.position.x + child.width! + 24 <= parent.width! && child.position.y + child.height! + 24 <= parent.height!, `${parent.id} does not enclose ${child.id}`);
    }
  }
}

function expandedHierarchy(): CanvasNode[] {
  let nodes = createHierarchyNodes(recursiveStage, initialPositions);
  for (const id of ['session', 'session-context', 'context-compose']) nodes = toggleHierarchy(nodes, id, recursiveStage);
  return nodes.map((node) => ({ ...node, selected: false }));
}

test('marquee selection keeps nested cards while clearing their selected ancestors', () => {
  const nodes = [
    { ...structure('outer', 100, 100), selected: true },
    { ...structure('inner', 24, 72, 'outer'), selected: true },
    { ...card('a', 24, 72), parentId: 'inner' },
    { ...card('b', 24, 250), parentId: 'inner' },
    { ...structure('standalone', 1500, 100), selected: true },
  ];
  const normalized = normalizeMarqueeSelection(nodes);
  assert.deepEqual(selectionRoots(normalized).map((node) => node.id), ['a', 'b', 'standalone']);
  assert.equal(nodes[0]!.selected, true);
  assert.deepEqual(selectionRoots(nodes).map((node) => node.id), ['outer', 'standalone']);
});

test('grouping two internal cards stays under their shared parent and dissolves to the same ownership', () => {
  const nodes = [structure('outer', 300, 200), structure('inner', 200, 200, 'outer'),
    { ...card('a', 24, 100), parentId: 'inner' }, { ...card('b', 400, 100), parentId: 'inner' }];
  const grouped = groupSelection(nodes, 'group');
  assert.equal(grouped.find((node) => node.id === 'group')!.parentId, 'inner');
  assertParentOrder(grouped);
  for (const id of ['a', 'b']) assert.deepEqual(worldPosition(grouped.find((node) => node.id === id)!, grouped), worldPosition(nodes.find((node) => node.id === id)!, nodes));
  const moved = grouped.map((node) => node.id === 'group' ? { ...node, position: { x: node.position.x + 40, y: node.position.y + 30 } } : node);
  const dissolved = ungroup(moved, 'group');
  for (const id of ['a', 'b']) {
    const node = dissolved.find((item) => item.id === id)!;
    assert.equal(node.parentId, 'inner');
    assert.deepEqual(worldPosition(node, dissolved), worldPosition(moved.find((item) => item.id === id)!, moved));
    assert.equal(node.data.groupOrigins, undefined);
  }
  assertParentOrder(dissolved);
});

test('cards at different depths group under their lowest common visual ancestor and restore individual parents', () => {
  const nodes = [structure('outer', 300, 200), structure('inner', 200, 200, 'outer'),
    { ...card('a', 24, 100), parentId: 'inner' }, { ...card('b', 700, 300), parentId: 'outer' }];
  const grouped = groupSelection(nodes, 'group');
  assert.equal(grouped.find((node) => node.id === 'group')!.parentId, 'outer');
  assert.equal(grouped.find((node) => node.id === 'inner')!.parentId, 'outer');
  for (const id of ['a', 'b']) assert.deepEqual(worldPosition(grouped.find((node) => node.id === id)!, grouped), worldPosition(nodes.find((node) => node.id === id)!, nodes));
  const dissolved = ungroup(grouped, 'group');
  assert.equal(dissolved.find((node) => node.id === 'a')!.parentId, 'inner');
  assert.equal(dissolved.find((node) => node.id === 'b')!.parentId, 'outer');
  assertParentOrder(dissolved);
});

test('dissolving an inner group after its former parent disappears uses the group parent and preserves position', () => {
  const nodes = [structure('outer', 300, 200), structure('inner', 200, 200, 'outer'),
    { ...card('a', 24, 100), parentId: 'inner' }, { ...card('b', 700, 300), parentId: 'outer' }];
  const grouped = groupSelection(nodes, 'group').filter((node) => node.id !== 'inner');
  const dissolved = ungroup(grouped, 'group');
  assert.equal(dissolved.find((node) => node.id === 'a')!.parentId, 'outer');
  assert.deepEqual(worldPosition(dissolved.find((node) => node.id === 'a')!, dissolved), worldPosition(grouped.find((node) => node.id === 'a')!, grouped));
});

test('regrouping an already grouped card retains both restoration levels', () => {
  const nodes = [structure('outer', 300, 200),
    { ...card('a', 24, 100), parentId: 'outer' }, { ...card('b', 400, 100), parentId: 'outer' }, card('c', 1600, 100)];
  const first = groupSelection(nodes.map((node) => ({ ...node, selected: ['a', 'b'].includes(node.id) })), 'first');
  const second = groupSelection(first.map((node) => ({ ...node, selected: ['a', 'c'].includes(node.id) })), 'second');
  const afterSecond = ungroup(second, 'second');
  assert.equal(afterSecond.find((node) => node.id === 'a')!.parentId, 'first');
  assert.equal(afterSecond.find((node) => node.id === 'c')!.parentId, undefined);
  const afterFirst = ungroup(afterSecond, 'first');
  assert.equal(afterFirst.find((node) => node.id === 'a')!.parentId, 'outer');
  assert.equal(afterFirst.find((node) => node.id === 'b')!.parentId, 'outer');
  assertParentOrder(afterFirst);
});

test('grouping cards at the content origin refits the parent around the title and leaf bounds', () => {
  const nodes = [structure('parent', 300, 200),
    { ...card('a', 24, 72), parentId: 'parent' }, { ...card('b', 400, 72), parentId: 'parent' },
    { ...card('unselected', 700, 400), parentId: 'parent', selected: false },
    { ...card('outside', 1500, 300), selected: false }];
  const grouped = groupSelection(nodes, 'group');
  const parent = grouped.find((node) => node.id === 'parent')!, group = grouped.find((node) => node.id === 'group')!;
  assert.equal(group.position.x, 24);
  assert.equal(group.position.y, 72);
  assert.equal(parent.position.x, 276);
  assert.equal(parent.position.y, 140);
  assert.equal(parent.width, Math.max(...grouped.filter((node) => node.parentId === parent.id).map((node) => node.position.x + node.width! + 24)));
  assert.equal(parent.height, Math.max(...grouped.filter((node) => node.parentId === parent.id).map((node) => node.position.y + node.height! + 24)));
  assert.equal(parent.data.contentWidth, parent.width);
  assert.equal(parent.data.contentHeight, parent.height);
  for (const id of ['a', 'b', 'unselected', 'outside']) assert.deepEqual(worldPosition(grouped.find((node) => node.id === id)!, grouped), worldPosition(nodes.find((node) => node.id === id)!, nodes));
});

test('extracting history and trim into a second group separates the remaining nested frames without moving selected leaves', () => {
  const canonical = JSON.stringify(recursiveStage);
  const original = expandedHierarchy();
  const first = groupSelection(original.map((node) => ({ ...node, selected: ['compose-trim', 'compose-summary'].includes(node.id) })), 'cluster-1');
  const before = new Map(first.map((node) => [node.id, worldPosition(node, first)]));
  const firstSnapshot = JSON.stringify(first);
  const second = groupSelection(first.map((node) => ({ ...node, selected: ['context-history', 'compose-trim'].includes(node.id) })), 'cluster-2');
  const group = second.find((node) => node.id === 'cluster-2')!;
  const compose = second.find((node) => node.id === 'context-compose')!;
  const cluster = second.find((node) => node.id === 'cluster-1')!;
  assert.equal(group.parentId, 'session-context');
  assertSeparated(group, compose, second);
  for (const id of ['context-history', 'compose-trim']) assert.deepEqual(worldPosition(second.find((node) => node.id === id)!, second), before.get(id));
  const newCompose = worldPosition(compose, second);
  const oldSummary = before.get('compose-summary')!, newSummary = worldPosition(second.find((node) => node.id === 'compose-summary')!, second);
  const naturalComposeOrigin = { x: oldSummary.x - 48, y: oldSummary.y - 132 };
  const expectedSummaryShift = { x: newCompose.x - naturalComposeOrigin.x, y: newCompose.y - naturalComposeOrigin.y };
  assert.ok(newSummary.x > oldSummary.x || newSummary.y > oldSummary.y);
  assert.equal(second.find((node) => node.id === 'compose-summary')!.parentId, 'cluster-1');
  assert.deepEqual(worldPosition(cluster, second), { x: newCompose.x + 24, y: newCompose.y + 72 });
  assert.equal(newSummary.x - oldSummary.x, expectedSummaryShift.x);
  assert.equal(newSummary.y - oldSummary.y, expectedSummaryShift.y);
  assertEnclosed(second);
  assertParentOrder(second);
  const session = second.find((node) => node.id === 'session')!;
  for (const sibling of second.filter((node) => node.id !== session.id && node.parentId === session.parentId)) assertSeparated(session, sibling, second);
  for (const node of second.filter((node) => ['cluster-1', 'cluster-2', 'context-compose', 'session-context', 'session'].includes(node.id))) {
    assert.equal(node.data.contentWidth, node.width);
    assert.equal(node.data.contentHeight, node.height);
    assert.equal(Object.keys(node.data.expansionSizes!).length, 1);
  }
  assert.equal(JSON.stringify(first), firstSnapshot);
  assert.equal(JSON.stringify(recursiveStage), canonical);
});

test('moving an overlapping sibling continues through a third sibling and carries its descendants', () => {
  const nodes = [card('a', 0, 100), card('b', 300, 100),
    { ...structure('remaining', 0, 150), width: 288, height: 178, selected: false },
    { ...card('remaining-leaf', 24, 72), parentId: 'remaining', selected: false },
    { ...card('third', 0, 360), selected: false }];
  const grouped = groupSelection(nodes, 'new');
  const group = grouped.find((node) => node.id === 'new')!, remaining = grouped.find((node) => node.id === 'remaining')!, third = grouped.find((node) => node.id === 'third')!;
  assertSeparated(group, remaining, grouped);
  assertSeparated(group, third, grouped);
  assertSeparated(remaining, third, grouped);
  assert.deepEqual(worldPosition(grouped.find((node) => node.id === 'remaining-leaf')!, grouped), { x: remaining.position.x + 24, y: remaining.position.y + 72 });
  assert.deepEqual(worldPosition(grouped.find((node) => node.id === 'a')!, grouped), nodes[0]!.position);
  assert.deepEqual(worldPosition(grouped.find((node) => node.id === 'b')!, grouped), nodes[1]!.position);
});

test('root-level neighbors use the nearest upward clearance without moving the new group', () => {
  const nodes = [card('a', 100, 100), card('b', 400, 100), { ...card('entry', 200, -60), selected: false }];
  const grouped = groupSelection(nodes, 'group');
  const entry = grouped.find((node) => node.id === 'entry')!;
  assert.equal(entry.position.x, 200);
  assert.equal(entry.position.y, -66);
  assertSeparated(grouped.find((node) => node.id === 'group')!, entry, grouped);
  for (const id of ['a', 'b']) assert.deepEqual(worldPosition(grouped.find((node) => node.id === id)!, grouped), nodes.find((node) => node.id === id)!.position);
});

test('extracting every member removes empty manual frames and restores through their surviving ancestor', () => {
  const original = expandedHierarchy();
  const first = groupSelection(original.map((node) => ({ ...node, selected: ['compose-trim', 'compose-summary'].includes(node.id) })), 'cluster-1');
  const second = groupSelection(first.map((node) => ({ ...node, selected: ['compose-trim', 'compose-summary', 'context-history'].includes(node.id) })), 'cluster-2');
  assert.equal(second.some((node) => node.id === 'cluster-1'), false);
  assert.equal(second.some((node) => node.id === 'context-compose'), true);
  const dissolved = ungroup(second, 'cluster-2');
  for (const id of ['compose-trim', 'compose-summary']) {
    assert.equal(dissolved.find((node) => node.id === id)!.parentId, 'session-context');
    assert.deepEqual(worldPosition(dissolved.find((node) => node.id === id)!, dissolved), worldPosition(second.find((node) => node.id === id)!, second));
  }
  assertParentOrder(dissolved);
});

test('new title padding propagates up nested frames while keeping all leaf world positions and siblings fixed', () => {
  const nodes = [structure('outer', 300, 200), structure('inner', 24, 72, 'outer'),
    { ...card('a', 24, 72), parentId: 'inner' }, { ...card('b', 400, 72), parentId: 'inner' },
    { ...card('sibling', 700, 400), parentId: 'outer', selected: false },
    { ...card('outside', 1800, 300), selected: false }];
  const grouped = groupSelection(nodes, 'group');
  const outer = grouped.find((node) => node.id === 'outer')!, inner = grouped.find((node) => node.id === 'inner')!;
  const group = grouped.find((node) => node.id === 'group')!;
  assert.equal(group.position.x, 24);
  assert.equal(group.position.y, 72);
  assert.equal(inner.position.x, 24);
  assert.equal(inner.position.y, 72);
  assert.equal(outer.position.x, 276);
  assert.equal(outer.position.y, 140);
  for (const id of ['a', 'b', 'sibling', 'outside']) assert.deepEqual(worldPosition(grouped.find((node) => node.id === id)!, grouped), worldPosition(nodes.find((node) => node.id === id)!, nodes));
  assertParentOrder(grouped);
});

test('dissolving a moved cross-layer group expands restored parents without moving restored or unrelated leaves', () => {
  const nodes = [structure('outer', 300, 200), structure('inner', 24, 72, 'outer'),
    { ...card('a', 24, 72), parentId: 'inner' }, { ...card('b', 500, 300), parentId: 'outer' },
    { ...card('sibling', 700, 500), parentId: 'inner', selected: false }];
  const grouped = groupSelection(nodes, 'group');
  const moved = grouped.map((node) => node.id === 'group' ? { ...node, position: { x: -100, y: -100 } } : node);
  const dissolved = ungroup(moved, 'group');
  for (const id of ['a', 'b', 'sibling']) assert.deepEqual(worldPosition(dissolved.find((node) => node.id === id)!, dissolved), worldPosition(moved.find((node) => node.id === id)!, moved));
  const a = dissolved.find((node) => node.id === 'a')!, b = dissolved.find((node) => node.id === 'b')!;
  assert.equal(a.parentId, 'inner');
  assert.equal(b.parentId, 'outer');
  assert.ok(a.position.x >= 24 && a.position.y >= 72);
  assert.ok(b.position.x >= 24 && b.position.y >= 72);
  assertParentOrder(dissolved);
});
