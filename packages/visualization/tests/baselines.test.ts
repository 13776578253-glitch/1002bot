import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleBaselines as baselineOptions } from '../examples/baselines.ts';
import { hasChangeAnnotation, relationLabel } from '../src/react/model/change.ts';
const getBaseline = (id: string) => baselineOptions.find((baseline) => baseline.id === id)!;
import { assertValidSnapshot } from '../src/core/schema/validate.ts';
import { projectGraph } from '../src/core/projection/index.ts';

test('both baselines are valid complete snapshots with explicit marks for every visible entity', () => {
  for (const option of baselineOptions) {
    assert.doesNotThrow(() => assertValidSnapshot(option.stage));
    assert.deepEqual(Object.keys(option.nodeChanges).sort(), option.stage.graph.nodes.filter((node) => node.id !== option.stage.graph.rootId).map((node) => node.id).sort());
    assert.deepEqual(Object.keys(option.edgeChanges).sort(), option.stage.graph.edges.map((edge) => edge.id).sort());
  }
  const first = getBaseline('M1');
  assert.ok(Object.values(first.nodeChanges).every((change) => change.kind === 'baseline' && change.label === '基线'));
  assert.ok(Object.values(first.edgeChanges).every((change) => change.kind === 'baseline' && change.label === '基线'));
});

test('M2 explicitly distinguishes additions, inheritance and replacement for nodes and links', () => {
  const second = getBaseline('M2');
  assert.deepEqual(new Set(Object.values(second.nodeChanges).map((change) => change.kind)), new Set(['inherited', 'added', 'replaced']));
  assert.deepEqual(new Set(Object.values(second.edgeChanges).map((change) => change.kind)), new Set(['inherited', 'added', 'replaced']));
  assert.equal(second.nodeChanges.audit?.label, '新增');
  assert.equal(second.edgeChanges['e-tools-audit']?.label, '新增');
  assert.equal(second.nodeChanges['memory-durable']?.label, '替换');
  assert.match(second.nodeChanges['memory-durable']!.note!, /会话记忆/);
  assert.equal(second.edgeChanges['e-tools-durable']?.label, '替换');
  assert.equal(second.nodeChanges.session?.label, '沿用');
});

test('only additions and replacements expose change annotations while ordinary relations keep their labels', () => {
  const first = getBaseline('M1'), second = getBaseline('M2');
  assert.equal(hasChangeAnnotation(undefined), false);
  for (const change of [...Object.values(first.nodeChanges), ...Object.values(first.edgeChanges)]) assert.equal(hasChangeAnnotation(change), false);
  assert.equal(hasChangeAnnotation(second.nodeChanges.session), false);
  assert.equal(hasChangeAnnotation(second.nodeChanges.audit), true);
  assert.equal(hasChangeAnnotation(second.nodeChanges['memory-durable']), true);
  assert.equal(relationLabel('接入', first.edgeChanges['e-entry-session']!), '接入');
  assert.equal(relationLabel('接入', second.edgeChanges['e-entry-session']!), '接入');
  assert.equal(relationLabel('留痕', second.edgeChanges['e-tools-audit']!), '留痕 · 新增');
  assert.equal(relationLabel('写入', second.edgeChanges['e-tools-durable']!), '写入 · 替换');
});

test('replacement removes the old memory and write link and binds the new write to durable memory', () => {
  const first = getBaseline('M1').stage, second = getBaseline('M2').stage;
  assert.equal(first.graph.nodes.find((node) => node.id === 'memory')?.label, '会话记忆');
  assert.equal(first.graph.edges.find((edge) => edge.id === 'e-tools-memory')?.target.nodeId, 'memory');
  assert.ok(!second.graph.nodes.some((node) => node.id === 'memory'));
  assert.ok(!second.graph.edges.some((edge) => edge.id === 'e-tools-memory'));
  assert.equal(second.graph.nodes.find((node) => node.id === 'memory-durable')?.summary, '跨会话保存记忆与事件');
  assert.deepEqual(second.graph.edges.find((edge) => edge.id === 'e-tools-durable')?.target, { nodeId: 'memory-durable' });
  assert.deepEqual(second.graph.edges.find((edge) => edge.id === 'e-tools-audit')?.target, { nodeId: 'audit' });
});

test('every inherited node and link has identical canonical content in M1 and M2', () => {
  const first = getBaseline('M1'), second = getBaseline('M2');
  for (const [id, change] of Object.entries(second.nodeChanges)) {
    if (change.kind === 'inherited') assert.deepEqual(second.stage.graph.nodes.find((node) => node.id === id), first.stage.graph.nodes.find((node) => node.id === id), id);
  }
  for (const [id, change] of Object.entries(second.edgeChanges)) {
    if (change.kind === 'inherited') assert.deepEqual(second.stage.graph.edges.find((edge) => edge.id === id), first.stage.graph.edges.find((edge) => edge.id === id), id);
  }
});

test('baseline data projects external flow through each expanded session layer', () => {
  for (const { stage } of baselineOptions) {
    const expanded = new Set<string>();
    const returnTarget = () => projectGraph(stage, expanded).edges.find((edge) => edge.canonicalEdgeId === 'e-bus-session')!.target.nodeId;
    assert.equal(returnTarget(), 'session');
    for (const [id, target] of [['session', 'session-context'], ['session-context', 'context-compose'], ['context-compose', 'compose-summary']] as const) {
      expanded.add(id);
      assert.equal(returnTarget(), target);
    }
    const projection = projectGraph(stage, expanded);
    assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-entry-session')?.target.nodeId, 'session-receive');
    assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'e-session-scheduler')?.source.nodeId, 'session-dispatch');
    assert.equal(projection.edges.find((edge) => edge.canonicalEdgeId === 'context-summary')?.target.nodeId, 'compose-summary');
    assert.equal(projection.edges.length, stage.graph.edges.length);
    assert.ok(projection.edges.every((edge) => projection.nodeById.has(edge.source.nodeId) && projection.nodeById.has(edge.target.nodeId)));
  }
});
