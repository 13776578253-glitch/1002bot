import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidBaselines, type VisualizationBaseline } from '../src/core/schema/baseline.ts';
import { createHierarchyNodes, toggleHierarchy } from '../src/react/model/layout/hierarchy.ts';
import { hierarchyProjection } from '../src/react/model/layout/visibility.ts';
import { worldPosition } from '../src/react/model/layout/node.ts';

const external: VisualizationBaseline = {
  id: 'release-a',
  stage: {
    id: 'release-a', label: 'A', title: 'External architecture', track: 'main', order: 0,
    graph: {
      rootId: 'external/root', revision: 'a1',
      nodes: [
        { id: 'external/leaf', parentId: 'external/group', kind: 'component', label: 'Worker', ports: [], order: 0 },
        { id: 'external/root', parentId: null, kind: 'root', label: 'Root', ports: [], order: 0 },
        { id: 'external/group', parentId: 'external/root', kind: 'group', label: 'Runtime', ports: [], order: 0 },
        { id: 'external/store', parentId: 'external/root', kind: 'store', label: 'Storage', ports: [], order: 1 },
      ],
      edges: [{ id: 'persist', source: { nodeId: 'external/leaf' }, target: { nodeId: 'external/store' }, relation: 'storage', direction: 'directed', order: 0 }],
    },
  },
  nodeChanges: Object.fromEntries(['external/leaf', 'external/group', 'external/store'].map((id) => [id, { kind: 'inherited' as const, label: '沿用' }])),
  edgeChanges: { persist: { kind: 'added', label: '新增' } },
};

test('arbitrary source IDs and unordered nodes render without example-specific positions', () => {
  assert.doesNotThrow(() => assertValidBaselines([external]));
  let nodes = createHierarchyNodes(external.stage);
  assert.equal(nodes[0]!.id, 'external/group');
  assert.equal(hierarchyProjection(nodes, external.stage).edges[0]!.source.nodeId, 'external/group');
  nodes = toggleHierarchy(nodes, 'external/group', external.stage);
  assert.equal(hierarchyProjection(nodes, external.stage).edges[0]!.source.nodeId, 'external/leaf');
  for (const node of nodes) assert.ok(Object.values(worldPosition(node, nodes)).every(Number.isFinite));
});

test('baseline boundary rejects missing data, repeated identities, missing marks and invalid coordinates', () => {
  assert.throws(() => assertValidBaselines([]), /At least one/);
  assert.throws(() => assertValidBaselines([external, external]), /Duplicate/);
  assert.throws(() => assertValidBaselines([{ ...external, nodeChanges: {} }]), /change mark/);
  assert.throws(() => assertValidBaselines([{ ...external, positions: { 'external/store': { x: NaN, y: 0 } } }]), /position/);
  assert.throws(() => assertValidBaselines([{ ...external, positions: { unknown: { x: 0, y: 0 } } }]), /position/);
});
