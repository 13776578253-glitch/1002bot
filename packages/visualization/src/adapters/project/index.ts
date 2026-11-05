/** Converts authored project facts and views into independent canvas baselines; stages accumulate by explicit previousId, with no IO or UI dependencies. */
import type { ArchitectureProject, ProjectComponent, ProjectContract, ProjectRelation, ProjectSourceStage, ProjectViewDefinition } from '../../core/project/types.ts';
import type { ChangeMark, VisualizationBaseline } from '../../core/schema/baseline.ts';
import type { CanonicalEdge, CanonicalGraph, CanonicalNode, StageSnapshot } from '../../core/schema/types.ts';
import { assertValidBaselines } from '../../core/schema/baseline.ts';
import { assertValidGraph } from '../../core/graph/validate.ts';

export type * from '../../core/project/types.ts';
export { resolveSourceStages } from '../../core/project/resolve.ts';

/** 单个阶段累积后的源事实；视图装配与后继阶段共用。 */
interface Facts {
  components: Map<string, ProjectComponent>;
  relations: Map<string, ProjectRelation>;
  contracts: Map<string, ProjectContract>;
}

function text(value: unknown, description: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${description} must be a non-empty string`);
}

function references(values: readonly string[], description: string): void {
  if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error(`${description} requires source references`);
  }
}

/** 只校验传入列表内唯一；不跨列表比较。 */
function uniqueIds<T extends { id: string }>(values: readonly T[], description: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    text(value.id, `${description} id`);
    if (ids.has(value.id)) throw new Error(`duplicate ${description} id "${value.id}"`);
    ids.add(value.id);
  }
}

/** 先删除再 upsert；同一 ID 不得同时出现在删除和更新列表。 */
function applyDelta<T extends { id: string }>(base: ReadonlyMap<string, T>, updates: readonly T[], removed: readonly string[], description: string): Map<string, T> {
  uniqueIds(updates, description);
  const next = new Map(base);
  const removals = new Set<string>();
  for (const id of removed) {
    text(id, `${description} removal`);
    if (removals.has(id)) throw new Error(`duplicate ${description} removal "${id}"`);
    if (!next.has(id)) throw new Error(`unknown ${description} removal "${id}"`);
    removals.add(id);
    next.delete(id);
  }
  for (const value of updates) {
    if (removals.has(value.id)) throw new Error(`${description} "${value.id}" is both removed and updated`);
    next.set(value.id, value);
  }
  return next;
}

/** 在前驱事实之上应用本阶段增量，并校验字段和引用完整性。 */
function stageFacts(stage: ProjectSourceStage, parent: Facts | undefined): Facts {
  const components = applyDelta(parent?.components ?? new Map(), stage.upsert.components, stage.remove.componentIds, 'component');
  const relations = applyDelta(parent?.relations ?? new Map(), stage.upsert.relations, stage.remove.relationIds, 'relation');
  const contracts = applyDelta(parent?.contracts ?? new Map(), stage.upsert.contracts, stage.remove.contractIds, 'contract');
  const contractRefs = (ids: readonly string[], owner: string) => {
    for (const id of ids) if (!contracts.has(id)) throw new Error(`${owner} references unknown contract "${id}"`);
  };
  for (const component of components.values()) {
    text(component.label, `component ${component.id} label`);
    references(component.sourceRefs, `component ${component.id}`);
    if (component.details !== undefined && (!Array.isArray(component.details) || component.details.some((item: unknown) => typeof item !== 'string'))) throw new Error(`component ${component.id} details must be strings`);
    contractRefs(component.contractIds, `component ${component.id}`);
  }
  for (const contract of contracts.values()) {
    text(contract.label, `contract ${contract.id} label`);
    references(contract.sourceRefs, `contract ${contract.id}`);
  }
  for (const relation of relations.values()) {
    references(relation.sourceRefs, `relation ${relation.id}`);
    contractRefs(relation.contractIds, `relation ${relation.id}`);
    for (const endpoint of [relation.source, relation.target]) {
      if (!components.has(endpoint.nodeId)) throw new Error(`relation ${relation.id} references unknown component "${endpoint.nodeId}"`);
    }
  }
  return { components, relations, contracts };
}

function mark(ids: readonly string[], inherited: (id: string) => boolean, initial: boolean): Record<string, ChangeMark> {
  return Object.fromEntries(ids.map((id): [string, ChangeMark] => [id, initial
    ? { kind: 'baseline', label: '基线' }
    : inherited(id) ? { kind: 'inherited', label: '沿用' } : { kind: 'added', label: '新增' }]));
}

/** 装配单个阶段/视图基线；视图几何、关系可见性与替换标记在这里一次性确定。 */
function makeBaseline(project: ArchitectureProject, stage: ProjectSourceStage, index: number, view: ProjectViewDefinition, facts: Facts, parent: Facts | undefined): VisualizationBaseline {
  text(view.id, 'view id');
  text(view.rootId, `view ${view.id} root id`);
  uniqueIds(view.nodes, 'view node');
  uniqueIds(view.relations, 'view relation');
  const nodeViews = new Map(view.nodes.map((node) => [node.id, node]));
  const relationViews = new Map(view.relations.map((relation) => [relation.id, relation]));
  const expandable = new Set([
    ...view.nodes.map((node) => node.parentId).filter((id) => id !== view.rootId),
    ...view.nodes.filter((node) => (node.details ?? facts.components.get(node.componentId)?.details)?.length).map((node) => node.id),
  ]);
  const root: CanonicalNode = { id: view.rootId, parentId: null, kind: 'root', label: project.title, order: 0, ports: [] };
  const nodes: CanonicalNode[] = [root, ...view.nodes.map((node) => {
    const component = facts.components.get(node.componentId);
    if (!component) throw new Error(`view node ${node.id} references unknown component "${node.componentId}"`);
    if (node.details !== undefined && (!Array.isArray(node.details) || node.details.some((item: unknown) => typeof item !== 'string'))) throw new Error(`view node ${node.id} details must be strings`);
    if (!node.frame || ![node.frame.x, node.frame.y, node.frame.width, node.frame.height].every(Number.isFinite) || node.frame.width <= 0 || node.frame.height <= 0) throw new Error(`view node ${node.id} requires a finite positive authored frame`);
    if (expandable.has(node.id) && (!node.expandedSize || ![node.expandedSize.width, node.expandedSize.height].every(Number.isFinite) || node.expandedSize.width <= 0 || node.expandedSize.height <= 0)) throw new Error(`view container ${node.id} requires an authored expanded size`);
    if (node.expandedSize && (![node.expandedSize.width, node.expandedSize.height].every(Number.isFinite) || node.expandedSize.width <= 0 || node.expandedSize.height <= 0)) throw new Error(`view node ${node.id} has an invalid expanded size`);
    return {
      id: node.id, parentId: node.parentId, kind: component.kind,
      label: node.label ?? component.label, ...(node.summary ?? component.summary ? { summary: node.summary ?? component.summary! } : {}),
      order: node.order, ports: node.ports.map((port) => ({ ...port })), sourceRefs: [...component.sourceRefs],
      ...((node.details ?? component.details) ? { details: [...(node.details ?? component.details)!] } : {}),
    };
  })];
  // 视图关系在这里一次性校验 refines 链、可见性互斥和来源事实。
  for (const relation of view.relations) {
    if (!relation.sourceRelationIds.length) throw new Error(`view relation ${relation.id} requires source relation IDs`);
    for (const id of relation.sourceRelationIds) if (!facts.relations.has(id)) throw new Error(`view relation ${relation.id} references unknown source relation "${id}"`);
    if (new Set(relation.sourceRelationIds).size !== relation.sourceRelationIds.length) throw new Error(`view relation ${relation.id} repeats a source relation`);
    for (const id of [...relation.visibility.expanded, ...relation.visibility.collapsed]) {
      if (!nodeViews.has(id) || !expandable.has(id)) throw new Error(`view relation ${relation.id} references non-container visibility node "${id}"`);
    }
    if (relation.visibility.expanded.some((id) => relation.visibility.collapsed.includes(id))) throw new Error(`view relation ${relation.id} has incompatible visibility`);
    if (relation.refines) {
      const overview = relationViews.get(relation.refines);
      if (!overview) throw new Error(`view relation ${relation.id} refines unknown relation "${relation.refines}"`);
      if (relation.sourceRelationIds.some((id) => !overview.sourceRelationIds.includes(id))) throw new Error(`view relation ${relation.id} refines a different source relation`);
      const exclusive = relation.visibility.expanded.some((id) => overview.visibility.collapsed.includes(id)) || relation.visibility.collapsed.some((id) => overview.visibility.expanded.includes(id));
      if (!exclusive) throw new Error(`view relation ${relation.id} and its overview must have exclusive visibility`);
    }
    const visited = new Set([relation.id]);
    let previous = relation.refines;
    while (previous) {
      if (visited.has(previous)) throw new Error(`view relation refinement cycle includes "${previous}"`);
      visited.add(previous);
      previous = relationViews.get(previous)?.refines;
    }
  }
  const edges: CanonicalEdge[] = view.relations.map((relation) => ({
    id: relation.id, source: { ...relation.source }, target: { ...relation.target }, label: relation.label,
    relation: relation.relation, direction: relation.direction, order: relation.order,
    ...(relation.semantics ? { semantics: relation.semantics } : {}),
  }));
  const graph: CanonicalGraph = { rootId: view.rootId, nodes, edges, revision: `${project.revision}:${stage.id}:${view.id}` };
  assertValidGraph(graph);
  const { id: _id, label: _label, title: _title, previousId: _previousId, upsert: _upsert, remove: _remove, ...meta } = stage;
  const presentation = { ...(view.portPolicy ? { portPolicy: view.portPolicy } : {}), relations: Object.fromEntries(view.relations.map((relation) => [relation.id, {
    expanded: [...relation.visibility.expanded], collapsed: [...relation.visibility.collapsed], sourceRelationIds: [...relation.sourceRelationIds],
    ...(relation.refines ? { refines: relation.refines } : {}),
  }])) };
  const snapshot: StageSnapshot = { ...meta, id: stage.id, label: stage.label, title: stage.title, track: 'main', order: index, graph, presentation };
  const layout = { kind: 'manual' as const, nodes: Object.fromEntries(view.nodes.map((node) => [node.id, {
    position: { x: node.frame.x, y: node.frame.y }, width: node.frame.width, height: node.frame.height,
    ...(node.expandedSize ? { expandedSize: { ...node.expandedSize } } : {}),
    ...(node.initiallyExpanded === undefined ? {} : { initiallyExpanded: node.initiallyExpanded }),
  }])) };
  // 节点是否沿用按 componentId 判断，不按视图节点 ID。
  const nodeChanges = mark(view.nodes.map((node) => node.id), (id) => parent?.components.has(nodeViews.get(id)!.componentId) ?? false, !parent);
  // 替换标记在上一视图中查找 componentId 等于当前 previousId 的节点，供增量布局继承坐标。
  const previousView = project.views.find((item) => item.stageId === stage.previousId);
  for (const node of view.nodes) {
    const component = facts.components.get(node.componentId)!;
    if (!component.previousId || !parent?.components.has(component.previousId)) continue;
    const previous = previousView?.nodes.find((item) => item.componentId === component.previousId);
    if (previous) nodeChanges[node.id] = { kind: 'replaced', label: '替换', previousId: previous.id };
  }
  const priorRelations = new Map(previousView?.relations.map((relation) => [relation.id, relation]));
  const edgeChanges = mark(view.relations.map((relation) => relation.id), (id) => {
    const current = relationViews.get(id)!, previous = priorRelations.get(id);
    return Boolean(previous?.sourceRelationIds.every((sourceId) => current.sourceRelationIds.includes(sourceId))) || current.sourceRelationIds.every((sourceId) => parent?.relations.has(sourceId));
  }, !parent);
  return {
    id: stage.id, stage: snapshot, ...(stage.previousId ? { previousStageId: stage.previousId } : {}),
    positions: Object.fromEntries(view.nodes.map((node) => [node.id, { x: node.frame.x, y: node.frame.y }])),
    layout, nodeChanges, edgeChanges,
  };
}

/** Stages inherit only their explicit predecessor; view geometry is never inferred. */
export function adaptProject(project: ArchitectureProject): VisualizationBaseline[] {
  if (project.version !== 1) throw new Error('unsupported project version');
  text(project.id, 'project id'); text(project.title, 'project title'); text(project.revision, 'project revision');
  uniqueIds(project.source.stages, 'stage'); uniqueIds(project.views, 'view');
  const stages = new Map(project.source.stages.map((stage) => [stage.id, stage]));
  const views = new Map<string, ProjectViewDefinition>();
  for (const view of project.views) {
    if (!stages.has(view.stageId)) throw new Error(`view ${view.id} references unknown stage "${view.stageId}"`);
    if (views.has(view.stageId)) throw new Error(`stage ${view.stageId} has multiple views`);
    views.set(view.stageId, view);
  }
  const facts = new Map<string, Facts>(), visiting = new Set<string>();
  // 前驱事实按需递归解析；缓存复用结果，visiting 集合负责发现环。
  const resolve = (stage: ProjectSourceStage): Facts => {
    const existing = facts.get(stage.id);
    if (existing) return existing;
    if (visiting.has(stage.id)) throw new Error(`stage predecessor cycle includes "${stage.id}"`);
    visiting.add(stage.id);
    let parent: Facts | undefined;
    if (stage.previousId) {
      const previous = stages.get(stage.previousId);
      if (!previous) throw new Error(`stage ${stage.id} references unknown predecessor "${stage.previousId}"`);
      parent = resolve(previous);
    }
    const result = stageFacts(stage, parent);
    visiting.delete(stage.id); facts.set(stage.id, result);
    return result;
  };
  const result = project.source.stages.map((stage, index) => {
    text(stage.label, `stage ${stage.id} label`); text(stage.title, `stage ${stage.id} title`);
    if (index > 0 && !stage.previousId) throw new Error(`stage ${stage.id} requires an explicit predecessor`);
    const view = views.get(stage.id);
    if (!view) throw new Error(`stage ${stage.id} requires an authored view`);
    const current = resolve(stage);
    const previous = stage.previousId ? facts.get(stage.previousId)! : undefined;
    return makeBaseline(project, stage, index, view, current, previous);
  });
  assertValidBaselines(result);
  return result;
}
