import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChangeMark } from '../src/core/schema/baseline.ts';
import type { CanonicalEdge, CanonicalNode, StageSnapshot } from '../src/core/schema/types.ts';
import { diffStages } from '../src/core/graph/diff.ts';

function node(id: string, parentId: string | null, order: number, extra: Partial<CanonicalNode> = {}): CanonicalNode {
  return { id, parentId, kind: parentId === null ? 'root' : 'component', label: id, order, ports: [], ...extra };
}

function edge(id: string, source: string, target: string, order: number, extra: Partial<CanonicalEdge> = {}): CanonicalEdge {
  return { id, source: { nodeId: source }, target: { nodeId: target }, relation: 'data', direction: 'directed', order, ...extra };
}

function stage(id: string, nodes: readonly CanonicalNode[], edges: readonly CanonicalEdge[], revision = 'r1'): StageSnapshot {
  return { id, label: id, title: id, track: 'main', order: 0, graph: { rootId: 'root', revision, nodes, edges } };
}

test('the first stage reports every entity as added in stable order', () => {
  const next = stage('one', [
    node('root', null, 0),
    node('module', 'root', 2),
    node('leaf', 'module', 1),
  ], [edge('call', 'leaf', 'module', 1), edge('dep', 'module', 'leaf', 0)]);
  const diff = diffStages(undefined, next);
  assert.equal(diff.fromStageId, undefined);
  assert.deepEqual(diff.nodes.added, ['leaf', 'module']);
  assert.deepEqual(diff.edges.added, ['dep', 'call']);
  assert.deepEqual(diff.nodes.removed, []);
  assert.deepEqual(diff.nodes.updated, []);
});

test('consecutive stages classify additions, removals, reparenting, updates and edge changes', () => {
  const previous = stage('one', [
    node('root', null, 0),
    node('keep', 'root', 1, { label: 'Keep' }),
    node('moved', 'root', 2),
    node('removed', 'root', 3),
    node('parent-a', 'root', 4),
    node('parent-b', 'root', 5),
  ], [
    edge('same', 'keep', 'moved', 0),
    edge('updated', 'keep', 'moved', 1, { label: 'old' }),
    edge('gone', 'keep', 'removed', 2),
  ]);
  const next = stage('two', [
    node('root', null, 0),
    node('keep', 'root', 1, { label: 'Keep renamed', summary: 'new summary' }),
    node('moved', 'parent-b', 2),
    node('parent-a', 'root', 4),
    node('parent-b', 'root', 5),
    node('added', 'parent-a', 6),
  ], [
    edge('same', 'keep', 'moved', 0),
    edge('updated', 'keep', 'moved', 1, { label: 'new' }),
    edge('new', 'parent-a', 'parent-b', 3),
  ]);
  const diff = diffStages(previous, next);
  assert.equal(diff.fromStageId, 'one');
  assert.deepEqual(diff.nodes.added, ['added']);
  assert.deepEqual(diff.nodes.removed, ['removed']);
  assert.deepEqual(diff.nodes.reparented, [{ id: 'moved', from: 'root', to: 'parent-b' }]);
  assert.deepEqual(diff.nodes.updated, ['keep']);
  assert.deepEqual(diff.edges.added, ['new']);
  assert.deepEqual(diff.edges.removed, ['gone']);
  assert.deepEqual(diff.edges.updated, ['updated']);
});

test('replacement marks move the old and new identity into the replaced bucket', () => {
  const previous = stage('one', [
    node('root', null, 0),
    node('old', 'root', 1),
  ], [edge('old-edge', 'old', 'old', 0)]);
  const next = stage('two', [
    node('root', null, 0),
    node('new', 'root', 1),
  ], [edge('new-edge', 'new', 'new', 0)]);
  const nodeChanges: Record<string, ChangeMark> = {
    new: { kind: 'replaced', label: '替换', note: 'new replaces old', previousId: 'old' },
  };
  const edgeChanges: Record<string, ChangeMark> = {
    'new-edge': { kind: 'replaced', label: '替换', note: 'new edge', previousId: 'old-edge' },
  };
  const diff = diffStages(previous, next, { nodeChanges, edgeChanges });
  assert.deepEqual(diff.nodes.added, []);
  assert.deepEqual(diff.nodes.removed, []);
  assert.deepEqual(diff.nodes.replaced, [{ from: 'old', to: 'new', note: 'new replaces old' }]);
  assert.deepEqual(diff.edges.added, []);
  assert.deepEqual(diff.edges.removed, []);
  assert.deepEqual(diff.edges.replaced, [{ from: 'old-edge', to: 'new-edge', note: 'new edge' }]);
});

test('an invalid replacement provenance falls back to an independent addition and removal', () => {
  const previous = stage('one', [node('root', null, 0), node('old', 'root', 1)], []);
  const next = stage('two', [node('root', null, 0), node('new', 'root', 1)], []);
  const diff = diffStages(previous, next, {
    nodeChanges: { new: { kind: 'replaced', label: '替换', previousId: 'missing' } },
  });
  assert.deepEqual(diff.nodes.added, ['new']);
  assert.deepEqual(diff.nodes.removed, ['old']);
  assert.deepEqual(diff.nodes.replaced, []);
});
