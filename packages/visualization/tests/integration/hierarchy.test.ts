import test from 'node:test';
import assert from 'node:assert/strict';
import { createHierarchyNodes as createNodes, hierarchyProjection as projectNodes, nodeIsVisible, toggleHierarchy as toggleNodes } from '../../src/react/model/hierarchy.ts';
import { groupSelection, worldPosition, type CanvasNode } from '../../src/react/model/grouping.ts';
import { recursiveStage, initialPositions } from '../../examples/fixtures/recursive.ts';
import { assertValidSnapshot } from '../../src/core/schema/validate.ts';
import { routeDiagramEdge } from '../../src/react/model/routing.ts';
import { obstacleFromRect } from '../../src/core/layout/geometry.ts';
import { validateOrthogonalPath } from '../helpers/geometry.ts';
import { constrainNodeMoves } from '../../src/react/model/constraints.ts';
import { placeEdgeLabel } from '../../src/react/model/labels.ts';
import type { Rect } from '../../src/core/layout/geometry.ts';

const createHierarchyNodes = () => createNodes(recursiveStage, initialPositions);
const hierarchyProjection = (nodes: readonly CanvasNode[]) => projectNodes(nodes, recursiveStage);
const toggleHierarchy = (nodes: readonly CanvasNode[], id: string) => toggleNodes(nodes, id, recursiveStage);

test('recursive stage folds into the seven-node baseline overview and resolves a cross-layer edge at each depth', () => {
  assert.doesNotThrow(() => assertValidSnapshot(recursiveStage));
  let nodes = createHierarchyNodes();
  const overview = hierarchyProjection(nodes);
  assert.equal(overview.nodes.length, 7);
  assert.equal(overview.edges.length, 7);
  const endpoint = () => hierarchyProjection(nodes).edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')!.target.nodeId;
  assert.equal(endpoint(), 'session');
  for (const [parent, target, count] of [
    ['session', 'session-context', 10],
    ['session-context', 'context-compose', 12],
    ['context-compose', 'compose-summary', 14],
  ] as const) {
    nodes = toggleHierarchy(nodes, parent);
    assert.equal(endpoint(), target);
    assert.equal(hierarchyProjection(nodes).nodes.length, count);
  }
  const expanded = hierarchyProjection(nodes);
  assert.equal(expanded.edges.length, recursiveStage.graph.edges.length);
  assert.ok(expanded.edges.every((edge) => expanded.nodeById.has(edge.source.nodeId) && expanded.nodeById.has(edge.target.nodeId)));
  for (const [parent, target] of [['context-compose', 'context-compose'], ['session-context', 'session-context'], ['session', 'session']] as const) {
    nodes = toggleHierarchy(nodes, parent);
    assert.equal(endpoint(), target);
  }
  assert.equal(hierarchyProjection(nodes).nodes.length, overview.nodes.length);
  for (const id of ['entry', 'session', 'scheduler', 'tools', 'memory-durable', 'bus', 'audit']) {
    assert.deepEqual(nodes.find((node) => node.id === id)!.position, createHierarchyNodes().find((node) => node.id === id)!.position);
  }
});

test('recursive growth keeps children inside their containers and separates affected siblings', () => {
  let nodes = createHierarchyNodes();
  for (const id of ['session', 'session-context', 'context-compose']) nodes = toggleHierarchy(nodes, id);
  for (const node of nodes.filter((item) => item.parentId)) {
    const parent = nodes.find((item) => item.id === node.parentId)!;
    assert.ok(node.position.x >= 24);
    assert.ok(node.position.y >= 72);
    assert.ok(node.position.x + node.width! <= parent.width! - 24, node.id + ' fits horizontally');
    assert.ok(node.position.y + node.height! <= parent.height! - 24, node.id + ' fits vertically');
  }
  const session = nodes.find((node) => node.id === 'session')!;
  const scheduler = nodes.find((node) => node.id === 'scheduler')!;
  assert.ok(scheduler.position.y >= session.position.y + session.height!);
});

test('collapse preserves deep expansion and dragged local positions, while moving a parent translates descendants', () => {
  let nodes = createHierarchyNodes();
  for (const id of ['session', 'session-context', 'context-compose']) nodes = toggleHierarchy(nodes, id);
  nodes = nodes.map((node) => node.id === 'compose-trim' ? { ...node, position: { x: node.position.x + 12, y: node.position.y + 15 } } : node);
  const before = worldPosition(nodes.find((node) => node.id === 'compose-trim')!, nodes);
  nodes = toggleHierarchy(nodes, 'session');
  assert.ok(!hierarchyProjection(nodes).nodeById.has('compose-trim'));
  nodes = nodes.map((node) => node.id === 'session' ? { ...node, position: { x: node.position.x + 140, y: node.position.y + 20 } } : node);
  nodes = toggleHierarchy(nodes, 'session');
  assert.ok(hierarchyProjection(nodes).nodeById.has('compose-trim'));
  assert.deepEqual(worldPosition(nodes.find((node) => node.id === 'compose-trim')!, nodes), { x: before.x + 140, y: before.y + 20 });
});

