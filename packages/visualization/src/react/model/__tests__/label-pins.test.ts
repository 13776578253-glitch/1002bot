import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageSnapshot } from '../../../core/schema/types.ts';
import type { VisualizationBaseline } from '../../../core/schema/baseline.ts';
import type { DisplayEdge } from '../display-edges.ts';
import { labelPinForEdge, pinLabelForEdge, removeLabelPin, removeLabelPinForEdge, retainLabelPins, upsertLabelPin } from '../label-pins.ts';
import { draftMatchesConfirmed } from '../confirmation.ts';
import { mergeStageContent } from '../snapshot-inheritance.ts';
import { canvasWorkspaceToProject, projectWorkspaceToCanvas } from '../project-workspace.ts';
import { normalizeWorkspaceView } from '../../persistence/workspace-schema.ts';
import { createProjectViewStorage, normalizeProjectWorkspace } from '../../persistence/project-storage.ts';
import { captureContent, ViewHistory, type CanvasBaselineContent, type CanvasWorkspaceView, type EdgeLabelPin } from '../workspace.ts';
import { baselineNodes } from '../hierarchy.ts';
import { rebaseSavedView } from '../stage-navigation.ts';

const label = { x: 100, y: 200, width: 70, height: 24 };
const member = (id: string) => ({ canonicalEdgeId: id, edge: { id, source: { nodeId: 'a' }, target: { nodeId: 'b' } } });
const edge = { id: 'aggregate:one', source: 'a', target: 'b', members: [member('e1'), member('e2')] } as DisplayEdge;
const pin = (): EdgeLabelPin => pinLabelForEdge(edge, label);
const content = (): CanvasBaselineContent => ({ nodes: [], edgeRoutes: [], frozenGroups: [] });
const stage: StageSnapshot = { id: 'm2', label: 'M2', title: 'M2', order: 2, track: 'main', graph: { rootId: 'root', nodes: [
  { id: 'root', parentId: null, kind: 'root', label: 'Root', ports: [], order: 0 },
  { id: 'a', parentId: 'root', kind: 'component', label: 'A', ports: [], order: 0 },
  { id: 'b', parentId: 'root', kind: 'component', label: 'B', ports: [], order: 1 },
], edges: [
  { id: 'e1', source: { nodeId: 'a' }, target: { nodeId: 'b' }, relation: 'call', direction: 'directed', order: 0 },
  { id: 'e2', source: { nodeId: 'a' }, target: { nodeId: 'b' }, relation: 'call', direction: 'directed', order: 1 },
] } };

test('pins match exact displayed endpoints and canonical members, regardless of member order', () => {
  const p = pin(), reversed = { ...edge, members: [...edge.members].reverse() };
  assert.deepEqual(labelPinForEdge([p], reversed), p);
  assert.equal(labelPinForEdge([p], { ...edge, target: 'c' }), undefined);
  assert.equal(labelPinForEdge([p], { ...edge, members: [edge.members[0]!] }), undefined);
  assert.equal(labelPinForEdge([p], { ...edge, id: 'e1', members: [edge.members[0]!] }), undefined);
  const changedMember = structuredClone(edge);
  changedMember.members[0]!.edge.target.nodeId = 'a';
  assert.equal(labelPinForEdge([p], changedMember), undefined);
  const firstPorts = structuredClone(edge), secondPorts = structuredClone(edge);
  firstPorts.members[0]!.edge.source = { nodeId: 'a:b', portId: 'c' };
  secondPorts.members[0]!.edge.source = { nodeId: 'a', portId: 'b:c' };
  assert.equal(labelPinForEdge([pinLabelForEdge(firstPorts, label)], secondPorts), undefined);
  const updated = upsertLabelPin([p], { ...p, label: { ...label, x: 130 } });
  assert.equal(updated.length, 1);
  assert.equal(updated[0]!.label.x, 130);
  assert.deepEqual(removeLabelPin(updated, p.id), []);
  const previousMembers = { ...p, memberIds: ['e1'] };
  assert.deepEqual(removeLabelPinForEdge([p, previousMembers], edge), [previousMembers]);
});

