import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph } from '../../../core/projection/index.ts';
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../../../core/schema/types.ts';
import type { ChangeMark } from '../../../core/schema/baseline.ts';
import { aggregateProjectedEdges } from '../display-edges.ts';

const node = (id: string, parentId: string | null, order: number): CanonicalNode => ({ id, parentId, order, label: id, kind: parentId ? 'component' : 'root', ports: [] });
const link = (id: string, source: string, target: string, relation: CanonicalEdge['relation'] = 'call', direction: CanonicalEdge['direction'] = 'directed', order = 0): CanonicalEdge => ({
  id, source: { nodeId: source }, target: { nodeId: target }, label: id, relation, direction, order,
});
const stage = (edges: CanonicalEdge[]): StageSnapshot => ({
  id: 'stage', label: 'Stage', title: 'Architecture', track: 'main', order: 0,
  graph: { rootId: 'root', nodes: [node('root', null, 0), node('A', 'root', 1), node('B', 'root', 2), node('A/first', 'A', 0), node('A/second', 'A', 1), node('B/first', 'B', 0), node('B/second', 'B', 1)], edges },
});
const marks = (edges: readonly CanonicalEdge[], kind: ChangeMark['kind'] = 'inherited'): Record<string, ChangeMark> => Object.fromEntries(edges.map((edge) => [edge.id, { kind, label: { baseline: '基线', inherited: '沿用', added: '新增', replaced: '替换' }[kind] }]));

test('folded parallel relations aggregate with stable identity and ordered canonical membership', () => {
  const snapshot = stage([link('late', 'A/first', 'B/first', 'call', 'directed', 8), link('early', 'A/second', 'B/second', 'call', 'directed', 2)]);
  const original = structuredClone(snapshot);
  const projection = projectGraph(snapshot, []);
  const [result] = aggregateProjectedEdges(projection, marks(snapshot.graph.edges));
  assert.equal(result!.aggregated, true);
  assert.equal(result!.source, 'A');
  assert.equal(result!.target, 'B');
  assert.equal(result!.text, '2 条调用');
  assert.deepEqual(result!.members.map((member) => member.canonicalEdgeId), ['early', 'late']);
  assert.deepEqual(result!.members.map((member) => member.source.canonicalNodeId), ['A/second', 'A/first']);
  assert.equal(aggregateProjectedEdges({ ...projection, edges: [...projection.edges].reverse() }, marks(snapshot.graph.edges))[0]!.id, result!.id);
  assert.deepEqual(snapshot, original);
});

test('direction and relation types produce separate folded buckets', () => {
  const snapshot = stage([
    link('forward-1', 'A/first', 'B/first'), link('forward-2', 'A/second', 'B/second'),
    link('reverse', 'B/first', 'A/first'), link('event', 'A/first', 'B/first', 'event'),
    link('storage-1', 'A/first', 'B/first', 'storage', 'bidirectional'), link('storage-2', 'B/second', 'A/second', 'storage', 'bidirectional'),
  ]);
  const result = aggregateProjectedEdges(projectGraph(snapshot, []), marks(snapshot.graph.edges));
  assert.equal(result.length, 4);
  assert.equal(result.find((edge) => edge.text === '2 条调用')!.direction, 'directed');
  assert.equal(result.find((edge) => edge.id === 'reverse')!.source, 'B');
  assert.equal(result.find((edge) => edge.id === 'event')!.relation, 'event');
  const storage = result.find((edge) => edge.direction === 'bidirectional')!;
  assert.equal(storage.source, 'A');
  assert.equal(storage.target, 'B');
  assert.equal(storage.text, '2 条存储关系');
  assert.equal(storage.members.find((member) => member.canonicalEdgeId === 'storage-2')!.source.canonicalNodeId, 'B/second');
});

test('mixed changes expose explicit counts and retain member marks on a neutral aggregate', () => {
  const snapshot = stage([link('added', 'A/first', 'B/first'), link('replaced', 'A/first', 'B/second'), link('old', 'A/second', 'B/first')]);
  const changes: Record<string, ChangeMark> = { added: { kind: 'added', label: '新增' }, replaced: { kind: 'replaced', label: '替换', note: '实现替换' }, old: { kind: 'inherited', label: '沿用' } };
  const [result] = aggregateProjectedEdges(projectGraph(snapshot, []), changes);
  assert.equal(result!.text, '3 条调用 · 新增 1 · 替换 1');
  assert.equal(result!.change.kind, 'inherited');
  assert.equal(result!.added, 1);
  assert.equal(result!.replaced, 1);
  assert.deepEqual(result!.memberChanges, changes);
});

test('uniform additions and replacements carry the matching emphasis without inherited annotations', () => {
  const snapshot = stage([link('first', 'A/first', 'B/first'), link('second', 'A/second', 'B/second')]);
  for (const kind of ['added', 'replaced'] as const) {
    const [result] = aggregateProjectedEdges(projectGraph(snapshot, []), marks(snapshot.graph.edges, kind));
    assert.equal(result!.change.kind, kind);
    assert.equal(result!.text, kind === 'added' ? '2 条调用 · 新增 2' : '2 条调用 · 替换 2');
  }
  const [baseline] = aggregateProjectedEdges(projectGraph(snapshot, []), marks(snapshot.graph.edges, 'baseline'));
  assert.equal(baseline!.text, '2 条调用');
});

test('fully expanded parallel relations recover their original IDs and labels', () => {
  const snapshot = stage([link('first', 'A/first', 'B/first'), link('second', 'A/first', 'B/first')]);
  const result = aggregateProjectedEdges(projectGraph(snapshot, ['A', 'B']), marks(snapshot.graph.edges));
  assert.deepEqual(result.map((edge) => edge.id), ['first', 'second']);
  assert.ok(result.every((edge) => !edge.aggregated && edge.members.length === 1));
  assert.deepEqual(result.map((edge) => edge.text), ['first', 'second']);
});

test('single folded members retain their label and same-container internal relations stay hidden', () => {
  const snapshot = stage([link('external', 'A/first', 'B/first'), link('internal', 'A/first', 'A/second')]);
  const result = aggregateProjectedEdges(projectGraph(snapshot, []), marks(snapshot.graph.edges, 'added'));
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, 'external');
  assert.equal(result[0]!.text, 'external · 新增');
  assert.equal(result[0]!.aggregated, false);
});

test('partial expansion keeps a shared folded endpoint aggregated until its descendants become visible', () => {
  const snapshot = stage([link('first', 'A/first', 'B/first'), link('second', 'A/first', 'B/second')]);
  const changes = marks(snapshot.graph.edges);
  const partial = aggregateProjectedEdges(projectGraph(snapshot, ['A']), changes);
  assert.equal(partial.length, 1);
  assert.equal(partial[0]!.source, 'A/first');
  assert.equal(partial[0]!.target, 'B');
  assert.equal(partial[0]!.aggregated, true);
  const expanded = aggregateProjectedEdges(projectGraph(snapshot, ['A', 'B']), changes);
  assert.equal(expanded.length, 2);
  assert.deepEqual(expanded.map((edge) => edge.id), ['first', 'second']);
});
