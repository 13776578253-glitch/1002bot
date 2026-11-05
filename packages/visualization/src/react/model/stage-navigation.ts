/** Atomic navigation and three-way rebasing over confirmed parent snapshots. */
import type { VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { CanvasBaselineContent, CanvasBaselineView } from './workspace.ts';
import { captureNodeViews, restoreNodeViews } from './workspace.ts';
import { deriveAuthoredLayout } from './manual-layout.ts';
import { validateFrozenConnections } from './blackbox-routes.ts';
import { layoutProtectionConflict } from './grouping.ts';
import { baselineNodes } from './hierarchy.ts';
import { hierarchyProjection, nodeIsVisible } from './hierarchy.ts';
import { worldPosition } from './grouping.ts';
import { aggregateProjectedEdges } from './display-edges.ts';
import { DiagramRouteCache } from './route-cache.ts';
import { createDiagramGeometry, pathIsClear, withReservedRoutes } from './routing.ts';
import { reservedLockedRoutes, validateStoredRoutes, retainedCanonicalRoutes, applyStoredRoutes } from './edge-routes.ts';
import { captureDisplayRoutes, retainedDisplayRoutes } from './display-route-snapshots.ts';
import { restoreFrozenGroups } from './frozen.ts';
import { planStageTransition, type StageTransitionResult } from './stage-transition.ts';
import { captureStageInheritance, mergeStageContent, needsStageRebase, type StageInheritanceBase } from './snapshot-inheritance.ts';

export type NavigationResult = StageTransitionResult & { inheritance?: StageInheritanceBase; reused?: boolean; resetCandidate?: Extract<StageTransitionResult, {ok:true}> };

/** 来源变化会创建新草稿，同时保留之前的确认。 */
export function rebaseSavedView(target: VisualizationBaseline, saved: CanvasBaselineView): CanvasBaselineView {
  const merged = prepareSourceRevision(target, saved);
  if (!merged.ok) throw new Error(merged.conflicts.map((item) => item.message).join('；'));
  const { overlay: _overlay, displayRoutes: _displayRoutes, labelPins: _labelPins, ...metadata } = saved;
  return { ...metadata, ...merged.content, requiresConfirmation: true, ...(saved.confirmed ? { confirmedRevision: saved.confirmedRevision ?? saved.revision } : {}), revision: target.stage.graph.revision ?? target.stage.id, sourceStage: target.stage };
}

function finalizeMerged(target: VisualizationBaseline, previous: CanvasBaselineContent, content: CanvasBaselineContent, generated: Extract<StageTransitionResult,{ok:true}>, inheritance?: StageInheritanceBase): NavigationResult {
  const restored=restoreNodeViews(target,baselineNodes(target),content.nodes);
  const fitted=target.layout?.kind === 'manual' ? deriveAuthoredLayout(restored,target.stage) : { nodes:restored };
  const nodes=fitted.nodes;
  const old=restoreNodeViews(target,baselineNodes(target),previous.nodes);
  const oldIds=new Set(previous.nodes.map((node)=>node.id));
  const projection=hierarchyProjection(nodes,target.stage);
  const ancestor=(a:string,b:string)=>{let p=nodes.find(n=>n.id===b)?.parentId;while(p){if(p===a)return true;p=nodes.find(n=>n.id===p)?.parentId;}return false;};
  const hit=(a:typeof nodes[number],b:typeof nodes[number],all:typeof nodes)=>{const x=worldPosition(a,all),y=worldPosition(b,all);return x.x<y.x+b.width!&&x.x+a.width!>y.x&&x.y<y.y+b.height!&&x.y+a.height!>y.y;};
  const visible=nodes.filter(node=>nodeIsVisible(node,nodes,projection));
  const issues=[];
  if (fitted.conflict) issues.push(fitted.conflict);
  const movedParents = new Set(nodes.filter((node) => node.data.layoutEdits?.position?.origin === 'user' && JSON.stringify(node.data.layoutEdits.position) !== JSON.stringify(old.find((item) => item.id === node.id)?.data.layoutEdits?.position)).map((node) => node.id));
  if (layoutProtectionConflict(old,nodes,movedParents)) issues.push({kind:'merge-conflict' as const,entityIds:[],message:'合并后布局改变了固定节点的锚点',actions:['cancel' as const]});
  for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){
    const a=visible[i]!,b=visible[j]!;
    if(ancestor(a.id,b.id)||ancestor(b.id,a.id)||!hit(a,b,nodes))continue;
    const oldA=old.find(n=>n.id===a.id)!,oldB=old.find(n=>n.id===b.id)!;
    if(oldIds.has(a.id)&&oldIds.has(b.id)&&hit(oldA,oldB,old))continue;
    issues.push({kind:'merge-conflict' as const,entityIds:[a.id,b.id],message:'合并后节点重叠，原阶段布局已保留',actions:['cancel' as const]});
  }
  const routeConflict=validateStoredRoutes(old,nodes,content.edgeRoutes,projection);
  if(routeConflict)issues.push({kind:'merge-conflict' as const,entityIds:[],message:routeConflict,actions:['cancel' as const]});
  const frozen=restoreFrozenGroups(nodes,content.frozenGroups);
  issues.push(...frozen.conflicts);
  issues.push(...validateFrozenConnections(old,nodes,target.stage,content.edgeRoutes,content.frozenGroups));
  const edges=aggregateProjectedEdges(projection,target.edgeChanges),reserved=reservedLockedRoutes(content.edgeRoutes,nodes,content.frozenGroups);
  const retained=retainedCanonicalRoutes(nodes,projection,edges,content.edgeRoutes,retainedDisplayRoutes(nodes,projection,edges,content.displayRoutes,reserved),content.frozenGroups);
  const boundaryFailures=new Map<string,string>();
  const routes=applyStoredRoutes(new DiagramRouteCache().update(nodes,projection,edges.map(e=>({id:e.id,source:e.source,target:e.target,text:e.text})),reserved,retained),edges,content.edgeRoutes,nodes,projection,content.frozenGroups,boundaryFailures);
  for(const [id,message] of boundaryFailures)issues.push({kind:'merge-conflict' as const,entityIds:[id],message,actions:['cancel' as const]});
  const geometry=createDiagramGeometry(nodes,projection,reserved);
  for(const edge of edges)if(!pathIsClear(routes.get(edge.id)!.points,retained.has(edge.id)?withReservedRoutes(geometry,[]):geometry,edge.source,edge.target,edge.id))issues.push({kind:'merge-conflict' as const,entityIds:[edge.id],message:'合并后的连接无法满足路径约束',actions:['cancel' as const]});
  const pathOnly = new Map([...routes].map(([id, route]) => [id, { ...route, label: { x: 0, y: 0, width: 0, height: 0 } }]));
  const snapshots=issues.length ? [] : captureDisplayRoutes(nodes,projection,edges,pathOnly,reserved);
  const merged={...content,nodes:captureNodeViews(nodes),displayRoutes:snapshots};
  const state={nodes:frozen.nodes,edgeRoutes:merged.edgeRoutes,frozenGroups:frozen.groups,...(merged.overlay?{overlay:merged.overlay}:{}),displayRoutes:snapshots,...(merged.labelPins?.length?{labelPins:merged.labelPins}:{})};
  if(issues.length)return{ok:false,base:previous,candidate:state,conflicts:issues};
  return{...generated,base:previous,content:merged,state,...(inheritance?{inheritance}:{})};
}

