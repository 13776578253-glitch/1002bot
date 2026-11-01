import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptProject, type ArchitectureProject, type ProjectSourceStage, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { projectGraph } from '../../src/core/projection/index.ts';

const empty = () => ({ components: [], relations: [], contracts: [] });
const removals = () => ({ componentIds: [], relationIds: [], contractIds: [] });

function project(): ArchitectureProject {
  const initial: ProjectSourceStage = {
    id: 'M0', label: 'M0', title: 'Base', upsert: {
      components: [
        { id: 'actor', kind: 'actor', label: 'Caller', contractIds: [], sourceRefs: ['report.md#caller'] },
        { id: 'engine', kind: 'group', label: 'Engine', contractIds: ['request'], sourceRefs: ['report.md#engine'] },
        { id: 'worker', kind: 'component', label: 'Worker', contractIds: ['request'], sourceRefs: ['report.md#worker'] },
        { id: 'unseen', kind: 'store', label: 'Internal state', contractIds: [], sourceRefs: ['report.md#state'] },
      ],
      contracts: [{ id: 'request', label: 'Request', sourceRefs: ['report.md#request'] }],
      relations: [{ id: 'invoke', source: { nodeId: 'actor' }, target: { nodeId: 'worker' }, relation: 'call', direction: 'directed', label: 'execute', order: 1, contractIds: ['request'], sourceRefs: ['report.md#invoke'] }],
    }, remove: removals(),
  };
  const follow: ProjectSourceStage = {
    id: 'M1', previousId: 'M0', label: 'M1', title: 'Storage', upsert: {
      ...empty(), components: [{ id: 'archive', kind: 'store', label: 'Archive', contractIds: [], sourceRefs: ['report.md#archive'] }],
      relations: [{ id: 'write', source: { nodeId: 'worker' }, target: { nodeId: 'archive' }, relation: 'storage', direction: 'directed', label: 'write', order: 2, contractIds: [], sourceRefs: ['report.md#write'] }],
    }, remove: removals(),
  };
  const branch: ProjectSourceStage = { id: 'M1-alt', previousId: 'M0', label: 'M1-alt', title: 'Alternative', upsert: empty(), remove: removals() };
  const baseView: ProjectViewDefinition = {
    id: 'main-M0', stageId: 'M0', rootId: 'root', nodes: [
      { id: 'caller-view', componentId: 'actor', parentId: 'root', order: 1, frame: { x: 40, y: 60, width: 240, height: 80 }, ports: [] },
      { id: 'engine-view', componentId: 'engine', parentId: 'root', order: 2, frame: { x: 480, y: 60, width: 240, height: 80 }, expandedSize: { width: 520, height: 240 }, ports: [] },
      { id: 'worker-view', componentId: 'worker', parentId: 'engine-view', order: 1, frame: { x: 40, y: 100, width: 240, height: 80 }, ports: [] },
    ], relations: [
      { id: 'overview', source: { nodeId: 'caller-view' }, target: { nodeId: 'engine-view' }, label: 'Request', relation: 'call', direction: 'directed', order: 1, sourceRelationIds: ['invoke'], visibility: { expanded: [], collapsed: ['engine-view'] } },
      { id: 'detail', source: { nodeId: 'caller-view' }, target: { nodeId: 'worker-view' }, label: 'execute', relation: 'call', direction: 'directed', order: 2, sourceRelationIds: ['invoke'], refines: 'overview', visibility: { expanded: ['engine-view'], collapsed: [] } },
    ],
  };
  const followView: ProjectViewDefinition = {
    ...structuredClone(baseView), id: 'main-M1', stageId: 'M1',
    nodes: [...structuredClone(baseView.nodes), { id: 'archive-view', componentId: 'archive', parentId: 'root', order: 3, frame: { x: 1100, y: 60, width: 240, height: 80 }, ports: [] }],
    relations: [...structuredClone(baseView.relations), { id: 'storage-view', source: { nodeId: 'worker-view' }, target: { nodeId: 'archive-view' }, label: 'write', relation: 'storage', direction: 'directed', order: 3, sourceRelationIds: ['write'], visibility: { expanded: [], collapsed: [] } }],
  };
  return { version: 1, id: 'project', title: 'Architecture', revision: '1', source: { stages: [initial, follow, branch] }, views: [baseView, followView, { ...structuredClone(baseView), id: 'main-alt', stageId: 'M1-alt' }] };
}

