import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageSnapshot } from '../../../../core/schema/types.ts';
import { createHierarchyNodes } from '../hierarchy.ts';

test('initial coordinates support arbitrary IDs and roots with ordered parent-local defaults', () => {
  const stage: StageSnapshot = {
    id: 'architecture-one', label: 'First', title: 'Structure', track: 'main', order: 0,
    graph: {
      rootId: 'architecture',
      nodes: [
        { id: 'inner-second', parentId: 'runtime', kind: 'component', label: 'Second', order: 2, ports: [] },
        { id: 'storage', parentId: 'architecture', kind: 'store', label: 'Storage', order: 2, ports: [] },
        { id: 'inner-first', parentId: 'runtime', kind: 'component', label: 'First', order: 1, ports: [] },
        { id: 'runtime', parentId: 'architecture', kind: 'group', label: 'Runtime', order: 1, ports: [] },
        { id: 'architecture', parentId: null, kind: 'root', label: 'Architecture', order: 0, ports: [] },
      ], edges: [],
    },
  };
  const nodes = createHierarchyNodes(stage);
  assert.deepEqual(nodes.map((node) => node.id), ['runtime', 'inner-first', 'inner-second', 'storage']);
  assert.deepEqual(nodes[0]!.position, { x: 0, y: 0 });
  assert.deepEqual(nodes[1]!.position, { x: 24, y: 72 });
  assert.deepEqual(nodes[2]!.position, { x: 336, y: 72 });
  assert.deepEqual(nodes[3]!.position, { x: 312, y: 0 });
  assert.equal(nodes[0]!.parentId, undefined);
  assert.equal(nodes[1]!.parentId, 'runtime');
  const positioned = createHierarchyNodes(stage, { 'inner-first': { x: 88, y: 99 } });
  assert.deepEqual(positioned[1]!.position, { x: 88, y: 99 });
});
