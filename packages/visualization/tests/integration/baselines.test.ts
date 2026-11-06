import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleBaselines as baselineOptions } from '../fixtures/baselines.ts';
import type { StageSnapshot } from '../../src/core/schema/types.ts';
type BaselineId = 'M1' | 'M2';
const getBaseline = (id: string) => baselineOptions.find((baseline) => baseline.id === id)!;
import { createHierarchyNodes as createNodes, toggleHierarchy, syncHierarchyExpansion } from '../../src/react/model/layout/hierarchy.ts';
import { hierarchyProjection, nodeIsVisible } from '../../src/react/model/layout/visibility.ts';
import { CARD_SIZE, worldPosition, type CanvasNode } from '../../src/react/model/layout/node.ts';
import { groupSelection } from '../../src/react/model/layout/grouping.ts';
import { routeDiagramEdge } from '../../src/react/model/routing/routing.ts';
import { LabelLayoutCache } from '../../src/react/model/labels/label-layout.ts';
import { aggregateProjectedEdges } from '../../src/react/model/routing/display-edges.ts';
import { DiagramRouteCache } from '../../src/react/model/routing/route-cache.ts';
import { obstacleFromRect, type Rect } from '../../src/core/layout/geometry.ts';
import { validateOrthogonalPath } from '../helpers/geometry.ts';

const createHierarchyNodes = (stage: StageSnapshot) => createNodes(stage, baselineOptions.find((baseline) => baseline.stage === stage)!.positions);