export function prepareStageNavigation(input: { parent: VisualizationBaseline; target: VisualizationBaseline; parentContent: CanvasBaselineContent; saved?: CanvasBaselineView }): NavigationResult {
  const { parent, target, parentContent, saved } = input;
  const current = { parentId: parent.id, parentRevision: parent.stage.graph.revision ?? parent.stage.id, parentContent, targetStage: target.stage };
  if (saved?.inheritance && !needsStageRebase(saved.inheritance, current)) {
    const frozen = restoreFrozenGroups(restoreNodeViews(target, baselineNodes(target), saved.nodes), saved.frozenGroups);
    const state = { nodes: frozen.nodes, edgeRoutes: saved.edgeRoutes, frozenGroups: frozen.groups, ...(saved.overlay ? {overlay:saved.overlay}:{}), ...(saved.displayRoutes ? {displayRoutes:saved.displayRoutes}:{}), ...(saved.labelPins?.length ? {labelPins:saved.labelPins}:{}) };
    if (frozen.conflicts.length) return { ok:false, base:saved, candidate:state, conflicts:frozen.conflicts };
    return { ok:true, base:saved, content:saved, state, record:saved.transition ?? { fromStageId:parent.id,toStageId:target.id,sourceRevision:current.parentRevision,targetRevision:saved.revision,startedAt:'restored',durationMs:0,placements:[],expanded:[] }, inheritance:saved.inheritance, reused:true };
  }
  const generated = planStageTransition({ source:parent,target,sourceContent:parentContent });
  if (!generated.ok) return generated;
  const inheritance = captureStageInheritance({...current,targetContent:generated.content});
  if (!saved) return {...generated,inheritance};
  if (!saved.inheritance) return {ok:false,base:saved,candidate:generated.state,conflicts:[{kind:'merge-conflict',entityIds:[],message:'旧阶段视图缺少父快照基准，可保留原记录或显式从当前父阶段重新继承',actions:['cancel','retry']}],resetCandidate:generated,inheritance};
  const merged = mergeStageContent({ base:saved.inheritance.targetContent,local:saved,incoming:generated.content,targetStage:target.stage,
    baseStage:saved.inheritance.targetStage,localStage:saved.sourceStage ?? saved.inheritance.targetStage,incomingStage:target.stage });
  if (!merged.ok) return {ok:false,base:saved,candidate:generated.state,conflicts:merged.conflicts};
  const frozen = restoreFrozenGroups(restoreNodeViews(target,baselineNodes(target),merged.content.nodes),merged.content.frozenGroups);
  if (frozen.conflicts.length) return {ok:false,base:saved,candidate:generated.state,conflicts:frozen.conflicts};
  return finalizeMerged(target,saved,merged.content,generated,inheritance);
}

export function prepareSourceRevision(target: VisualizationBaseline, saved: CanvasBaselineView): StageTransitionResult {
  const old = saved.sourceStage ?? saved.inheritance?.targetStage;
  if (!old) return {ok:false,base:saved,candidate:{nodes:restoreNodeViews(target,baselineNodes(target),saved.nodes),edgeRoutes:saved.edgeRoutes,frozenGroups:saved.frozenGroups},conflicts:[{kind:'merge-conflict',entityIds:[],message:'旧工作视图缺少来源基准，请检查当前来源后重新确认',actions:['cancel']}]};
  const base = saved.confirmed ?? saved;
  const generated = planStageTransition({source:{...target,stage:old},target,sourceContent:base});
  if (!generated.ok) return generated;
  const merged = mergeStageContent({base,local:saved,incoming:generated.content,targetStage:target.stage,baseStage:old,localStage:old,incomingStage:target.stage});
  if (!merged.ok) return {ok:false,base:saved,candidate:generated.state,conflicts:merged.conflicts};
  return finalizeMerged(target,saved,merged.content,generated);
}