test('expansion inside a manually created frame enlarges that frame without changing the other child local position', () => {
  let nodes: CanvasNode[] = createHierarchyNodes().map((node) => ({ ...node, selected: ['entry', 'session'].includes(node.id) }));
  nodes = groupSelection(nodes, 'frame');
  const entry = nodes.find((node) => node.id === 'entry')!;
  const entryPosition = { ...entry.position };
  nodes = toggleHierarchy(nodes, 'session');
  const frame = nodes.find((node) => node.id === 'frame')!;
  const session = nodes.find((node) => node.id === 'session')!;
  assert.deepEqual(nodes.find((node) => node.id === 'entry')!.position, entryPosition);
  assert.ok(frame.width! >= session.position.x + session.width! + 24);
  assert.ok(frame.height! >= session.position.y + session.height! + 24);
});

test('cross-layer routes pass container boundaries without intersecting visible cards', () => {
  let nodes = createHierarchyNodes();
  for (const id of [undefined, 'session', 'session-context', 'context-compose']) {
    if (id) nodes = toggleHierarchy(nodes, id);
    const projection = hierarchyProjection(nodes);
    const obstacles = nodes.filter((node) => node.type === 'card' && projection.nodeById.has(node.id)).map((node) => obstacleFromRect({ ...worldPosition(node, nodes), w: node.width!, h: node.height! }, 0));
    for (const edge of projection.edges) {
      const route = routeDiagramEdge(nodes, projection, edge.source.nodeId, edge.target.nodeId);
      assert.ok(validateOrthogonalPath(route.points, obstacles), `${id ?? 'overview'}: ${edge.canonicalEdgeId} avoids visible cards`);
    }
  }
});

test('expanding a moved hierarchy keeps downstream branches in their original horizontal lanes', () => {
  let nodes = createHierarchyNodes();
  for (const id of ['session', 'session-context', 'context-compose']) nodes = toggleHierarchy(nodes, id);
  nodes = nodes.map((node) => node.id === 'session' ? { ...node, position: { x: node.position.x + 32, y: node.position.y + 18 } } : node);
  for (const id of ['session', 'session', 'session-context', 'session-context']) nodes = toggleHierarchy(nodes, id);
  for (const id of ['bus', 'audit', 'tools', 'memory-durable']) {
    assert.equal(nodes.find((node) => node.id === id)!.position.x, createHierarchyNodes().find((node) => node.id === id)!.position.x);
  }
});

test('folding and reopening retain the original automatic expansion ceiling', () => {
  let nodes = toggleHierarchy(createHierarchyNodes(), 'session');
  const baseline = nodes.find((node) => node.id === 'session')!.data.contentWidth!;
  const drag = () => {
    const projection = hierarchyProjection(nodes);
    nodes = constrainNodeMoves(nodes, nodes.map((node) => node.id === 'session-dispatch' ? { ...node, position: { ...node.position, x: 10000 } } : node), ['session-dispatch'], 1, new Set(projection.nodes.map((node) => node.id)), []).nodes;
  };
  drag();
  const maxWidth = nodes.find((node) => node.id === 'session')!.width;
  for (let i = 0; i < 4; i++) { nodes = toggleHierarchy(toggleHierarchy(nodes, 'session'), 'session'); drag(); }
  assert.equal(nodes.find((node) => node.id === 'session')!.width, maxWidth);
  assert.equal(nodes.find((node) => node.id === 'session')!.data.contentWidth, baseline);
});