test('stage expansion synchronization retains a rejected branch and applies independent branches', () => {
  const stage: StageSnapshot = { id: 'sync', label: 'sync', title: 'sync', order: 0, track: 'main', graph: {
    rootId: 'root', nodes: [
      { id: 'root', parentId: null, kind: 'root', label: 'root', order: 0, ports: [] },
      ...['a', 'b'].flatMap((id, order) => [
        { id, parentId: 'root', kind: 'component' as const, label: id, order, ports: [] },
        { id: `${id}-child`, parentId: id, kind: 'component' as const, label: `${id}-child`, order: 0, ports: [] },
      ]),
    ], edges: [],
  } };
  const target = createNodes(stage, { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
  const source = target.map(node => ({ ...node, data: { ...node.data, expanded: !!node.data.expandable } }));
  const next = syncHierarchyExpansion(target, source, stage, (before, after) => before.find(node => node.id === 'a')!.data.expanded === after.find(node => node.id === 'a')!.data.expanded);
  assert.equal(next.find(node => node.id === 'a')!.data.expanded, false);
  assert.equal(next.find(node => node.id === 'b')!.data.expanded, true);
  assert.deepEqual(next.find(node => node.id === 'a')!.position, target.find(node => node.id === 'a')!.position);
});

const EPSILON = 0.000001;
const bounds = (node: CanvasNode, nodes: readonly CanvasNode[]): Rect => ({ ...worldPosition(node, nodes), w: node.width!, h: node.height! });
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w - EPSILON && a.x + a.w > b.x + EPSILON
  && a.y < b.y + b.h - EPSILON && a.y + a.h > b.y + EPSILON;
const expand = (rect: Rect, margin: number): Rect => ({ x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 });
const contains = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON
  && inner.x + inner.w <= outer.x + outer.w + EPSILON && inner.y + inner.h <= outer.y + outer.h + EPSILON;
function ancestorOf(ancestor: string, node: CanvasNode, nodes: readonly CanvasNode[]): boolean {
  let parentId = node.parentId;
  while (parentId) {
    if (parentId === ancestor) return true;
    parentId = nodes.find((item) => item.id === parentId)?.parentId;
  }
  return false;
}

test('switching the baseline snapshot changes the overview and retains its canonical identity', () => {
  for (const [id, count, memoryId] of [['M1', 6, 'memory'], ['M2', 7, 'memory-durable'], ['M1', 6, 'memory']] as const) {
    const { stage } = getBaseline(id);
    const nodes = createHierarchyNodes(stage);
    const projection = hierarchyProjection(nodes, stage);
    assert.equal(projection.nodes.length, count, id);
    assert.ok(projection.nodeById.has(memoryId));
    assert.equal(projection.nodeById.has('audit'), id === 'M2');
    assert.equal(projection.nodeById.has('memory-durable'), id === 'M2');
    assert.equal(projection.nodeById.has('memory'), id === 'M1');
    assert.equal(projection.nodeById.has('notify'), false);
    assert.equal(projection.nodeById.has('console'), false);
  }
});

test('both baseline hierarchies expand through three levels to the canonical internal endpoints', () => {
  for (const { stage, id } of baselineOptions) {
    let nodes = createHierarchyNodes(stage);
    for (const [owner, returnTarget] of [['session', 'session-context'], ['session-context', 'context-compose'], ['context-compose', 'compose-summary']] as const) {
      nodes = toggleHierarchy(nodes, owner, stage);
      const projection = hierarchyProjection(nodes, stage);
      assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')?.target.nodeId, returnTarget, `${id} ${owner}`);
      assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-entry-session')?.target.nodeId, 'session-receive');
      assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-session-scheduler')?.source.nodeId, 'session-dispatch');
    }
    const projection = hierarchyProjection(nodes, stage);
    assert.equal(projection.nodes.length, stage.graph.nodes.length - 1);
    assert.equal(projection.edges.length, stage.graph.edges.length);
    assert.ok(nodes.every((node) => nodeIsVisible(node, nodes, projection)));
    for (const edge of stage.graph.edges) {
      const projected = projection.edges.find((item) => item.canonicalEdgeId === edge.id)!;
      assert.equal(projected.source.nodeId, edge.source.nodeId);
      assert.equal(projected.target.nodeId, edge.target.nodeId);
    }
  }
});

test('both baseline layouts separate unrelated objects and keep routes outside cards and titles at every depth', () => {
  for (const { stage, id } of baselineOptions) {
    let nodes = createHierarchyNodes(stage);
    for (const owner of [undefined, 'session', 'session-context', 'context-compose']) {
      if (owner) nodes = toggleHierarchy(nodes, owner, stage);
      const projection = hierarchyProjection(nodes, stage);
      const visible = nodes.filter((node) => nodeIsVisible(node, nodes, projection));
      for (let first = 0; first < visible.length; first++) for (let second = first + 1; second < visible.length; second++) {
        const a = visible[first]!, b = visible[second]!;
        if (ancestorOf(a.id, b, nodes) || ancestorOf(b.id, a, nodes)) continue;
        assert.ok(!overlaps(bounds(a, nodes), bounds(b, nodes)), `${id}/${owner ?? 'overview'}: ${a.id} overlaps ${b.id}`);
      }
      const obstacles = visible.map((node) => obstacleFromRect({ ...bounds(node, nodes), h: node.type === 'card' ? node.height! : 68 }, 0));
      for (const edge of projection.edges) {
        const route = routeDiagramEdge(nodes, projection, edge.source.nodeId, edge.target.nodeId);
        assert.ok(validateOrthogonalPath(route.points, obstacles), `${id}/${owner ?? 'overview'}: ${edge.canonicalEdgeId} crosses content`);
      }
    }
  }
});

test('complete relation and change labels avoid cards, titles, frame borders and other labels at every depth', () => {
  for (const { stage, id, edgeChanges } of baselineOptions) {
    let nodes = createHierarchyNodes(stage);
    for (const owner of [undefined, 'session', 'session-context', 'context-compose']) {
      if (owner) nodes = toggleHierarchy(nodes, owner, stage);
      const projection = hierarchyProjection(nodes, stage);
      const visible = nodes.filter((node) => nodeIsVisible(node, nodes, projection));
      const blockers = visible.map((node) => ({ ...bounds(node, nodes), h: node.type === 'card' ? node.height! : 68 }));
      const frames = visible.filter((node) => node.type !== 'card').map((node) => bounds(node, nodes));
      const edges = aggregateProjectedEdges(projection, edgeChanges);
      const routes = new DiagramRouteCache().update(nodes, projection, edges);
      const labels = new LabelLayoutCache().update(nodes, projection, edges, routes);
      assert.ok(labels.stats.visible > 0);
      const occupied: Rect[] = [];
      for (const [edgeId, result] of labels.labels) {
        const label = result.placement;
        if (!label) continue;
        const rect = { x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height };
        const context = `${id}/${owner ?? 'overview'} ${edgeId} ${result.fullText}`;
        assert.ok(label.width >= 44 && label.height >= 24, context);
        assert.ok(blockers.every((blocker) => !overlaps(rect, expand(blocker, 8))) && occupied.every((other) => !overlaps(rect, other)), `${context}: overlaps a card, header or label`);
        assert.ok(frames.every((frame) => contains(expand(frame, -8), rect) || !overlaps(expand(frame, 8), rect)), `${context}: crosses a frame border`);
        occupied.push(rect);
      }
    }
  }
});

const hierarchyOwners = ['session', 'session-context', 'context-compose'] as const;
function fullyExpanded(id: BaselineId): CanvasNode[] {
  const { stage } = getBaseline(id);
  return hierarchyOwners.reduce((nodes, owner) => toggleHierarchy(nodes, owner, stage), createHierarchyNodes(stage));
}
const expansionState = (nodes: readonly CanvasNode[]) => Object.fromEntries(nodes.filter((node) => node.data.expandable).map((node) => [node.id, !!node.data.expanded]));

test('first visits transfer all three open levels from M2 to M1 and from M1 to M2', () => {
  for (const [sourceId, targetId] of [['M2', 'M1'], ['M1', 'M2']] as const) {
    const source = fullyExpanded(sourceId), { stage } = getBaseline(targetId);
    const target = syncHierarchyExpansion(createHierarchyNodes(stage), source, stage);
    assert.deepEqual(expansionState(target), expansionState(source));
    const projection = hierarchyProjection(target, stage);
    assert.equal(projection.nodes.length, stage.graph.nodes.length - 1);
    assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')?.target.nodeId, 'compose-summary');
    assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-entry-session')?.target.nodeId, 'session-receive');
    assert.equal(projection.nodeById.has('memory-durable'), targetId === 'M2');
    assert.equal(projection.nodeById.has('audit'), targetId === 'M2');
  }
});

test('the source expansion state overrides a differently expanded target cache in either direction', () => {
  for (const [sourceId, targetId] of [['M1', 'M2'], ['M2', 'M1']] as const) {
    const sourceStage = getBaseline(sourceId).stage, targetStage = getBaseline(targetId).stage;
    const source = toggleHierarchy(createHierarchyNodes(sourceStage), 'session', sourceStage);
    const target = syncHierarchyExpansion(fullyExpanded(targetId), source, targetStage);
    assert.deepEqual(expansionState(target), expansionState(source));
    const projection = hierarchyProjection(target, targetStage);
    assert.ok(projection.nodeById.has('session-context'));
    assert.equal(projection.nodeById.has('context-history'), false);
    assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')?.target.nodeId, 'session-context');
  }
});

test('closed ancestors retain card dimensions while hidden descendant expansion is transferred and restored on reopening', () => {
  for (const [sourceId, targetId] of [['M2', 'M1'], ['M1', 'M2']] as const) {
    const sourceStage = getBaseline(sourceId).stage, targetStage = getBaseline(targetId).stage;
    const source = toggleHierarchy(fullyExpanded(sourceId), 'session', sourceStage);
    let target = syncHierarchyExpansion(createHierarchyNodes(targetStage), source, targetStage);
    assert.deepEqual(expansionState(target), expansionState(source));
    const session = target.find((node) => node.id === 'session')!;
    assert.equal(session.type, 'card');
    assert.deepEqual({ width: session.width, height: session.height }, CARD_SIZE);
    assert.equal(hierarchyProjection(target, targetStage).nodeById.has('compose-summary'), false);
    target = toggleHierarchy(target, 'session', targetStage);
    const projection = hierarchyProjection(target, targetStage);
    assert.ok(projection.nodeById.has('compose-summary'));
    assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')?.target.nodeId, 'compose-summary');
    assert.ok(target.find((node) => node.id === 'session')!.height! > CARD_SIZE.height);
  }
});

test('synchronizing a target with a manual group preserves its group ownership and title', () => {
  const source = fullyExpanded('M2'), { stage } = getBaseline('M1');
  let target = groupSelection(createHierarchyNodes(stage).map((node) => ({ ...node, selected: ['entry', 'session'].includes(node.id) })), 'saved-group');
  target = target.map((node) => node.id === 'saved-group' ? { ...node, data: { ...node.data, title: '接入与会话' } } : node);
  target = syncHierarchyExpansion(target, source, stage);
  const group = target.find((node) => node.id === 'saved-group')!;
  assert.equal(group.type, 'cluster');
  assert.equal(group.data.title, '接入与会话');
  assert.equal(target.find((node) => node.id === 'entry')!.parentId, group.id);
  assert.equal(target.find((node) => node.id === 'session')!.parentId, group.id);
  assert.deepEqual(expansionState(target), expansionState(source));
  assert.ok(nodeIsVisible(group, target, hierarchyProjection(target, stage)));
  assert.equal(hierarchyProjection(target, stage).edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')?.target.nodeId, 'compose-summary');
  for (const node of target.filter((item) => item.parentId === group.id)) assert.ok(contains(bounds(group, target), bounds(node, target)), node.id);
});

test('equal expansion states preserve cached coordinates and manual grouping without copying source positions', () => {
  const source = fullyExpanded('M2').map((node) => ({ ...node, position: { x: node.position.x + 500, y: node.position.y + 700 } }));
  let target = groupSelection(fullyExpanded('M1').map((node) => ({ ...node, selected: ['context-history', 'compose-trim'].includes(node.id) })), 'cached-inner-group');
  target = target.map((node) => node.id === 'cached-inner-group' ? { ...node, data: { ...node.data, title: '保留排版' }, position: { x: node.position.x + 20, y: node.position.y + 12 } } : node);
  const result = syncHierarchyExpansion(target, source, getBaseline('M1').stage);
  assert.deepEqual(result, target);
  for (const node of target) assert.deepEqual(worldPosition(result.find((item) => item.id === node.id)!, result), worldPosition(node, target), node.id);
});
