import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CanonicalNode, StageSnapshot } from '../../src/core/schema/types.ts';
import { adaptProgressReports, type ReportDataset } from '../../src/adapters/progress-reports/index.ts';
import { projectGraph } from '../../src/core/projection/index.ts';
import { baselineNodes, createHierarchyNodes, toggleHierarchy } from '../../src/react/model/hierarchy.ts';
import { freezeSelection, toggleFrozenExpansion } from '../../src/react/model/frozen.ts';
import { aggregateProjectedEdges } from '../../src/react/model/display-edges.ts';
import { DiagramRouteCache } from '../../src/react/model/route-cache.ts';
import { createDiagramGeometry } from '../../src/react/model/routing.ts';
import { worldRoutePoints } from '../../src/react/model/edge-routes.ts';
import { boundaryWorldPoints, captureFrozenSubgraph, resolveFrozenBoundaryRoute, validateFrozenConnections, releaseFrozenSubgraph } from '../../src/react/model/blackbox-routes.ts';
import { captureContent, restoreNodeViews, ViewHistory } from '../../src/react/model/workspace.ts';
import { createLocalStorageViewStorage } from '../../src/react/persistence/local-storage.ts';

const node = (id: string, parentId: string | null, order: number): CanonicalNode => ({ id, parentId, order, kind: parentId === null ? 'root' : 'component', label: id, ports: [] });
const stage: StageSnapshot = { id: 'main', label: 'main', title: 'main', track: 'main', order: 0, graph: {
  rootId: 'root', nodes: [node('root', null, 0), node('module', 'root', 1), node('nested', 'module', 2), node('one', 'nested', 3), node('two', 'nested', 4), node('outside', 'root', 5)],
  edges: [
    { id: 'inner', source: { nodeId: 'one' }, target: { nodeId: 'two' }, relation: 'data', direction: 'directed', order: 0 },
    { id: 'cross', source: { nodeId: 'one' }, target: { nodeId: 'outside' }, relation: 'call', direction: 'directed', order: 1 },
  ],
} };
const positions = { module: { x: 200, y: 150 }, nested: { x: 24, y: 72 }, one: { x: 24, y: 72 }, two: { x: 336, y: 72 }, outside: { x: 1700, y: 250 } };
const marks = Object.fromEntries(stage.graph.edges.map((e) => [e.id, { kind: 'baseline' as const, label: '基线' }]));

test('hidden descendants retain canonical routes and actual boundary segment through frozen movement and expansion', () => {
  const source = toggleHierarchy(createHierarchyNodes(stage, positions), 'module', stage).map((n) => n.id === 'module' ? { ...n, width: 520, data: { ...n.data, contentWidth: 400, contentHeight: 300 } } : n);
  const frozen = freezeSelection({ nodes: source, rootIds: ['module'], groupId: 'frozen:one', stage });
  assert.equal(frozen.ok, true); if (!frozen.ok) return;
  const projection = projectGraph(stage, ['module']);
  const displayEdges = aggregateProjectedEdges(projection, marks);
  const displayRoutes = new DiagramRouteCache().update(frozen.nodes, projection, displayEdges.map((e) => ({ id: e.id, source: e.source, target: e.target, text: e.text })));
  const capture = captureFrozenSubgraph({ nodes: frozen.nodes, stage, group: frozen.group, groups: [frozen.group], displayEdges, displayRoutes, storedRoutes: [] });
  assert.equal(capture.ok, true, capture.ok ? '' : JSON.stringify(capture.conflicts)); if (!capture.ok) return;
  assert.deepEqual(capture.routes.map((r) => r.canonicalEdgeId).sort(), ['cross', 'inner']);
  const inner = capture.routes.find((r) => r.canonicalEdgeId === 'inner')!;
  const cross = capture.routes.find((r) => r.canonicalEdgeId === 'cross')!;
  assert.equal(inner.state, 'locked'); assert.equal(inner.space.kind, 'owner');
  assert.equal(cross.frozenBoundaries?.[0]?.ownerId, 'module');
  assert.ok(capture.group.frozenFrames?.nested);
  const collapsed = toggleFrozenExpansion(capture.nodes, 'module', false, [capture.group]);
  assert.equal(collapsed.find((n) => n.id === 'module')!.width, 240);
  const reopened = toggleFrozenExpansion(collapsed, 'module', true, [capture.group]);
  const nestedOpen = toggleFrozenExpansion(reopened, 'nested', true, [capture.group]);
  assert.deepEqual({width:nestedOpen.find((n) => n.id === 'nested')!.width,height:nestedOpen.find((n) => n.id === 'nested')!.height}, capture.group.frozenFrames!.nested);
  const moved = nestedOpen.map((n) => n.id === 'module' ? { ...n, position: { x: n.position.x + 90, y: n.position.y + 40 } } : n);
  assert.deepEqual(worldRoutePoints(inner, moved), worldRoutePoints(inner, nestedOpen)!.map((p) => ({ x:p.x+90,y:p.y+40 })));
  const bound = cross.frozenBoundaries![0]!;
  assert.deepEqual(boundaryWorldPoints(bound, moved), boundaryWorldPoints(bound, nestedOpen).map((p) => ({x:p.x+90,y:p.y+40})));
  const openProjection = projectGraph(stage, ['module','nested']);
  const edges = aggregateProjectedEdges(openProjection, marks);
  const cache = new DiagramRouteCache();
  const routes = cache.update(moved, openProjection, edges.map((e) => ({ id:e.id,source:e.source,target:e.target,text:e.text })));
  const rerouted = resolveFrozenBoundaryRoute('cross', cross, moved, createDiagramGeometry(moved, openProjection), 'one', 'outside', routes.get('cross')!, [capture.group]);
  assert.equal(rerouted.ok, true, rerouted.ok ? '' : rerouted.message);
  if (rerouted.ok) assert.deepEqual(rerouted.route.points.slice(0, bound.points.length), boundaryWorldPoints(bound, moved));
  assert.deepEqual(validateFrozenConnections(nestedOpen,moved,stage,capture.routes,[capture.group],routes),[]);
  const history=new ViewHistory(),before=captureContent(nestedOpen,capture.routes,[capture.group]),after=captureContent(moved,capture.routes,[capture.group]);
  history.record(before,after);assert.deepEqual(history.undo(after),before);assert.deepEqual(history.redo(before),after);
  let text:string|null=null;const storage=createLocalStorageViewStorage({getItem:()=>text,setItem:(_key,value)=>{text=value;}});
  storage.save('blackbox',{version:2,baselineId:'main',baselines:{main:{revision:'one',...after}}});
  const loaded=storage.load('blackbox') as import('../../src/react/model/workspace.ts').CanvasWorkspaceView;
  assert.deepEqual(loaded.baselines.main!.edgeRoutes,after.edgeRoutes);
  assert.deepEqual(loaded.baselines.main!.frozenGroups,after.frozenGroups);
  const released=releaseFrozenSubgraph(moved,capture.routes,[capture.group],capture.group);
  assert.equal(released.edgeRoutes.length,0);assert.equal(released.frozenGroups.length,0);
});

