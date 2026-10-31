import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptProgressReports, type ReportDataset } from '../../src/adapters/progress-reports/index.ts';
import { baselineNodes, toggleHierarchy } from '../../src/react/model/hierarchy.ts';
import { captureContent, type CanvasBaselineContent, type DisplayRouteSnapshot } from '../../src/react/model/workspace.ts';
import { worldPosition, type CanvasNode } from '../../src/react/model/grouping.ts';
import { planStageTransition } from '../../src/react/model/stage-transition.ts';
import { hierarchyProjection } from '../../src/react/model/hierarchy.ts';
import { aggregateProjectedEdges } from '../../src/react/model/display-edges.ts';
import { DiagramRouteCache } from '../../src/react/model/route-cache.ts';
import { captureDisplayRoutes } from '../../src/react/model/display-route-snapshots.ts';
import { createDiagramGeometry, pathIsClear } from '../../src/react/model/routing.ts';

test('confirmed report M1 advances through every published stage without moving inherited content anchors', () => {
  const baselines = adaptProgressReports(JSON.parse(readFileSync(new URL('../../datasets/progress-reports/architecture.json', import.meta.url), 'utf8')) as ReportDataset);
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
});