test('legacy label pins migrate using the source graph and reject a changed member endpoint', () => {
  const { memberFingerprints: _identity, ...legacy } = pin();
  const kept = retainLabelPins([legacy], stage, [], stage);
  assert.deepEqual(kept[0]!.memberFingerprints, pin().memberFingerprints);
  const changed = structuredClone(stage);
  changed.graph.edges[0]!.target.nodeId = 'a';
  assert.deepEqual(retainLabelPins([legacy], changed, [], stage), []);
  assert.deepEqual(retainLabelPins([pin()], changed, []), []);
  const old = { ...content(), labelPins: [legacy] };
  const result = mergeStageContent({ base: old, local: old, incoming: old, targetStage: changed, baseStage: stage, localStage: stage, incomingStage: stage });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.content.labelPins, undefined);
});

test('legacy automatic path label changes do not dirty an otherwise confirmed draft', () => {
  const original = { ...content(), edgeRoutes: [{ canonicalEdgeId: 'e1', state: 'pinned' as const, source: { nodeId: 'a' }, target: { nodeId: 'b' }, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], space: { kind: 'world' as const }, endpointFingerprint: 'e1:a:>b:', label }] };
  const next = structuredClone(original);
  next.edgeRoutes[0]!.label.x = 999;
  assert.equal(draftMatchesConfirmed({ revision: 'one', ...next, confirmed: original }), true);
  assert.equal(new ViewHistory().record(original, next), false);
});

test('user pin participates in confirmation and history, empty legacy state remains equal', () => {
  const initial = content();
  const view = { revision: 'one', ...initial, confirmed: structuredClone(initial) };
  assert.equal(draftMatchesConfirmed({ ...view, labelPins: [] }), true);
  const modified = { ...view, labelPins: [pin()] };
  assert.equal(draftMatchesConfirmed(modified), false);
  const history = new ViewHistory();
  assert.equal(history.record(initial, modified), true);
  const undo = history.undo(modified);
  assert.deepEqual(undo.labelPins, undefined);
  assert.deepEqual(history.redo(undo).labelPins, [pin()]);
});

test('pins survive each independent project view and invalid pin data is rejected', () => {
  const overview = { revision: 'one', ...content(), labelPins: [pin()] };
  const structure = { revision: 'one', ...content() };
  const source: CanvasWorkspaceView = { version: 2, baselineId: 'm1', viewMode: 'overview', baselines: { m1: overview }, views: { overview: { m1: overview }, structure: { m1: structure } } };
  const project = canvasWorkspaceToProject(source, 'project');
  const restored = projectWorkspaceToCanvas(normalizeProjectWorkspace(project, 'project'));
  assert.deepEqual(restored.views!.overview!.m1!.labelPins, [pin()]);
  assert.equal(restored.views!.structure!.m1!.labelPins, undefined);
  const invalid = structuredClone(source);
  invalid.baselines.m1!.labelPins![0]!.label.width = -1;
  assert.throws(() => normalizeWorkspaceView(invalid), /标签固定位置格式不正确/);
});

test('saved project storage reloads pin metadata independently for each stage and view', async () => {
  const values = new Map<string, string>();
  const storage = createProjectViewStorage({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, 'project');
  const p = pin();
  const first = { revision: 'one', ...content(), labelPins: [p] };
  const second = { revision: 'two', ...content(), labelPins: [{ ...p, label: { ...p.label, x: 250 } }] };
  const structure = { revision: 'one', ...content() };
  const workspace: CanvasWorkspaceView = { version: 2, baselineId: 'm1', viewMode: 'overview', baselines: { m1: first, m2: second }, views: { overview: { m1: first, m2: second }, structure: { m1: structure } } };
  await storage.save('workspace', workspace);
  const loaded = await storage.load('workspace');
  assert.equal(loaded!.views!.overview!.m1!.labelPins![0]!.label.x, 100);
  assert.equal(loaded!.views!.overview!.m2!.labelPins![0]!.label.x, 250);
  assert.equal(loaded!.views!.structure!.m1!.labelPins, undefined);
});

test('three-way stage merge keeps local edits, inherits upstream additions, and drops removed members', () => {
  const base = content(), local = content(), incoming = content();
  incoming.labelPins = [pin()];
  let merged = mergeStageContent({ base, local, incoming, targetStage: stage });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.deepEqual(merged.content.labelPins, [pin()]);
  const old = { ...content(), labelPins: [pin()] };
  const edited = structuredClone(old), updated = structuredClone(old);
  edited.labelPins![0]!.label.x = 130;
  updated.labelPins![0]!.label.x = 150;
  merged = mergeStageContent({ base: old, local: edited, incoming: updated, targetStage: stage });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.content.labelPins![0]!.label.x, 130);
  assert.deepEqual(retainLabelPins([pin()], { ...stage, graph: { ...stage.graph, edges: [stage.graph.edges[0]!] } }, []), []);
  const changed = structuredClone(stage);
  changed.graph.edges[0]!.target.nodeId = 'a';
  assert.deepEqual(retainLabelPins([pin()], changed, [], stage), []);
});