test('releasing one owner preserves the other frozen endpoint on a shared boundary connection',()=>{
  const source=createHierarchyNodes(stage,positions),groups=[{id:'first',rootId:'module',memberIds:['nested','one','two'],worldBounds:{x:0,y:0,w:1,h:1},boundaryPorts:[],createdAt:'one'},{id:'second',rootId:'outside',memberIds:[],worldBounds:{x:0,y:0,w:1,h:1},boundaryPorts:[],createdAt:'two'}];
  const route={canonicalEdgeId:'cross',state:'pinned' as const,source:{nodeId:'one'},target:{nodeId:'outside'},space:{kind:'world' as const},endpointFingerprint:'cross',points:[{x:0,y:0},{x:100,y:0}],frozenBoundaries:[{ownerId:'module',endpoint:'source' as const,points:[{x:0,y:0},{x:20,y:0}],side:'right' as const},{ownerId:'outside',endpoint:'target' as const,points:[{x:100,y:0},{x:80,y:0}],side:'left' as const}]};
  const released=releaseFrozenSubgraph(source,[route],groups,groups[0]!);
  assert.deepEqual(released.edgeRoutes[0]!.frozenBoundaries?.map(part=>part.ownerId),['outside']);
});

test('freezing report Runtime with surrounding space captures all canonical incident edges', () => {
  const dataset = JSON.parse(readFileSync(new URL('../../datasets/progress-reports/architecture.json', import.meta.url), 'utf8')) as ReportDataset;
  const baseline = adaptProgressReports(dataset).at(-1)!;
  const source = baselineNodes(baseline).map((n) => !n.parentId && n.id !== 'runtime' ? { ...n, position: { x:n.position.x+6000, y:n.position.y+6000 } } : n);
  const frozen = freezeSelection({ nodes: source, rootIds: ['runtime'], groupId: 'report:runtime', stage: baseline.stage });
  assert.equal(frozen.ok, true); if (!frozen.ok) return;
  const projection = projectGraph(baseline.stage, ['runtime']);
  const displayEdges = aggregateProjectedEdges(projection, baseline.edgeChanges);
  const displayRoutes = new DiagramRouteCache().update(frozen.nodes, projection, displayEdges.map((e) => ({ id:e.id,source:e.source,target:e.target,text:e.text })));
  const capture = captureFrozenSubgraph({ nodes:frozen.nodes,stage:baseline.stage,group:frozen.group,groups:[frozen.group],displayEdges,displayRoutes,storedRoutes:[] });
  assert.equal(capture.ok, true, capture.ok ? '' : JSON.stringify(capture.conflicts)); if (!capture.ok) return;
  const ids = new Set([capture.group.rootId, ...capture.group.memberIds]);
  const expected = baseline.stage.graph.edges.filter((e) => ids.has(e.source.nodeId) || ids.has(e.target.nodeId)).map((e) => e.id).sort();
  assert.deepEqual(capture.routes.map((e) => e.canonicalEdgeId).sort(), expected);
});
