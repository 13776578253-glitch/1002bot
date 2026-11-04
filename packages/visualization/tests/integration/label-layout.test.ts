import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { adaptProject, resolveSourceStages, type ArchitectureProject, type ProjectManifest, type ProjectSourceCatalog, type ProjectStageSelection, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { rectIntersects, segmentCrossesRect, type Point, type Rect } from '../../src/core/layout/geometry.ts';
import { aggregateProjectedEdges } from '../../src/react/model/display-edges.ts';
import { applyStoredRoutes, routeSnapshotForEdge } from '../../src/react/model/edge-routes.ts';
import { baselineNodes, hierarchyProjection } from '../../src/react/model/hierarchy.ts';
import { LabelLayoutCache } from '../../src/react/model/label-layout.ts';
import { DiagramRouteCache, type CachedRoute } from '../../src/react/model/route-cache.ts';
import { createDiagramGeometry } from '../../src/react/model/routing.ts';
import { expandBounds } from '../../src/react/model/spatial-index.ts';
import { baselineForView } from '../../src/react/model/view-projection.ts';
import type { CanvasViewMode } from '../../src/react/model/workspace.ts';

const directory = new URL('../../datasets/projects/runtime-evolution/', import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, directory), 'utf8')) as T;
const manifest = read<ProjectManifest>('project.json');
const project: ArchitectureProject = {
  version: 1, id: manifest.id, title: manifest.title, revision: manifest.revision,
  source: { stages: resolveSourceStages(manifest.source.map((path) => read<ProjectSourceCatalog>(path)), manifest.stages.map((path) => read<ProjectStageSelection>(path))) },
  views: manifest.views.map((path) => read<ProjectViewDefinition>(path)),
};
const baselines = adaptProject(project);
const modes: CanvasViewMode[] = ['overview', 'structure', 'full'];
const metrics: unknown[] = [];
const rectOf = (label: { x: number; y: number; width: number; height: number }): Rect => ({ x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height });
const inside = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x - 0.000001 && inner.y >= outer.y - 0.000001
  && inner.x + inner.w <= outer.x + outer.w + 0.000001 && inner.y + inner.h <= outer.y + outer.h + 0.000001;
const distance = (point: Point, points: readonly Point[]): number => {
  let best = Infinity;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!;
    const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length2));
    best = Math.min(best, Math.hypot(point.x - from.x - dx * t, point.y - from.y - dy * t));
  }
  return best;
};

interface Positioned { id: string; box: Rect; label: { x: number; y: number; width: number; height: number } }
function quality(items: readonly Positioned[], routes: ReadonlyMap<string, CachedRoute>, blockers: readonly Rect[], frames: readonly Rect[]) {
  let nodeOverlaps = 0, frameOverlaps = 0, labelOverlaps = 0, otherPathIntersections = 0, farFromPath = 0;
  for (const [index, item] of items.entries()) {
    if (blockers.some((blocker) => rectIntersects(item.box, blocker))) nodeOverlaps++;
    if (frames.some((frame) => !inside(frame, item.box) && rectIntersects(frame, item.box))) frameOverlaps++;
    for (const other of items.slice(index + 1)) if (rectIntersects(item.box, other.box)) labelOverlaps++;
    const own = routes.get(item.id)!;
    if (distance(item.label, own.points) > Math.max(item.label.width, item.label.height) / 2 + 24 + 0.0001) farFromPath++;
    for (const [id, route] of routes) if (id !== item.id && route.feasible !== false) {
      for (let point = 1; point < route.points.length; point++) if (segmentCrossesRect(route.points[point - 1]!, route.points[point]!, item.box)) otherPathIntersections++;
    }
  }
  return { visible: items.length, nodeOverlaps, frameOverlaps, labelOverlaps, otherPathIntersections, farFromPath };
}

