import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupFingerprint, buildInputFingerprint, type FingerprintParts } from '../src/core/layout/input-fingerprint.ts';
import { DEFAULT_SLOT_RULES } from '../src/core/layout/node-port-allocator.ts';

const base = (): FingerprintParts => ({
  algorithm: { name: 'orthogonal-v3', version: 3 },
  policy: { direction: 'auto' },
  topology: [{ id: 'e1', source: 'a', target: 'b', direction: 'directed', relation: 'call' }],
  geometry: [{ id: 'a', parentId: null, type: 'card', x: 0, y: 0, w: 100, h: 60, visible: true, expanded: false }],
  portRules: DEFAULT_SLOT_RULES,
  labels: [{ edgeId: 'e1', text: '调用', width: 44, height: 24 }],
  protected: { locked: [], pinned: [], frozen: [], barriers: [] },
});

test('the same inputs produce the same fingerprint regardless of object key order', () => {
  const parts = base();
  assert.equal(buildInputFingerprint(parts), buildInputFingerprint({ ...parts, policy: { priority: undefined, direction: 'auto' } }));
});

test('policy, geometry, labels and guarded paths are inputs', () => {
  const reference = buildInputFingerprint(base());
  assert.notEqual(buildInputFingerprint({ ...base(), policy: { direction: 'top-down' } }), reference);
  assert.notEqual(buildInputFingerprint({ ...base(), geometry: [{ ...base().geometry[0]!, x: 1 }] }), reference);
  assert.notEqual(buildInputFingerprint({ ...base(), labels: [{ edgeId: 'e1', text: '调用关系', width: 60, height: 24 }] }), reference);
  const locked = base();
  locked.protected.locked = [{ edgeId: 'e1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], handles: ['right:source:0', 'left:target:0'] }];
  assert.notEqual(buildInputFingerprint(locked), reference);
});

test('automatic solutions are not part of the input fingerprint', () => {
  const parts = base();
  const withSolution = { ...parts, solution: { mode: 'trunk', slots: ['bottom:source:0'], points: [{ x: 0, y: 0 }] } } as FingerprintParts;
  assert.equal(buildInputFingerprint(withSolution), buildInputFingerprint(parts));
});

test('group fingerprints include cross-group port and label dependencies', () => {
  const parts = base();
  const group = { id: 'g:a', ownerNodeId: 'a', edges: ['e1'] };
  const token = { nodeId: 'b', slotAllocation: 'bottom:target:0', labelOccupancy: 'e1', protectedSignature: 'none' };
  const reference = buildGroupFingerprint({ base: parts, group, neighbors: [token] });
  assert.notEqual(buildGroupFingerprint({ base: parts, group, neighbors: [{ ...token, slotAllocation: 'bottom:target:1' }] }), reference);
  assert.notEqual(buildGroupFingerprint({ base: parts, group, neighbors: [{ ...token, labelOccupancy: 'e2' }] }), reference);
});
