import test from 'node:test';
import assert from 'node:assert/strict';
import { buildP4Content } from './fixtures/p4-content.ts';
import { createDiagramGeometry } from '../src/react/model/routing/routing.ts';

test('visible route snapshots share the node geometry version they were captured from', () => {
  const fixture = buildP4Content();
  const geometry = createDiagramGeometry(fixture.nodes, fixture.projection);
  const snapshots = fixture.content.displayRoutes ?? [];
  assert.ok(snapshots.length > 0);
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot.sourceBounds, geometry.bounds.get(snapshot.source), `${snapshot.id} source bounds`);
    assert.deepEqual(snapshot.targetBounds, geometry.bounds.get(snapshot.target), `${snapshot.id} target bounds`);
    const visible = fixture.routes.get(snapshot.id)!;
    assert.deepEqual(snapshot.points, visible.points, `${snapshot.id} points`);
  }
});
