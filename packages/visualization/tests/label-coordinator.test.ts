import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateLabels, type CoordinatedLabelRoute } from '../src/react/model/label-coordinator.ts';
import { measureRoutes, type QualityRoute } from '../src/react/model/route-quality.ts';
import type { LabelCandidate } from '../src/react/model/label-candidates.ts';

const candidate = (x: number, y: number, width = 60, height = 24, score = 0): LabelCandidate => ({
  state: 'normal', anchor: { x, y }, rect: { x: x - width / 2, y: y - height / 2, w: width, h: height },
  segmentIndex: 1, segmentKind: 'branch', distanceToTarget: 0, score,
});

const quality = (routes: readonly CoordinatedLabelRoute[], labels: Map<string, LabelCandidate | undefined>): QualityRoute[] => routes.map((route) => {
  const label = labels.get(route.edgeId);
  return {
    edgeId: route.edgeId, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
    label: label ? { x: label.anchor.x, y: label.anchor.y, width: label.rect.w, height: label.rect.h } : { x: 100, y: 0, width: 0, height: 0 },
    labelRequired: route.required,
    ...(label ? {} : { labelState: 'space-exhausted' as const }),
  };
});

test('global label coordination reselects conflicting labels and leaves zero rendered overlap', () => {
  const routes: CoordinatedLabelRoute[] = [
    { edgeId: 'a', required: true, candidates: [candidate(100, 0), candidate(100, 60)] },
    { edgeId: 'b', required: true, candidates: [candidate(100, 0), candidate(100, 120)] },
    { edgeId: 'c', required: true, candidates: [candidate(100, 0), candidate(100, 180)] },
  ];
  const labels = coordinateLabels(routes);
  assert.equal(measureRoutes(quality(routes, labels)).labelOverlaps, 0);
  assert.equal([...labels.values()].filter(Boolean).length, 3);
});

test('a globally exhausted label becomes hidden rather than overlapping', () => {
  const routes: CoordinatedLabelRoute[] = [
    { edgeId: 'a', required: true, candidates: [candidate(100, 0)] },
    { edgeId: 'b', required: true, candidates: [candidate(100, 0)] },
  ];
  const labels = coordinateLabels(routes);
  assert.equal([...labels.values()].filter(Boolean).length, 1);
  assert.equal([...labels.values()].filter((label) => !label).length, 1);
  const metrics = measureRoutes(quality(routes, labels));
  assert.equal(metrics.labelOverlaps, 0);
  assert.equal(metrics.labelHidden, 1);
});

test('fixed labels are hard occupancy for the global pass', () => {
  const labels = coordinateLabels([
    { edgeId: 'a', required: true, candidates: [candidate(100, 0), candidate(100, 60)] },
  ], [{ x: 60, y: -20, w: 80, h: 40 }]);
  assert.deepEqual(labels.get('a')?.anchor, { x: 100, y: 60 });
});