test('source deltas follow explicit predecessor branches and authored geometry stays in views', () => {
  const input = project(), original = JSON.stringify(input);
  const [base, next, branch] = adaptProject(input);
  assert.equal(JSON.stringify(input), original);
  assert.equal(base!.stage.graph.nodes.some((node) => node.id === 'unseen'), false);
  assert.equal(base!.stage.graph.nodes.find((node) => node.id === 'worker-view')?.parentId, 'engine-view');
  assert.deepEqual(base!.layout!.nodes['worker-view'], { position: { x: 40, y: 100 }, width: 240, height: 80 });
  assert.deepEqual(base!.layout!.nodes['engine-view']?.expandedSize, { width: 520, height: 240 });
  assert.deepEqual(base!.stage.graph.nodes.find((node) => node.id === 'worker-view')?.sourceRefs, ['report.md#worker']);
  assert.equal(next!.previousStageId, 'M0');
  assert.equal(branch!.previousStageId, 'M0');
  assert.equal(next!.nodeChanges['archive-view']?.kind, 'added');
  assert.equal(next!.nodeChanges['worker-view']?.kind, 'inherited');
  assert.equal(next!.edgeChanges['storage-view']?.kind, 'added');
  assert.equal(branch!.stage.graph.nodes.some((node) => node.id === 'archive-view'), false);
  assert.deepEqual(base!.stage.presentation?.relations.detail?.sourceRelationIds, ['invoke']);
  assert.equal(base!.stage.presentation?.relations.detail?.refines, 'overview');
});

test('overview and detail are exclusive across container expansion while preserving source identity', () => {
  const [base] = adaptProject(project());
  const folded = projectGraph(base!.stage, []), expanded = projectGraph(base!.stage, ['engine-view']);
  assert.deepEqual(folded.edges.map((edge) => edge.canonicalEdgeId), ['overview']);
  assert.deepEqual(expanded.edges.map((edge) => edge.canonicalEdgeId), ['detail']);
  assert.equal(expanded.edges[0]?.target.nodeId, 'worker-view');
  assert.deepEqual(base!.stage.presentation?.relations.overview?.sourceRelationIds, base!.stage.presentation?.relations.detail?.sourceRelationIds);
});

test('missing geometry, source facts and ambiguous overview details fail at the input boundary', () => {
  const missing = project();
  delete missing.views[0]!.nodes[1]!.expandedSize;
  assert.throws(() => adaptProject(missing), /authored expanded size/);
  const missingFrame = project();
  missingFrame.views[0]!.nodes[1]!.frame.width = 0;
  assert.throws(() => adaptProject(missingFrame), /authored frame/);
  const missingSource = project();
  missingSource.views[0]!.relations[0]!.sourceRelationIds = ['unknown'];
  assert.throws(() => adaptProject(missingSource), /unknown source relation/);
  const ambiguous = project();
  ambiguous.views[0]!.relations[1]!.visibility = { expanded: [], collapsed: [] };
  assert.throws(() => adaptProject(ambiguous), /exclusive visibility/);
  const differentFacts = project();
  differentFacts.source.stages[0]!.upsert.relations.push({ ...differentFacts.source.stages[0]!.upsert.relations[0]!, id: 'other' });
  differentFacts.views[0]!.relations[1]!.sourceRelationIds = ['other'];
  assert.throws(() => adaptProject(differentFacts), /different source relation/);
  const orphan = project();
  orphan.source.stages[1]!.previousId = 'missing';
  assert.throws(() => adaptProject(orphan), /unknown predecessor/);
  const wrongContract = project();
  wrongContract.source.stages[0]!.upsert.components[1]!.contractIds = ['unknown'];
  assert.throws(() => adaptProject(wrongContract), /unknown contract/);
});

test('source revision updates facts while view overrides remain presentation-only', () => {
  const input = project();
  input.source.stages[1]!.upsert.components.push({ id: 'engine', kind: 'group', label: 'Revised engine', contractIds: ['request'], sourceRefs: ['report.md#revision'] });
  input.views[1]!.nodes.find((node) => node.id === 'engine-view')!.label = 'Display name';
  const [first, second, alternative] = adaptProject(input);
  assert.equal(first!.stage.graph.nodes.find((node) => node.id === 'engine-view')!.label, 'Engine');
  assert.equal(second!.stage.graph.nodes.find((node) => node.id === 'engine-view')!.label, 'Display name');
  assert.equal(alternative!.stage.graph.nodes.find((node) => node.id === 'engine-view')!.label, 'Engine');
  assert.deepEqual(second!.stage.graph.nodes.find((node) => node.id === 'engine-view')!.sourceRefs, ['report.md#revision']);
});
