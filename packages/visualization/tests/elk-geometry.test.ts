import assert from 'node:assert/strict';
import test from 'node:test';
import {
  routeOrthogonal,
  svgPathFromPoints,
  midpointOfPoints,
  simplifyPoints,
  type Obstacle,
  type Rect,
} from '../src/core/layout/geometry.ts';
import { createElkLayout } from '../src/core/layout/elk.ts';

test('geometry simplifyPoints collapses collinear points', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 100, y: 100 },
  ];
  const simplified = simplifyPoints(points);
  assert.deepEqual(simplified, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);
});

test('geometry svgPathFromPoints renders smooth rounded orthogonal curves', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
  ];
  const path = svgPathFromPoints(points, 8);
  assert.ok(path.startsWith('M 0 0'));
  assert.ok(path.includes('Q 50 0'));
  assert.ok(path.endsWith('50 50'));
});

test('geometry midpointOfPoints finds the center along the polyline', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const mid = midpointOfPoints(points);
  assert.equal(mid.x, 100);
  assert.equal(mid.y, 0);
});

test('geometry routeOrthogonal finds collision-free path around an obstacle', () => {
  const fromRect: Rect = { x: 0, y: 100, w: 100, h: 50 };
  const toRect: Rect = { x: 300, y: 100, w: 100, h: 50 };
  const obstacle: Obstacle = { left: 150, right: 250, top: 80, bottom: 170 };

  const points = routeOrthogonal(fromRect, toRect, [obstacle]);
  assert.ok(points.length >= 2);
  assert.equal(points[0]!.x, 100);
  assert.equal(points[0]!.y, 125);
  assert.equal(points[points.length - 1]!.x, 300);
  assert.equal(points[points.length - 1]!.y, 125);

  // Check that no segment cuts directly through the obstacle interior
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    if (p1.y === p2.y) {
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      if (p1.y > obstacle.top + 1 && p1.y < obstacle.bottom - 1) {
        assert.ok(
          maxX <= obstacle.left || minX >= obstacle.right,
          `Horizontal segment at y=${p1.y} cuts obstacle [${obstacle.left}, ${obstacle.right}]`,
        );
      }
    }
  }
});

test('createElkLayout computes nested bounds and routed edges', () => {
  const elk = createElkLayout();
  const result = elk.layout(
    [
      { path: 'system/a', expanded: true },
      { path: 'system/a/child1', expanded: false },
      { path: 'system/b', expanded: false },
    ],
    [{ from: 'system/a/child1', to: 'system/b', label: 'calls' }],
  );

  assert.equal(result.nodes.length, 3);
  assert.equal(result.edges.length, 1);
  assert.ok(result.edges[0]!.points.length >= 2);

  const parentA = result.nodes.find((n) => n.path === 'system/a');
  const child1 = result.nodes.find((n) => n.path === 'system/a/child1');
  assert.ok(parentA);
  assert.ok(child1);
  // Child must be within parent's bounding box
  assert.ok(child1.at.x >= parentA.at.x);
  assert.ok(child1.at.y >= parentA.at.y);
  assert.ok(child1.at.x + child1.size.w <= parentA.at.x + parentA.size.w);
  assert.ok(child1.at.y + child1.size.h <= parentA.at.y + parentA.size.h);
});
