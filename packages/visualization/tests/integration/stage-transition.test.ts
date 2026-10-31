import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptProgressReports, type ReportDataset } from '../../src/adapters/progress-reports/index.ts';
import type { ChangeMark, VisualizationBaseline } from '../../src/core/schema/baseline.ts';
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';
import { captureContent, type FrozenGroupSnapshot } from '../../src/react/model/workspace.ts';
import { createHierarchyNodes, toggleHierarchy, baselineNodes } from '../../src/react/model/hierarchy.ts';
import { freezeSelection } from '../../src/react/model/frozen.ts';
import { worldPosition, type CanvasNode } from '../../src/react/model/grouping.ts';
import { planStageTransition } from '../../src/react/model/stage-transition.ts';
import { projectGraph } from '../../src/core/projection/index.ts';
import { aggregateProjectedEdges } from '../../src/react/model/display-edges.ts';
import { DiagramRouteCache } from '../../src/react/model/route-cache.ts';
import { routeSnapshotForEdge } from '../../src/react/model/edge-routes.ts';

function entity(id: string, parentId: string | null, order: number, kind: CanonicalNode['kind'] = parentId === null ? 'root' : 'component'): CanonicalNode {
  return { id, parentId, kind, label: id, summary: `${id} summary`, order, ports: [] };
}

function stage(id: string, nodes: readonly CanonicalNode[], edges: readonly CanonicalEdge[], revision = 'r1'): StageSnapshot {
  return { id, label: id, title: id, track: 'main', order: Number(id.replace(/\D/g, '')) || 0, graph: { rootId: 'root', revision, nodes, edges } };
}

function marks(nodes: readonly CanonicalNode[], kind: ChangeMark['kind'] = 'inherited'): Record<string, ChangeMark> {
  return Object.fromEntries(nodes.filter((node) => node.parentId !== null).map((node) => [node.id, { kind, label: kind }]));
}

function baseline(id: string, snapshot: StageSnapshot, changes: Record<string, ChangeMark>, positions?: Record<string, { x: number; y: number }>): VisualizationBaseline {
  return { id, stage: snapshot, nodeChanges: changes, edgeChanges: {}, ...(positions ? { positions } : {}) };
}

const initialNodes = [entity('root', null, 0), entity('module', 'root', 1, 'group'), entity('first', 'module', 2), entity('outside', 'root', 3)];
const addedNodes = [...initialNodes, entity('second', 'module', 4)];
const positions = { module: { x: 300, y: 200 }, first: { x: 24, y: 72 }, outside: { x: 1800, y: 1800 } };

const first = baseline('one', stage('one', initialNodes, [], 'one-r1'), marks(initialNodes, 'baseline'), positions);
const second = baseline('two', stage('two', addedNodes, [], 'two-r1'), {
  ...marks(initialNodes, 'inherited'),
  second: { kind: 'added', label: '新增' },
}, positions);

const expandedSource = (): CanvasNode[] => toggleHierarchy(createHierarchyNodes(first.stage, first.positions), 'module', first.stage);

test('report M1 to M2 leaves confirmed source geometry unchanged when transition cannot preserve it', () => {
  const dataset = JSON.parse(readFileSync(new URL('../../datasets/progress-reports/architecture.json', import.meta.url), 'utf8')) as ReportDataset;
  const [m1, m2] = adaptProgressReports(dataset);
  const source = captureContent(baselineNodes(m1!));
  const original = JSON.stringify(source);
  const result = planStageTransition({ source: m1!, target: m2!, sourceContent: source });
  assert.equal(JSON.stringify(source), original);
  if (!result.ok) assert.ok(result.conflicts.length > 0);
  else {
    for (const view of source.nodes) {
      const node: CanvasNode | undefined = result.state.nodes.find((item) => item.id === view.id);
      if (!node) continue;
      const before = baselineNodes(m1!).find((item) => item.id === view.id)!;
      assert.deepEqual(worldPosition(node, result.state.nodes), worldPosition(before, baselineNodes(m1!)));
    }
  }
});

