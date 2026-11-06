import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPosition, type CanvasNode } from '../../src/react/model/layout/node.ts';
import { worldRoutePoints } from '../../src/react/model/routing/edge-routes.ts';
import { rebaseFrozenGrowth } from '../../src/react/model/freeze/frozen-growth.ts';
import type { EdgeRouteSnapshot, FrozenGroupSnapshot } from '../../src/react/model/contracts/snapshot-types.ts';

test('left/top frame growth rebases protected paths, labels and boundary segments without world drift', () => {
  const before: CanvasNode[] = [
    { id:'root', type:'structure', position:{x:100,y:100}, width:300,height:200,data:{title:'root',expanded:true} },
    { id:'child', type:'card', parentId:'root', position:{x:40,y:80}, width:240,height:82,data:{title:'child'} },
  ];
  const after = before.map((n) => n.id === 'root' ? { ...n, position:{x:60,y:70},width:340,height:230 } : { ...n,position:{x:n.position.x+40,y:n.position.y+30} });
  const group: FrozenGroupSnapshot = { id:'g',rootId:'root',memberIds:['child'],createdAt:'t',worldBounds:{x:100,y:100,w:300,h:200},boundaryPorts:[],frozenFrames:{root:{width:300,height:200}} };
  const inside: EdgeRouteSnapshot = { canonicalEdgeId:'inside',state:'locked',source:{nodeId:'root'},target:{nodeId:'child'},points:[{x:20,y:30},{x:40,y:30}],space:{kind:'owner',ownerId:'root'},endpointFingerprint:'f',label:{x:30,y:35,width:20,height:10} };
  const cross: EdgeRouteSnapshot = { canonicalEdgeId:'cross',state:'pinned',source:{nodeId:'child'},target:{nodeId:'outer'},points:[{x:140,y:180},{x:500,y:180}],space:{kind:'world'},endpointFingerprint:'c',frozenBoundaries:[{ownerId:'root',endpoint:'source',side:'right',points:[{x:40,y:80},{x:300,y:80}]}] };
  const next = rebaseFrozenGrowth(before, after, [inside,cross], [group]);
  assert.deepEqual(worldRoutePoints(next.routes[0]!,after), worldRoutePoints(inside,before));
  const boundaryWorld = (r: EdgeRouteSnapshot, nodes: CanvasNode[]) => { const origin = worldPosition(nodes[0]!, nodes); return r.frozenBoundaries![0]!.points.map((p) => ({x:p.x+origin.x,y:p.y+origin.y})); };
  assert.deepEqual(boundaryWorld(next.routes[1]!,after), boundaryWorld(cross,before));
  assert.deepEqual(next.routes[0]!.label, {x:70,y:65,width:20,height:10});
  assert.deepEqual(next.groups[0]!.protectedFrame, {x:40,y:30,width:300,height:200});
  assert.deepEqual(next.groups[0]!.frozenFrames!.root, {width:340,height:230});
});
