import test from 'node:test';
import assert from 'node:assert/strict';
import type { VisualizationBaseline } from '../../src/core/schema/baseline.ts';
import { baselineNodes } from '../../src/react/model/layout/hierarchy.ts';
import { captureContent } from '../../src/react/model/workspace/workspace.ts';
import { type CanvasBaselineView } from '../../src/react/model/contracts/snapshot-types.ts';
import { prepareStageNavigation, prepareSourceRevision } from '../../src/react/model/stages/stage-navigation.ts';
import { createLocalStorageViewStorage } from '../../src/react/persistence/local-storage.ts';

function baseline(id:string,extra=false):VisualizationBaseline{
  const ids=['a','b',...(extra?['c']:[])];
  return{id,stage:{id,label:id,title:id,order:0,track:'main',graph:{rootId:'root',revision:id,nodes:[{id:'root',parentId:null,kind:'root',label:'root',ports:[],order:0},...ids.map((id,order)=>({id,parentId:'root',kind:'component' as const,label:id,ports:[],order}))],edges:[]}},nodeChanges:Object.fromEntries(ids.map(id=>[id,{kind:'inherited',label:'沿用'}])),edgeChanges:{}};
}
const parent=baseline('one'),target=baseline('two',true);
const parentContent=()=>captureContent(baselineNodes(parent));
const first=()=>prepareStageNavigation({parent,target,parentContent:parentContent()});
const saved=():CanvasBaselineView=>{const initial=first();assert.ok(initial.ok);return{...initial.content,revision:'two',inheritance:initial.inheritance!,sourceStage:target.stage};};

test('revisiting an unchanged inherited stage preserves the current draft instead of generating it again',()=>{
  const view=saved();view.nodes.find(n=>n.id==='b')!.position.y=400;
  const result=prepareStageNavigation({parent,target,parentContent:parentContent(),saved:view});
  assert.ok(result.ok);assert.equal(result.reused,true);assert.equal(result.content.nodes.find(n=>n.id==='b')!.position.y,400);
});
test('upstream re-confirmation rebases unrelated edits and retains the new generated base separately',()=>{
  const view=saved();view.nodes.find(n=>n.id==='b')!.position.y=400;
  const incoming=parentContent();incoming.nodes.find(n=>n.id==='a')!.position.y=-200;
  const result=prepareStageNavigation({parent,target,parentContent:incoming,saved:view});
  assert.ok(result.ok, result.ok?'':JSON.stringify(result.conflicts));
  assert.equal(result.content.nodes.find(n=>n.id==='a')!.position.y,-200);
  assert.equal(result.content.nodes.find(n=>n.id==='b')!.position.y,400);
  assert.notEqual(result.inheritance!.targetContent.nodes.find(n=>n.id==='b')!.position.y,400);
});
test('divergent edits conflict atomically without changing any saved input',()=>{
  const view=saved();view.nodes.find(n=>n.id==='a')!.position.y=400;
  const incoming=parentContent();incoming.nodes.find(n=>n.id==='a')!.position.y=-200;
  const before=structuredClone(view);
  view.nodes.find(n=>n.id==='a')!.data.layoutEdits = { version:1, position:{x:0,y:400,origin:'user'} };
  incoming.nodes.find(n=>n.id==='a')!.data.layoutEdits = { version:1, position:{x:0,y:-200,origin:'user'} };
  Object.assign(before, structuredClone(view));
  const result=prepareStageNavigation({parent,target,parentContent:incoming,saved:view});
  assert.equal(result.ok,false);assert.deepEqual(view,before);
});
test('legacy target stages require explicit re-inheritance and retain the previous layout for undo',()=>{
  const view=saved();delete view.inheritance;
  const result=prepareStageNavigation({parent,target,parentContent:parentContent(),saved:view});
  assert.equal(result.ok,false);assert.ok(result.resetCandidate?.ok);assert.deepEqual(result.base,view);
});
test('source revision additions preserve existing positions and source deletion of an edited node conflicts',()=>{
  const initial=captureContent(baselineNodes(parent));
  const view={...initial,revision:'one',confirmed:structuredClone(initial),sourceStage:parent.stage};
  const addition=prepareSourceRevision({...target,id:'one'},view);
  assert.ok(addition.ok,addition.ok?'':JSON.stringify(addition.conflicts));
  assert.deepEqual(addition.content.nodes.find(n=>n.id==='a')!.position,initial.nodes.find(n=>n.id==='a')!.position);
  view.nodes.find(n=>n.id==='b')!.position.y=400;
  const deleted={...parent,stage:{...parent.stage,graph:{...parent.stage.graph,revision:'revision-2',nodes:parent.stage.graph.nodes.filter(n=>n.id!=='b')}}};
  const conflict=prepareSourceRevision(deleted,view);
  assert.equal(conflict.ok,false);
});
test('inheritance evidence and source snapshots survive persistence without automatic confirmation',()=>{
  const view=saved();let text:string|null=null;
  const storage=createLocalStorageViewStorage({getItem:()=>text,setItem:(_key,value)=>{text=value;}});
  storage.save('key',{version:2,baselineId:'two',baselines:{two:view}});
  const loaded=storage.load('key') as import('../../src/react/model/contracts/snapshot-types.ts').CanvasWorkspaceView;
  assert.deepEqual(loaded.baselines.two!.inheritance,view.inheritance);
  assert.deepEqual(loaded.baselines.two!.sourceStage,view.sourceStage);
  assert.equal(loaded.baselines.two!.confirmed,undefined);
});