test('first visit inherits confirmed layout, expands only necessary ancestors and places added nodes', () => {
  const sourceNodes = createHierarchyNodes(first.stage, first.positions);
  const source = captureContent(sourceNodes);
  const result = planStageTransition({ source: first, target: second, sourceContent: source });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.record.expanded.includes('module'));
  assert.deepEqual(result.record.placements.map((item) => item.nodeId), ['second']);
  const inherited = result.state.nodes.find((node) => node.id === 'first')!;
  const placed = result.state.nodes.find((node) => node.id === 'second')!;
  assert.deepEqual(worldPosition(inherited, result.state.nodes), worldPosition(sourceNodes.find((node) => node.id === 'first')!, sourceNodes));
  const parent = result.state.nodes.find((node) => node.id === 'module')!;
  const parentWorld = worldPosition(parent, result.state.nodes);
  const placedWorld = worldPosition(placed, result.state.nodes);
  assert.ok(placedWorld.x >= parentWorld.x && placedWorld.y >= parentWorld.y);
  assert.equal(result.base.nodes.length, second.stage.graph.nodes.length - 1);
});

test('a frozen parent admits new free children without moving frozen members', () => {
  const source = captureContent(expandedSource());
  const frozen: FrozenGroupSnapshot = {
    id: 'freeze:module', rootId: 'module', memberIds: ['first'],
    worldBounds: { x: 300, y: 200, w: 240, h: 82 }, boundaryPorts: [], createdAt: 'now',
  };
  const before = JSON.stringify(source);
  const result = planStageTransition({ source: first, target: second, sourceContent: { ...source, frozenGroups: [frozen] } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.nodes.find((node) => node.id === 'first')!.data.layoutMode, 'locked');
  assert.equal(result.state.nodes.find((node) => node.id === 'second')!.data.layoutMode ?? 'free', 'free');
  assert.deepEqual(result.state.frozenGroups[0]!.memberIds, ['first']);
  assert.deepEqual(worldPosition(result.state.nodes.find((node) => node.id === 'first')!, result.state.nodes), worldPosition(expandedSource().find((node) => node.id === 'first')!, expandedSource()));
  assert.equal(JSON.stringify(source), before);
  assert.ok(result.state.nodes.some((node) => node.id === 'second'));
});

test('a source removal of a frozen member blocks the transition', () => {
  const frozen = freezeSelection({ nodes: expandedSource(), rootIds: ['module'], groupId: 'freeze:module', stage: first.stage });
  assert.equal(frozen.ok, true);
  if (!frozen.ok) return;
  const targetNodes = initialNodes.filter((node) => node.id !== 'first');
  const target = baseline('two', stage('two', targetNodes, []), marks(targetNodes));
  const source = captureContent(frozen.nodes, [], [frozen.group]);
  const before = JSON.stringify(source);
  const result = planStageTransition({ source: first, target, sourceContent: source });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.conflicts.some((item) => item.kind === 'merge-conflict' && item.entityIds.includes('first')));
  assert.equal(JSON.stringify(source), before);
});

test('expansion preserves an existing free node while placing additions', () => {
  const tight = { ...positions, outside: { x: 900, y: 200 } };
  const source = captureContent(createHierarchyNodes(first.stage, tight));
  const result = planStageTransition({ source: first, target: second, sourceContent: source });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.state.nodes.find((node) => node.id === 'outside')!.position, tight.outside);
});

test('replacement provenance inherits the previous layout instead of placing a new node', () => {
  const oldNodes = [entity('root', null, 0), entity('module', 'root', 1, 'group'), entity('old', 'module', 2)];
  const newNodes = [entity('root', null, 0), entity('module', 'root', 1, 'group'), entity('new', 'module', 2)];
  const oldBaseline = baseline('one', stage('one', oldNodes, [], 'one-r1'), marks(oldNodes, 'baseline'), { module: { x: 120, y: 80 }, old: { x: 24, y: 72 } });
  const newBaseline = baseline('two', stage('two', newNodes, [], 'two-r1'), {
    module: { kind: 'inherited', label: '沿用' },
    new: { kind: 'replaced', label: '替换', previousId: 'old' },
  }, { module: { x: 120, y: 80 }, new: { x: 24, y: 72 } });
  const source = captureContent(createHierarchyNodes(oldBaseline.stage, oldBaseline.positions));
  const result = planStageTransition({ source: oldBaseline, target: newBaseline, sourceContent: source });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.record.placements, []);
  const previous = source.nodes.find((node) => node.id === 'old')!;
  const replacement = result.state.nodes.find((node) => node.id === 'new')!;
  assert.deepEqual(replacement.position, { x: previous.position.x, y: previous.position.y });
});

