import test from 'node:test';
import assert from 'node:assert/strict';
import { measureRoutes, scoreRoutes, type QualityRoute } from '../src/react/model/route-quality.ts';

const route = (edgeId: string, points: { x: number; y: number }[]): QualityRoute => ({ edgeId, points });

test('a single crossing is chosen over a large detour', () => {
  const crossing = [route('a', [{ x: 0, y: 100 }, { x: 300, y: 100 }]), route('b', [{ x: 150, y: 0 }, { x: 150, y: 200 }])];
  const detour = [route('a', [{ x: 0, y: 100 }, { x: 300, y: 100 }]), route('b', [{ x: 150, y: 0 }, { x: 150, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 220 }, { x: 150, y: 220 }, { x: 150, y: 200 }])];
  assert.ok(scoreRoutes(crossing, { hiddenPenalty: 0 }).score < scoreRoutes(detour, { hiddenPenalty: 0 }).score);
});

test('a mild two-bend detour still loses to one crossing', () => {
  const crossing = [route('a', [{ x: 0, y: 100 }, { x: 300, y: 100 }]), route('b', [{ x: 150, y: 0 }, { x: 150, y: 200 }])];
  const mild = [route('a', [{ x: 0, y: 100 }, { x: 300, y: 100 }]), route('b', [{ x: 150, y: 0 }, { x: 150, y: 80 }, { x: 170, y: 80 }, { x: 170, y: 200 }])];
  assert.ok(scoreRoutes(crossing, { hiddenPenalty: 0 }).score < scoreRoutes(mild, { hiddenPenalty: 0 }).score);
});

test('an equally long non-crossing arrangement wins', () => {
  const crossing = [route('a', [{ x: 0, y: 100 }, { x: 300, y: 100 }]), route('b', [{ x: 150, y: 0 }, { x: 150, y: 200 }])];
  const separated = [route('a', [{ x: 0, y: 100 }, { x: 300, y: 100 }]), route('b', [{ x: 0, y: 150 }, { x: 200, y: 150 }])];
  assert.ok(scoreRoutes(separated, { hiddenPenalty: 0 }).score < scoreRoutes(crossing, { hiddenPenalty: 0 }).score);
});

test('crossing and detour matrix prefers a short detour and rejects long ones', () => {
  const other = route('other', [{ x: 150, y: 95 }, { x: 150, y: 105 }]);
  const crossing = [other, route('candidate', [{ x: 0, y: 100 }, { x: 300, y: 100 }])];
  const detour = (delta: number) => {
    const above = delta / 2;
    return [other, route('candidate', [{ x: 0, y: 100 }, { x: 0, y: 100 - above }, { x: 300, y: 100 - above }, { x: 300, y: 100 }])];
  };
  const matrix = [10, 30, 100].map((delta) => ({
    delta,
    crossingScore: scoreRoutes(crossing, { hiddenPenalty: 0 }).score,
    detourScore: scoreRoutes(detour(delta), { hiddenPenalty: 0 }).score,
  }));
  console.log(JSON.stringify({ crossingMatrix: matrix }));
  assert.ok(matrix[0]!.detourScore < matrix[0]!.crossingScore, '10px detour avoids the crossing');
  assert.ok(matrix[1]!.crossingScore < matrix[1]!.detourScore, '30px detour is too expensive');
  assert.ok(matrix[2]!.crossingScore < matrix[2]!.detourScore, '100px detour is too expensive');
});

test('trunk overlap is split into intentional and unintended parts', () => {
  const trunk = { from: { x: 0, y: 0 }, to: { x: 0, y: 40 } };
  const metrics = measureRoutes([
    { edgeId: 'a', points: [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 0, y: 140 }], trunkId: 't', trunkSegment: trunk },
    { edgeId: 'b', points: [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 0, y: 240 }], trunkId: 't', trunkSegment: trunk },
  ]);
  assert.equal(metrics.intentionalTrunkLength, 40);
  assert.equal(metrics.unintendedOverlap, 100);
});

test('channel stability sorts target ports by world projection, not local fraction', () => {
  const slot = (nodeId: string, fraction: number, index: number) => ({ nodeId, side: 'bottom' as const, role: 'source' as const, index, physicalId: `bottom:${index}`, handleId: `bottom:source:${index}`, fraction, capacity: 1 });
  const target = (nodeId: string, index: number) => ({ nodeId, side: 'top' as const, role: 'target' as const, index, physicalId: `top:${index}`, handleId: `top:target:${index}`, fraction: 0.5, capacity: 1 });
  const metrics = measureRoutes([
    { edgeId: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], sourceSlot: slot('hub', 0.2, 0), targetSlot: target('right', 0) },
    { edgeId: 'b', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], sourceSlot: slot('hub', 0.8, 1), targetSlot: target('left', 1) },
  ]);
  assert.equal(metrics.channelStability, 1);
});

test('bends count direction changes rather than redundant points', () => {
  assert.equal(measureRoutes([{ edgeId: 'straight', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }] }]).bends, 0);
  assert.equal(measureRoutes([{ edgeId: 'elbow', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }]).bends, 1);
});

test('labels are only penalised when they are required', () => {
  assert.equal(measureRoutes([{ edgeId: 'none', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], labelRequired: false }]).labelHidden, 0);
  assert.equal(measureRoutes([{ edgeId: 'required', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], labelRequired: true }]).labelHidden, 1);
});

test('label ownership penalises labels far from their own route', () => {
  const near = measureRoutes([{ edgeId: 'a', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], label: { x: 100, y: 0, width: 40, height: 20 } }]);
  const far = measureRoutes([{ edgeId: 'a', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], label: { x: 100, y: 80, width: 40, height: 20 } }]);
  assert.equal(near.labelOwnerMisses, 0);
  assert.equal(far.labelOwnerMisses, 1);
});

test('port and channel metrics use global node-scoped identities', () => {
  const metrics = measureRoutes([
    { edgeId: 'a', points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], sourceSlot: { nodeId: 'A', side: 'bottom', role: 'source', index: 0, physicalId: 'bottom:0', handleId: 'bottom:source:0', fraction: 0.2, capacity: 1 }, targetSlot: { nodeId: 'B', side: 'top', role: 'target', index: 0, physicalId: 'top:0', handleId: 'top:target:0', fraction: 0.2, capacity: 1 } },
    { edgeId: 'b', points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], sourceSlot: { nodeId: 'A', side: 'bottom', role: 'source', index: 0, physicalId: 'bottom:0', handleId: 'bottom:source:0', fraction: 0.2, capacity: 1 }, targetSlot: { nodeId: 'B', side: 'top', role: 'target', index: 1, physicalId: 'top:1', handleId: 'top:target:1', fraction: 0.8, capacity: 1 } },
  ]);
  assert.equal(metrics.portCrowding, 1);
  assert.equal(metrics.channelStability, 0);
});
