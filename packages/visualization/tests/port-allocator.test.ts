import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodePortAllocator, DEFAULT_SLOT_RULES, slotAnchor, slotFractions, type NodePortGeometry } from '../src/core/layout/node-port-allocator.ts';
import { portAnchor } from '../src/core/layout/geometry.ts';

const geometry = (id = 'n', width = 200, height = 100): NodePortGeometry => ({ id, x: 10, y: 20, width, height });

test('slot fractions are symmetric and respect margins and minimum pitch', () => {
  const rules = { ...DEFAULT_SLOT_RULES, margin: 10, minStep: 20, maxPerSide: 6 };
  const fractions = slotFractions(100, rules);
  assert.equal(fractions.length, 5);
  assert.deepEqual(fractions, [...fractions].reverse().map((fraction) => Number((1 - fraction).toFixed(6))));
  assert.deepEqual(slotFractions(20, rules), [0.5]);
});

test('slot anchors and handles share one physical fraction', () => {
  const node = geometry();
  const slots = createNodePortAllocator({ nodes: [node] }).slots('n');
  assert.ok(slots.length > 0);
  for (const slot of slots) {
    assert.deepEqual(slotAnchor(node, slot), portAnchor({ x: node.x, y: node.y, w: node.width, h: node.height }, slot.side, slot.fraction));
    assert.equal(slot.handleId, `${slot.side}:${slot.role}:${slot.index}`);
  }
});

test('independent slots are preferred and exhaustion is reported', () => {
  const allocator = createNodePortAllocator({ nodes: [geometry()], rules: { maxPerSide: 2, minStep: 100, slotCapacity: 1 } });
  allocator.begin();
  assert.ok(allocator.request({ edgeId: 'a', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom' }));
  assert.ok(allocator.request({ edgeId: 'b', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom' }));
  assert.equal(allocator.request({ edgeId: 'c', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom' }), undefined);
  assert.equal(allocator.failure('c')?.reason, 'capacity-exhausted');
  allocator.commit();
});

test('source and target roles share one physical capacity', () => {
  const tight = createNodePortAllocator({ nodes: [geometry()], rules: { maxPerSide: 1, minStep: 200, slotCapacity: 1 } });
  tight.begin();
  assert.ok(tight.request({ edgeId: 'out', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom' }));
  assert.equal(tight.request({ edgeId: 'in', nodeId: 'n', role: 'target', priority: 'auto', requiredSide: 'bottom' }), undefined);
  tight.commit();

  const shared = createNodePortAllocator({ nodes: [geometry()], rules: { maxPerSide: 1, minStep: 200, slotCapacity: 2 } });
  shared.begin();
  const a = shared.request({ edgeId: 'out', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom' })!;
  const b = shared.request({ edgeId: 'in', nodeId: 'n', role: 'target', priority: 'auto', requiredSide: 'bottom' })!;
  assert.equal(a.slot.fraction, b.slot.fraction);
  assert.equal(a.slot.physicalId, b.slot.physicalId);
  assert.notEqual(a.slot.handleId, b.slot.handleId);
  shared.commit();
});

test('trunk requests share a slot up to the trunk capacity', () => {
  const allocator = createNodePortAllocator({ nodes: [geometry()], rules: { maxPerSide: 1, minStep: 200, slotCapacity: 2, trunkCapacity: 2 } });
  allocator.begin();
  const first = allocator.request({ edgeId: 'a', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom', trunk: { id: 't' } })!;
  const second = allocator.request({ edgeId: 'b', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom', trunk: { id: 't' } })!;
  assert.equal(first.mode, 'trunk');
  assert.equal(second.mode, 'trunk');
  assert.equal(first.slot.fraction, second.slot.fraction);
  assert.equal(allocator.request({ edgeId: 'c', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom', trunk: { id: 't' } }), undefined);
  allocator.commit();
});

test('packed overflow is explicit and bounded', () => {
  const allocator = createNodePortAllocator({ nodes: [geometry()], rules: { maxPerSide: 1, minStep: 200, slotCapacity: 2 } });
  allocator.begin();
  assert.ok(allocator.request({ edgeId: 'a', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom' }));
  const packed = allocator.request({ edgeId: 'b', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom', allowPacked: true })!;
  assert.equal(packed.mode, 'packed');
  assert.equal(allocator.request({ edgeId: 'c', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom', allowPacked: true }), undefined);
  allocator.commit();
});

test('reserveExisting keeps already allocated fixed slots while new requests respect capacity', () => {
  const allocator = createNodePortAllocator({ nodes: [geometry()], rules: { maxPerSide: 1, minStep: 200, slotCapacity: 1 } });
  allocator.begin();
  const handle = allocator.slots('n').find((slot) => slot.side === 'bottom' && slot.role === 'source')!.handleId;
  assert.ok(allocator.request({ edgeId: 'first', nodeId: 'n', role: 'source', priority: 'pinned', storedHandle: handle, reserveExisting: true }));
  assert.ok(allocator.request({ edgeId: 'second', nodeId: 'n', role: 'source', priority: 'pinned', storedHandle: handle, reserveExisting: true }));
  assert.equal(allocator.request({ edgeId: 'new', nodeId: 'n', role: 'source', priority: 'auto', requiredSide: 'bottom' }), undefined);
  allocator.commit();
});

test('reconcile keeps pinned slots and rejects a lost locked slot', () => {
  const wide = createNodePortAllocator({ nodes: [geometry('n', 400, 100)], rules: { maxPerSide: 4, minStep: 80, slotCapacity: 1 } });
  wide.begin();
  const handle = wide.slots('n').find((slot) => slot.side === 'bottom' && slot.role === 'source' && slot.index === 3)!.handleId;
  assert.ok(wide.request({ edgeId: 'locked', nodeId: 'n', role: 'source', priority: 'locked', storedHandle: handle }));
  assert.ok(wide.request({ edgeId: 'pinned', nodeId: 'n', role: 'source', priority: 'pinned', storedHandle: handle }));
  const snapshot = wide.commit();
  // The pinned request landed on a second free slot; shrink the node so index 3 is gone.
  const next = wide.reconcile(snapshot, [geometry('n', 100, 100)]);
  assert.equal(next.failures.some((failure) => failure.edgeId === 'locked' && failure.reason === 'handle-missing'), true);
  assert.ok(next.grants.get('pinned')?.length, 'pinned falls back to a remaining side slot');
});
