import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptProgressReports, type ReportDataset } from '../../src/adapters/progress-reports/index.ts';
import { baselineNodes, toggleHierarchy } from '../../src/react/model/layout/hierarchy.ts';
import { captureContent } from '../../src/react/model/workspace/workspace.ts';
import { type CanvasBaselineContent, type DisplayRouteSnapshot } from '../../src/react/model/contracts/snapshot-types.ts';
import { worldPosition, type CanvasNode } from '../../src/react/model/layout/node.ts';
import { planStageTransition } from '../../src/react/model/stages/stage-transition.ts';
import { hierarchyProjection } from '../../src/react/model/layout/visibility.ts';
import { aggregateProjectedEdges } from '../../src/react/model/routing/display-edges.ts';
import { resolveRoutes } from '../../src/react/model/routing/resolve-routes.ts';
import { DiagramRouteCache } from '../../src/react/model/routing/route-cache.ts';
import { captureDisplayRoutes } from '../../src/react/model/routing/display-route-snapshots.ts';
import { createDiagramGeometry, pathIsClear } from '../../src/react/model/routing/routing.ts';
import { freezeSelection, toggleFrozenExpansion } from '../../src/react/model/freeze/frozen.ts';
import { captureFrozenSubgraph, validateFrozenConnections } from '../../src/react/model/freeze/blackbox-routes.ts';
import { boundaryWorldPoints } from '../../src/react/model/routing/frozen-boundary.ts';
import { retainedCanonicalRoutes, reservedLockedRoutes, worldRoutePoints } from '../../src/react/model/routing/edge-routes.ts';

test('confirmed report M1 advances through every published stage without moving inherited content anchors', () => {
  const baselines = adaptProgressReports(JSON.parse(readFileSync(new URL('../fixtures/legacy-reports.json', import.meta.url), 'utf8')) as ReportDataset);
  let nodes = baselineNodes(baselines[0]!);
  for (const node of nodes.filter((node) => node.data.expandable)) nodes = toggleHierarchy(nodes, node.id, baselines[0]!.stage);
  let rootIndex = 0;
  nodes = nodes.map((node) => ({ ...node, ...(!node.parentId ? { position: { x: rootIndex++ % 3 * 2200, y: Math.floor((rootIndex - 1) / 3) * 1700 } } : {}), data: { ...node.data, layoutMode: 'fixed' as const } }));
  nodes = nodes.map((node) => !node.parentId&&node.data.expandable ? { ...node, width: 1360, height: 640, data: { ...node.data, contentWidth: 1360, contentHeight: 640 } } : node);
  const anchor = (node: CanvasNode, list: CanvasNode[]) => {
    const point = worldPosition(node, list);
    return node.data.expandable ? { x: point.x - (node.data.fitOffset?.x ?? 0), y: point.y - (node.data.fitOffset?.y ?? 0) } : point;
  };
  const projection=hierarchyProjection(nodes,baselines[0]!.stage),edges=aggregateProjectedEdges(projection,baselines[0]!.edgeChanges);
  const routes=new DiagramRouteCache().update(nodes,projection,edges.map(e=>({id:e.id,source:e.source,target:e.target,text:e.text})));
  let content:CanvasBaselineContent=captureContent(nodes,[],[],undefined,captureDisplayRoutes(nodes,projection,edges,routes));
  for (let index = 1; index < baselines.length; index++) {
    const before = nodes;
    const result = planStageTransition({ source: baselines[index - 1]!, target: baselines[index]!, sourceContent: content });
    assert.equal(result.ok, true, `${baselines[index]!.id}: ${result.ok ? '' : JSON.stringify(result.conflicts)}`);
    if (!result.ok) return;
    nodes = result.state.nodes;
    const geometry=createDiagramGeometry(nodes,hierarchyProjection(nodes,baselines[index]!.stage));
    for(const route of content.displayRoutes??[]){
      const next:DisplayRouteSnapshot|undefined=result.content.displayRoutes?.find(item=>item.id===route.id);
      if(next&&JSON.stringify(next.sourceBounds)===JSON.stringify(route.sourceBounds)&&JSON.stringify(next.targetBounds)===JSON.stringify(route.targetBounds)&&pathIsClear(route.points,geometry,route.source,route.target))assert.deepEqual(next.points,route.points,`${baselines[index]!.id} path:${route.id}`);
    }
    content=result.content;
    for (const node of before) {
      const next = nodes.find((item) => item.id === node.id);
      if (next) assert.deepEqual(anchor(next, nodes), anchor(node, before), `${baselines[index]!.id}: ${node.id}`);
    }
  }
  const baseline = baselines.at(-1)!, finalProjection = hierarchyProjection(nodes, baseline.stage);
  const finalEdges = aggregateProjectedEdges(finalProjection, baseline.edgeChanges);
  const finalRoutes = new DiagramRouteCache().update(nodes, finalProjection, finalEdges);
  const frozen = freezeSelection({ nodes, rootIds: ['runtime'], groupId: 'runtime:confirmed', stage: baseline.stage });
  assert.ok(frozen.ok); if (!frozen.ok) return;
  const captured = captureFrozenSubgraph({ nodes: frozen.nodes, stage: baseline.stage, group: frozen.group, groups: [frozen.group], displayEdges: finalEdges, displayRoutes: finalRoutes, storedRoutes: [] });
  assert.ok(captured.ok, captured.ok ? '' : JSON.stringify(captured.conflicts)); if (!captured.ok) return;
  const collapsed = toggleFrozenExpansion(captured.nodes, 'runtime', false, [captured.group]);
  const reservations = reservedLockedRoutes(captured.routes, collapsed, [captured.group]);
  assert.equal(reservations.filter(route => route.obstacle).length, 1);
  assert.ok(reservations.length < captured.routes.length);
  const moved = collapsed.map(node => node.id === 'runtime' ? { ...node, position: { x: node.position.x + 130, y: node.position.y + 130 } } : node);
  assert.deepEqual(validateFrozenConnections(collapsed, moved, baseline.stage, captured.routes, [captured.group], finalRoutes), []);
  const opened = toggleFrozenExpansion(moved, 'runtime', true, [captured.group]);
  assert.deepEqual(validateFrozenConnections(moved, opened, baseline.stage, captured.routes, [captured.group], finalRoutes), []);
  for (const route of captured.routes) {
    if (route.space.kind === 'owner') assert.deepEqual(worldRoutePoints(route, opened), worldRoutePoints(route, captured.nodes)!.map(point => ({ x: point.x + 130, y: point.y + 130 })));
    for (const segment of route.frozenBoundaries ?? []) assert.deepEqual(boundaryWorldPoints(segment, opened), boundaryWorldPoints(segment, captured.nodes).map(point => ({ x: point.x + 130, y: point.y + 130 })));
  }
  const openedProjection = hierarchyProjection(opened, baseline.stage), openedEdges = aggregateProjectedEdges(openedProjection, baseline.edgeChanges);
  const barriers = reservedLockedRoutes(captured.routes, opened, [captured.group]);
  const scene = { nodes: opened, projection: openedProjection, edges: openedEdges, stored: captured.routes, frozen: [captured.group] };
  const visible = resolveRoutes(scene, new DiagramRouteCache()).routes;
  const snapshots = captureDisplayRoutes(opened, openedProjection, openedEdges, visible, barriers);
  const restored = resolveRoutes({ ...structuredClone(scene), displaySnapshots: snapshots }, new DiagramRouteCache()).routes;
  for (const edge of openedEdges) assert.deepEqual(restored.get(edge.id)!.points, visible.get(edge.id)!.points, `restored frozen view: ${edge.id}`);
});