for (const source of baselines) for (const mode of modes) {
  test(`${source.stage.label} ${mode}: final routes and node frames are unchanged by labels`, (t) => {
    const baseline = baselineForView(source, mode), nodes = baselineNodes(baseline), projection = hierarchyProjection(nodes, baseline.stage);
    const edges = aggregateProjectedEdges(projection, baseline.edgeChanges);
    const inputs = edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text }));
    const routes = new DiagramRouteCache().update(nodes, projection, inputs, [], new Map(), baseline.stage.presentation?.portPolicy);
    const routesBefore = structuredClone(routes), nodesBefore = structuredClone(nodes);
    const result = new LabelLayoutCache().update(nodes, projection, edges.map((edge) => ({ id: edge.id, text: edge.text })), routes);
    assert.deepEqual(routes, routesBefore);
    assert.deepEqual(nodes, nodesBefore);
    const geometry = createDiagramGeometry(nodes, projection);
    const upstreamRouteLabels = edges.flatMap((edge) => {
      const route = routes.get(edge.id);
      return route && route.feasible !== false && edge.text.trim() && route.label.width > 0 && route.label.height > 0
        ? [{ id: edge.id, label: route.label, box: rectOf(route.label) }] : [];
    });
    const current = edges.flatMap((edge) => {
      const label = result.labels.get(edge.id)?.placement;
      return label ? [{ id: edge.id, label, box: rectOf(label) }] : [];
    });
    for (const item of current) {
      assert.ok(geometry.blockers.every((blocker) => !rectIntersects(item.box, expandBounds(blocker, 8))), `${item.id}: node/header overlap`);
      assert.ok(geometry.frames.every((frame) => inside(expandBounds(frame, -8), item.box) || !rectIntersects(expandBounds(frame, 8), item.box)), `${item.id}: frame border overlap`);
      const attachment = result.labels.get(item.id)?.attachment;
      assert.ok(attachment, `${item.id}: missing route attachment`);
      assert.ok(distance(attachment.projected, routes.get(item.id)!.points) <= 0.0001, `${item.id}: attachment misses its route`);
      const dx = attachment.to.x - attachment.from.x, dy = attachment.to.y - attachment.from.y, length = Math.hypot(dx, dy);
      const halfAcross = (Math.abs(dy / length) * item.label.width + Math.abs(dx / length) * item.label.height) / 2;
      assert.ok(Math.abs(attachment.offset) <= 0.0001 || Math.abs(Math.abs(attachment.offset) - halfAcross) <= 2.0001, `${item.id}: detached label`);
    }
    const upstream = quality(upstreamRouteLabels, routes, geometry.blockers, geometry.frames), after = quality(current, routes, geometry.blockers, geometry.frames);
    assert.equal(after.labelOverlaps, 0);
    assert.equal(after.nodeOverlaps, 0);
    assert.equal(after.frameOverlaps, 0);
    assert.equal(after.farFromPath, 0);
    const metric = { stage: source.stage.label, mode, edges: edges.length, feasible: [...routes.values()].filter((route) => route.feasible !== false).length,
      upstreamRoutePlaceholders: { ...upstream, hidden: edges.length - upstream.visible }, labelLayout: { ...after, hidden: edges.length - after.visible }, durationMs: result.stats.durationMs };
    metrics.push(metric);
    t.diagnostic(JSON.stringify(metric));
  });
}

test('locking a hidden label preserves only the route, and the label can reappear when space returns', () => {
  const baseline = baselineForView(baselines[0]!, 'overview'), nodes = baselineNodes(baseline), projection = hierarchyProjection(nodes, baseline.stage);
  const edges = aggregateProjectedEdges(projection, baseline.edgeChanges);
  const inputs = edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, text: edge.text }));
  const routes = new DiagramRouteCache().update(nodes, projection, inputs, [], new Map(), baseline.stage.presentation?.portPolicy);
  const positioned = new LabelLayoutCache().update(nodes, projection, edges, routes).labels;
  const edge = edges.find((item) => !item.aggregated && !!positioned.get(item.id)?.placement)!;
  assert.ok(edge, 'fixture must contain a placeable real edge');
  const route = routes.get(edge.id)!;
  const minX = Math.min(...route.points.map((point) => point.x)) - 200, minY = Math.min(...route.points.map((point) => point.y)) - 200;
  const maxX = Math.max(...route.points.map((point) => point.x)) + 200, maxY = Math.max(...route.points.map((point) => point.y)) + 200;
  const blocker = { id: '__label_blocker__', type: 'card', position: { x: minX, y: minY }, width: maxX - minX, height: maxY - minY, data: { title: 'blocker' } };
  const blockedNodes = [...nodes, blocker];
  const visibleBlocker = { id: blocker.id, canonicalId: blocker.id, depth: 1, expanded: false, expandable: false };
  const blockedProjection = { ...projection, nodes: [...projection.nodes, visibleBlocker], nodeById: new Map([...projection.nodeById, [blocker.id, visibleBlocker] as const]) };
  const hidden = new LabelLayoutCache().update(blockedNodes, blockedProjection, [edge], new Map([[edge.id, route]])).labels.get(edge.id)!;
  assert.equal(hidden.state, 'space-exhausted');
  const zeroRoute = { ...route, label: { x: 0, y: 0, width: 0, height: 0 } };
  const snapshot = routeSnapshotForEdge(edge, zeroRoute, 'locked', nodes, []);
  assert.ok(snapshot);
  assert.equal(snapshot.label, undefined);
  assert.deepEqual(snapshot.points, route.points);
  const restoredRoutes = applyStoredRoutes(new Map([[edge.id, zeroRoute]]), [edge], [snapshot], nodes, projection, []);
  assert.deepEqual(restoredRoutes.get(edge.id)?.points, route.points);
  const restored = new LabelLayoutCache().update(nodes, projection, [{ id: edge.id, text: edge.text, ...(snapshot.label ? { fixed: snapshot.label } : {}) }], restoredRoutes).labels.get(edge.id)!;
  assert.ok(restored.placement);
});

after(() => {
  if (process.env.VISUALIZATION_METRICS_FILE) writeFileSync(process.env.VISUALIZATION_METRICS_FILE, `${JSON.stringify({ fixture: 'runtime-evolution authored initial projections, Legacy routes', cases: metrics }, null, 2)}\n`, 'utf8');
});
