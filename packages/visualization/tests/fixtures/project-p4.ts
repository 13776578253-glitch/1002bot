import type {
  ArchitectureProject, ProjectComponent, ProjectRelation, ProjectSourceStage, ProjectViewDefinition, ProjectViewNode,
} from '../../src/adapters/project/index.ts';

const refs = ['fixture#p4'];
const component = (id: string, kind: ProjectComponent['kind'], label: string): ProjectComponent => ({ id, kind, label, contractIds: [], sourceRefs: refs });
const relation = (id: string, source: string, target: string, label: string, order: number): ProjectRelation => ({
  id, source: { nodeId: source }, target: { nodeId: target }, label, relation: 'call', direction: 'directed', order,
  contractIds: [], sourceRefs: refs,
});
const empty = () => ({ components: [], relations: [], contracts: [] });
const remove = () => ({ componentIds: [], relationIds: [], contractIds: [] });
const node = (id: string, componentId: string, parentId: string, order: number, frame: { x: number; y: number; width: number; height: number }, expandedSize?: { width: number; height: number }): ProjectViewNode => ({
  id, componentId, parentId, order, frame, ports: [],
  ...(expandedSize ? { expandedSize, initiallyExpanded: true } : {}),
});

const baseNodes = [
  node('actor-view', 'actor', 'p4-root', 0, { x: 0, y: 0, width: 240, height: 80 }),
  node('engine-view', 'engine', 'p4-root', 1, { x: 400, y: 0, width: 520, height: 300 }, { width: 900, height: 560 }),
  node('inner-view', 'inner', 'engine-view', 2, { x: 40, y: 80, width: 420, height: 240 }, { width: 760, height: 420 }),
  node('worker-view', 'worker', 'inner-view', 3, { x: 30, y: 80, width: 220, height: 80 }),
  node('store-view', 'store', 'p4-root', 4, { x: 1500, y: 0, width: 220, height: 80 }),
];
const baseRelations = [
  { id: 'invoke-view', source: { nodeId: 'actor-view' }, target: { nodeId: 'engine-view' }, label: 'invoke', relation: 'call' as const, direction: 'directed' as const, order: 0, sourceRelationIds: ['invoke'], visibility: { expanded: [], collapsed: [] } },
  { id: 'execute-view', source: { nodeId: 'inner-view' }, target: { nodeId: 'worker-view' }, label: 'execute', relation: 'call' as const, direction: 'directed' as const, order: 1, sourceRelationIds: ['execute'], visibility: { expanded: [], collapsed: [] } },
  { id: 'persist-view', source: { nodeId: 'engine-view' }, target: { nodeId: 'store-view' }, label: 'persist', relation: 'storage' as const, direction: 'directed' as const, order: 2, sourceRelationIds: ['persist'], visibility: { expanded: [], collapsed: [] } },
];

const view = (id: string, stageId: string, nodes: ProjectViewNode[], relations: ProjectViewDefinition['relations']): ProjectViewDefinition => ({
  id, stageId, rootId: 'p4-root', portPolicy: { direction: 'top-down' }, nodes, relations,
});

const s0: ProjectSourceStage = {
  id: 's0', label: 'S0', title: 'Base', upsert: {
    ...empty(),
    components: [
      component('actor', 'actor', 'Actor'),
      component('engine', 'group', 'Engine'),
      component('inner', 'group', 'Inner'),
      component('worker', 'component', 'Worker'),
      component('store', 'store', 'Store'),
    ],
    relations: [relation('invoke', 'actor', 'engine', 'invoke', 0), relation('execute', 'inner', 'worker', 'execute', 1), relation('persist', 'engine', 'store', 'persist', 2)],
  },
  remove: remove(),
};
const s1: ProjectSourceStage = {
  id: 's1', previousId: 's0', label: 'S1', title: 'Archive', upsert: {
    ...empty(),
    components: [component('archive', 'store', 'Archive')],
    relations: [relation('write', 'engine', 'archive', 'write', 3)],
  },
  remove: remove(),
};
const s2: ProjectSourceStage = {
  id: 's2', previousId: 's1', label: 'S2', title: 'Cache', upsert: {
    ...empty(),
    components: [component('cache', 'store', 'Cache')],
    relations: [relation('read', 'archive', 'cache', 'read', 4)],
  },
  remove: remove(),
};

const s1Nodes = [...baseNodes, node('archive-view', 'archive', 'p4-root', 5, { x: 1500, y: 200, width: 220, height: 80 })];
const s2Nodes = [...s1Nodes, node('cache-view', 'cache', 'p4-root', 6, { x: 1500, y: 400, width: 220, height: 80 })];

export const p4Project: ArchitectureProject = {
  version: 1,
  id: 'p4',
  title: 'P4 Fixture',
  revision: 'p4-v1',
  source: { stages: [s0, s1, s2] },
  views: [
    view('base', 's0', baseNodes, baseRelations),
    view('archive', 's1', s1Nodes, [...baseRelations, { id: 'write-view', source: { nodeId: 'engine-view' }, target: { nodeId: 'archive-view' }, label: 'write', relation: 'storage', direction: 'directed', order: 3, sourceRelationIds: ['write'], visibility: { expanded: [], collapsed: [] } }]),
    view('cache', 's2', s2Nodes, [...baseRelations, { id: 'write-view', source: { nodeId: 'engine-view' }, target: { nodeId: 'archive-view' }, label: 'write', relation: 'storage', direction: 'directed', order: 3, sourceRelationIds: ['write'], visibility: { expanded: [], collapsed: [] } }, { id: 'read-view', source: { nodeId: 'archive-view' }, target: { nodeId: 'cache-view' }, label: 'read', relation: 'storage', direction: 'directed', order: 4, sourceRelationIds: ['read'], visibility: { expanded: [], collapsed: [] } }]),
  ],
};
