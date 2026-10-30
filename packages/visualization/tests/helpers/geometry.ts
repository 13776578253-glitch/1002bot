import type { Point, Obstacle } from '../../src/core/layout/geometry.ts';

export function validateOrthogonalPath(points: readonly Point[], obstacles: readonly Obstacle[]): boolean {
  if (points.length < 2) return false;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (from.x !== to.x && from.y !== to.y) return false;
    for (const obstacle of obstacles) {
      if (from.y === to.y) {
        const minX = Math.min(from.x, to.x);
        const maxX = Math.max(from.x, to.x);
        if (from.y > obstacle.top && from.y < obstacle.bottom && maxX > obstacle.left && minX < obstacle.right) return false;
      } else {
        const minY = Math.min(from.y, to.y);
        const maxY = Math.max(from.y, to.y);
        if (from.x > obstacle.left && from.x < obstacle.right && maxY > obstacle.top && minY < obstacle.bottom) return false;
      }
    }
  }
  return true;
}