test('a frozen subtree survives a successful transition when new entities stay outside it', () => {
  const frozen = freezeSelection({ nodes: expandedSource(), rootIds: ['module'], groupId: 'freeze:module', stage: first.stage });
  assert.equal(frozen.ok, true);
  if (!frozen.ok) return;
  const source = captureContent(frozen.nodes, [], [frozen.group]);
  const outsideNodes = [...initialNodes, entity('third', 'root', 4)];
  const target = baseline('two', stage('two', outsideNodes, [], 'two-r1'), {
    ...marks(initialNodes, 'inherited'),
    third: { kind: 'added', label: '新增' },
  }, positions);
  const result = planStageTransition({ source: first, target, sourceContent: source });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const id of ['module', 'first']) {
    const before = worldPosition(frozen.nodes.find((node) => node.id === id)!, frozen.nodes);
    const after = worldPosition(result.state.nodes.find((node) => node.id === id)!, result.state.nodes);
    assert.deepEqual(after, before);
  }
  assert.ok(result.state.nodes.some((node) => node.id === 'third'));
  assert.deepEqual(result.state.frozenGroups, [frozen.group]);
});

test('a locked internal route survives a transition and does not confuse parent frames with obstacles', () => {
  const inside = { id: 'inside', source: { nodeId: 'first' }, target: { nodeId: 'second' }, relation: 'data' as const, direction: 'directed' as const, label: 'inside', order: 0 };
  const routeNodes = [...initialNodes, entity('second', 'module', 4)];
  const one = stage('one', routeNodes, [inside], 'one-r1');
  const two = stage('two', [...routeNodes, entity('third', 'root', 5)], [inside], 'two-r1');
  const sourceBaseline: VisualizationBaseline = { ...first, stage: one, nodeChanges: marks(routeNodes, 'baseline'), edgeChanges: { inside: { kind: 'baseline', label: '基线' } } };
  const targetBaseline: VisualizationBaseline = {
    ...second, stage: two,
    nodeChanges: { ...marks(routeNodes, 'inherited'), third: { kind: 'added', label: '新增' } },
    edgeChanges: { inside: { kind: 'inherited', label: '沿用' } },
  };
  const sourceNodes = toggleHierarchy(createHierarchyNodes(one, positions), 'module', one);
  const projection = projectGraph(one, ['module']);
  const edges = aggregateProjectedEdges(projection, sourceBaseline.edgeChanges);
  const edge = edges.find((item) => item.id === 'inside')!;
  const routes = new DiagramRouteCache().update(sourceNodes, projection, edges.map((item) => ({ id: item.id, source: item.source, target: item.target, text: item.text })));
  const snapshot = routeSnapshotForEdge(edge, routes.get('inside')!, 'locked', sourceNodes, [])!;
  const result = planStageTransition({ source: sourceBaseline, target: targetBaseline, sourceContent: captureContent(sourceNodes, [snapshot]) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.edgeRoutes, [snapshot]);
  assert.ok(result.state.nodes.some((node) => node.id === 'third'));
  const changedTarget = { ...targetBaseline, stage: { ...two, graph: { ...two.graph, nodes: two.graph.nodes.map((node) => node.id === 'first' ? { ...node, ports: [{ id: 'changed', direction: 'out' as const, side: 'right' as const, order: 0 }] } : node), edges: [{ ...inside, source: { nodeId: 'first', portId: 'changed' } }] } } };
  const conflict = planStageTransition({ source: sourceBaseline, target: changedTarget, sourceContent: captureContent(sourceNodes, [snapshot]) });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.ok(conflict.conflicts.some((item) => item.kind === 'locked-route'));
});

test('a saved target revision is the merge base for new source entities', () => {
  const savedNodes = toggleHierarchy(baselineNodes(second), 'module', second.stage).map((node) => node.id === 'first' ? { ...node, position: { x: 48, y: 96 } } : node);
  const saved = captureContent(savedNodes);
  const result = planStageTransition({ source: first, target: second, sourceContent: captureContent(expandedSource()), targetSaved: saved, targetSavedRevision: 'two-r0' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const firstNode = result.state.nodes.find((node) => node.id === 'first')!;
  assert.deepEqual(firstNode.position, { x: 48, y: 96 });
});
