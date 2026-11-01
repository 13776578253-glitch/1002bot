/** Resolves stage id selections against source catalogs; no IO and no display semantics. */
import type {
  ProjectComponent,
  ProjectContract,
  ProjectRelation,
  ProjectSourceCatalog,
  ProjectSourceStage,
  ProjectStageSelection,
} from './types.ts';

function indexById<T extends { id: string }>(items: readonly T[], kind: string): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) {
    if (index.has(item.id)) throw new Error(`${kind} "${item.id}" is duplicated in the source catalog`);
    index.set(item.id, item);
  }
  return index;
}

function merge<T extends { id: string }>(target: Map<string, T>, source: Map<string, T>, kind: string): void {
  for (const [id, item] of source) {
    if (target.has(id)) throw new Error(`${kind} "${id}" is duplicated across source catalogs`);
    target.set(id, item);
  }
}

function unique(ids: readonly string[], kind: string, stageId: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`stage ${stageId}: ${kind} "${id}" is selected twice`);
    seen.add(id);
  }
}

function disjoint(selected: readonly string[], removed: readonly string[], kind: string, stageId: string): void {
  const chosen = new Set(selected);
  for (const id of removed) if (chosen.has(id)) throw new Error(`stage ${stageId}: ${kind} "${id}" is both selected and removed`);
}

function pick<T>(index: Map<string, T>, ids: readonly string[], kind: string, stageId: string): T[] {
  return ids.map((id) => {
    const item = index.get(id);
    if (!item) throw new Error(`stage ${stageId}: unknown ${kind} "${id}"`);
    return item;
  });
}

export function resolveSourceStages(
  catalogs: readonly ProjectSourceCatalog[],
  stages: readonly ProjectStageSelection[],
): ProjectSourceStage[] {
  if (!stages.length) throw new Error('project has no stages');
  const components = new Map<string, ProjectComponent>();
  const relations = new Map<string, ProjectRelation>();
  const contracts = new Map<string, ProjectContract>();
  for (const catalog of catalogs) {
    if (catalog.version !== 1) throw new Error(`unsupported source catalog version ${catalog.version}`);
    merge(components, indexById(catalog.components, 'component'), 'component');
    merge(relations, indexById(catalog.relations, 'relation'), 'relation');
    merge(contracts, indexById(catalog.contracts, 'contract'), 'contract');
  }
  return stages.map((stage, position) => {
    const previous = stages[position - 1];
    if (position === 0 && stage.previousId !== undefined) throw new Error(`first stage ${stage.id} must not declare previousId`);
    if (previous && stage.previousId !== previous.id) throw new Error(`stage ${stage.id} must declare previousId "${previous.id}"`);
    unique(stage.select.componentIds, 'component', stage.id);
    unique(stage.select.relationIds, 'relation', stage.id);
    unique(stage.select.contractIds, 'contract', stage.id);
    unique(stage.remove.componentIds, 'component', stage.id);
    unique(stage.remove.relationIds, 'relation', stage.id);
    unique(stage.remove.contractIds, 'contract', stage.id);
    disjoint(stage.select.componentIds, stage.remove.componentIds, 'component', stage.id);
    disjoint(stage.select.relationIds, stage.remove.relationIds, 'relation', stage.id);
    disjoint(stage.select.contractIds, stage.remove.contractIds, 'contract', stage.id);
    return {
      id: stage.id,
      label: stage.label,
      title: stage.title,
      ...(stage.subtitle === undefined ? {} : { subtitle: stage.subtitle }),
      ...(stage.date === undefined ? {} : { date: stage.date }),
      ...(stage.status === undefined ? {} : { status: stage.status }),
      ...(stage.doc === undefined ? {} : { doc: stage.doc }),
      ...(stage.previousId === undefined ? {} : { previousId: stage.previousId }),
      upsert: {
        components: pick(components, stage.select.componentIds, 'component', stage.id),
        relations: pick(relations, stage.select.relationIds, 'relation', stage.id),
        contracts: pick(contracts, stage.select.contractIds, 'contract', stage.id),
      },
      remove: {
        componentIds: [...stage.remove.componentIds],
        relationIds: [...stage.remove.relationIds],
        contractIds: [...stage.remove.contractIds],
      },
    };
  });
}
