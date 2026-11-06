import test from 'node:test';
import assert from 'node:assert/strict';
import { crossGroupCrossingHotspots } from '../src/react/model/routing/cross-group-quality.ts';
import type { QualityRoute } from '../src/react/model/routing/route-quality.ts';

test('crossing hotspots rank edges and groups by actual crossings', () => {
  const routes: QualityRoute[] = [
    { edgeId: 'h', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
    { edgeId: 'v', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
    { edgeId: 'v2', points: [{ x: 20, y: 0 }, { x: 20, y: 100 }] },
    { edgeId: 'away', points: [{ x: 200, y: 200 }, { x: 300, y: 200 }] },
  ];
  const hotspots = crossGroupCrossingHotspots(routes, new Map([['h', 'g1'], ['v', 'g2'], ['v2', 'g2'], ['away', 'g3']]));
  assert.equal(hotspots.total, 2);
  assert.equal(hotspots.pairs[0]?.a, 'h');
  assert.equal(hotspots.pairs[0]?.b, 'v');
  assert.equal(hotspots.byEdge[0]?.count, 2);
  assert.equal(hotspots.byGroup.find((group) => group.groupId === 'g2')?.count, 2);
});