test('grouped internal cards retain canonical folding and route endpoints', () => {
  let nodes = createHierarchyNodes();
  for (const id of ['session', 'session-context', 'context-compose']) nodes = toggleHierarchy(nodes, id);
  nodes = groupSelection(nodes.map((node) => ({ ...node, selected: ['compose-trim', 'compose-summary'].includes(node.id) })), 'internal-group');
  const group = nodes.find((node) => node.id === 'internal-group')!;
  assert.equal(group.parentId, 'context-compose');
  const session = nodes.find((node) => node.id === 'session')!;
  const scheduler = nodes.find((node) => node.id === 'scheduler')!;
  assert.ok(scheduler.position.y >= session.position.y + session.height! + 24);
  assert.equal(hierarchyProjection(nodes).edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')!.target.nodeId, 'compose-summary');
  nodes = toggleHierarchy(nodes, 'context-compose');
  assert.ok(!nodeIsVisible(nodes.find((node) => node.id === group.id)!, nodes, hierarchyProjection(nodes)));
  nodes = toggleHierarchy(nodes, 'context-compose');
  assert.ok(nodeIsVisible(nodes.find((node) => node.id === group.id)!, nodes, hierarchyProjection(nodes)));
  assert.equal(nodes.find((node) => node.id === 'compose-summary')!.parentId, group.id);
});

test('labels stay on or immediately beside their routes at each recursive depth', () => {
  let nodes = createHierarchyNodes();
  for (const id of [undefined, 'session', 'session-context', 'context-compose']) {
    if (id) nodes = toggleHierarchy(nodes, id);
    const projection = hierarchyProjection(nodes);
    const visible = nodes.filter((node) => nodeIsVisible(node, nodes, projection));
    const bounds = (node: CanvasNode): Rect => ({ ...worldPosition(node, nodes), w: node.width!, h: node.height! });
    const blockers = visible.map((node) => node.type === 'card' ? bounds(node) : { ...bounds(node), h: node.type === 'structure' ? 68 : 54 });
    const frames = visible.filter((node) => node.type !== 'card').map(bounds);
    const occupied: Rect[] = [];
    for (const edge of projection.edges) {
      const route = routeDiagramEdge(nodes, projection, edge.source.nodeId, edge.target.nodeId);
      const label = placeEdgeLabel(route.points, edge.label ?? '', blockers, frames, occupied);
      const nearest = Math.min(...route.points.slice(1).map((point, index) => {
        const start = route.points[index]!;
        const x = Math.max(Math.min(start.x, point.x), Math.min(Math.max(start.x, point.x), label.x));
        const y = Math.max(Math.min(start.y, point.y), Math.min(Math.max(start.y, point.y), label.y));
        return Math.hypot(x - label.x, y - label.y);
      }));
      assert.ok(nearest <= Math.max(label.width, label.height) / 2 + 4, `${id ?? 'overview'} ${edge.label}: ${nearest}`);
      occupied.push({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
    }
  }
});

test('repeated cross-layer grouping retains canonical endpoints and routes around rearranged cards and titles', () => {
  let nodes = createHierarchyNodes();
  for (const id of ['session', 'session-context', 'context-compose']) nodes = toggleHierarchy(nodes, id);
  for (const [id, members] of [['inner-group', ['compose-trim', 'compose-summary']], ['outer-group', ['context-history', 'compose-trim']]] as const) {
    nodes = groupSelection(nodes.map((node) => ({ ...node, selected: members.some((member) => member === node.id) })), id);
  }
  const projection = hierarchyProjection(nodes);
  assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')!.target.nodeId, 'compose-summary');
  const obstacles = nodes.filter((node) => nodeIsVisible(node, nodes, projection)).map((node) => obstacleFromRect({ ...worldPosition(node, nodes), w: node.width!, h: node.type === 'card' ? node.height! : node.type === 'structure' ? 68 : 54 }, 0));
  for (const edge of projection.edges) {
    const route = routeDiagramEdge(nodes, projection, edge.source.nodeId, edge.target.nodeId);
    assert.ok(validateOrthogonalPath(route.points, obstacles), `${edge.canonicalEdgeId} avoids cards after regrouping`);
  }
});

test('left and top expansion retain descendant world coordinates across folding and parent movement', () => {
  let nodes = createHierarchyNodes();
  for (const id of ['session', 'session-context', 'context-compose']) nodes = toggleHierarchy(nodes, id);
  const dispatch = nodes.find((node) => node.id === 'session-dispatch')!;
  const target = { x: dispatch.position.x - 300, y: dispatch.position.y - 250 };
  nodes = constrainNodeMoves(nodes, nodes.map((node) => node.id === dispatch.id ? { ...node, position: target } : node), [dispatch.id], 1, new Set(hierarchyProjection(nodes).nodes.map((node) => node.id)), []).nodes;
  const parent = nodes.find((node) => node.id === 'session')!;
  assert.ok(parent.position.y < 150);
  const before = worldPosition(nodes.find((node) => node.id === 'compose-summary')!, nodes);
  const size = { width: parent.width, height: parent.height };
  nodes = toggleHierarchy(toggleHierarchy(nodes, 'session'), 'session');
  assert.deepEqual(worldPosition(nodes.find((node) => node.id === 'compose-summary')!, nodes), before);
  assert.deepEqual({ width: nodes.find((node) => node.id === 'session')!.width, height: nodes.find((node) => node.id === 'session')!.height }, size);
  nodes = nodes.map((node) => node.id === 'session' ? { ...node, position: { x: node.position.x + 40, y: node.position.y + 30 } } : node);
  assert.deepEqual(worldPosition(nodes.find((node) => node.id === 'compose-summary')!, nodes), { x: before.x + 40, y: before.y + 30 });
});

test('fractional upward dragging reaches the ceiling without repeating boundary reflow', () => {
  let nodes = toggleHierarchy(createHierarchyNodes(), 'session');
  for (const distance of [170 / 1.15, 100 / 1.15, 100 / 1.15]) {
    const dispatch = nodes.find((node) => node.id === 'session-dispatch')!;
    nodes = constrainNodeMoves(nodes, nodes.map((node) => node.id === dispatch.id ? { ...node, position: { ...node.position, y: node.position.y - distance } } : node), [dispatch.id], 1.15, new Set(hierarchyProjection(nodes).nodes.map((node) => node.id)), []).nodes;
  }
  const session = nodes.find((node) => node.id === 'session')!;
  assert.ok(Math.abs(session.height! - session.data.contentHeight! * 2) < 0.01);
  assert.ok(session.position.y < 0);
});