test('source revision drops pins whose canonical member was removed while retaining the confirmation', () => {
  const oldStage: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'old' } };
  const newStage: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'new', edges: [stage.graph.edges[0]!] } };
  const changes = { kind: 'baseline', label: '基线' } as const;
  const oldBaseline: VisualizationBaseline = { id: 'm2', stage: oldStage, nodeChanges: { a: changes, b: changes }, edgeChanges: { e1: changes, e2: changes }, positions: { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } } };
  const newBaseline: VisualizationBaseline = { ...oldBaseline, stage: newStage, edgeChanges: { e1: changes } };
  const draft = captureContent(baselineNodes(oldBaseline), [], [], undefined, undefined, [pin()]);
  const saved = { revision: 'old', ...draft, confirmed: structuredClone(draft), confirmedAt: '2026-11-04', sourceStage: oldStage };
  const rebased = rebaseSavedView(newBaseline, saved);
  assert.equal(rebased.labelPins, undefined);
  assert.deepEqual(rebased.confirmed!.labelPins, [pin()]);
  assert.equal(rebased.requiresConfirmation, true);
});

test('source revision invalidates a legacy aggregate pin when one member changes port with the same id', () => {
  const oldStage: StageSnapshot = { ...stage, graph: { ...stage.graph, revision: 'old' } };
  const newStage = structuredClone(oldStage);
  newStage.graph.revision = 'new';
  newStage.graph.nodes.find((node) => node.id === 'b')!.ports = [{ id: 'in', direction: 'in', side: 'left', order: 0 }];
  newStage.graph.edges[0]!.target.portId = 'in';
  const mark = { kind: 'baseline', label: '基线' } as const;
  const oldBaseline: VisualizationBaseline = { id: 'm2', stage: oldStage, nodeChanges: { a: mark, b: mark }, edgeChanges: { e1: mark, e2: mark }, positions: { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } } };
  const newBaseline = { ...oldBaseline, stage: newStage };
  const { memberFingerprints: _identity, ...legacy } = pin();
  const draft = captureContent(baselineNodes(oldBaseline), [], [], undefined, undefined, [legacy]);
  const saved = { revision: 'old', ...draft, confirmed: structuredClone(draft), confirmedAt: '2026-11-04', sourceStage: oldStage };
  const rebased = rebaseSavedView(newBaseline, saved);
  assert.equal(rebased.labelPins, undefined);
  assert.deepEqual(rebased.confirmed!.labelPins, [legacy]);
  assert.equal(rebased.requiresConfirmation, true);
});

test('invalid persisted pin aborts project save without replacing the stored record', async () => {
  const values = new Map<string, string>();
  const storage = createProjectViewStorage({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, 'project');
  const first = { revision: 'one', ...content(), labelPins: [pin()] };
  const workspace: CanvasWorkspaceView = { version: 2, baselineId: 'm1', viewMode: 'overview', baselines: { m1: first }, views: { overview: { m1: first } } };
  await storage.save('workspace', workspace);
  const invalid = JSON.parse(values.get('workspace')!);
  invalid.stages.m1.draft.labelPins[0].label.width = -1;
  invalid.stages.m1.views.overview.draft.labelPins[0].label.width = -1;
  const before = JSON.stringify(invalid);
  values.set('workspace', before);
  await assert.rejects(async () => storage.save('workspace', workspace), /标签固定位置格式不正确/);
  assert.equal(values.get('workspace'), before);
});
