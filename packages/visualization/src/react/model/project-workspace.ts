/** Serializable project workspace with independent stage drafts and checkpoints. */
import type { UserGraphOverlay } from './overlay.ts';
import type { CanvasBaselineContent, CanvasBaselineView, CanvasViewMode, CanvasWorkspaceView } from './workspace.ts';

export interface ProjectOverrides {
  nodeTitles: Record<string, string>;
  graph?: UserGraphOverlay;
}

export type ProjectContainerStates = Record<string, { expanded: boolean }>;

/** The content owns the values; these indexes are derived for convenient inspection. */
export interface ProjectWorkspaceSnapshot {
  content: CanvasBaselineContent;
  overrides: ProjectOverrides;
  containerStates: ProjectContainerStates;
}

export interface ProjectWorkspaceCheckpoint extends ProjectWorkspaceSnapshot {
  id: string;
  createdAt: string;
}

export interface ProjectViewWorkspace {
  revision: string;
  overrides: ProjectOverrides;
  containerStates: ProjectContainerStates;
  draft: CanvasBaselineContent;
  confirmed?: ProjectWorkspaceSnapshot;
  confirmedAt?: string;
  confirmationId?: string;
  confirmedRevision?: string;
  requiresConfirmation?: boolean;
  checkpoints: ProjectWorkspaceCheckpoint[];
  viewport?: CanvasBaselineView['viewport'];
  transition?: CanvasBaselineView['transition'];
  inheritance?: CanvasBaselineView['inheritance'];
  sourceStage?: CanvasBaselineView['sourceStage'];
}

export interface ProjectStageWorkspace extends ProjectViewWorkspace {
  views?: Partial<Record<CanvasViewMode, ProjectViewWorkspace>>;
}

export interface ProjectWorkspace {
  version: 1;
  projectId: string;
  activeStageId: string;
  activeView?: CanvasViewMode;
  stages: Record<string, ProjectStageWorkspace>;
}

export function projectSnapshot(content: CanvasBaselineContent): ProjectWorkspaceSnapshot {
  const copy = structuredClone(content);
  const parentIds = new Set(copy.nodes.flatMap((node) => node.parentId ? [node.parentId] : []));
  const nodeTitles = Object.fromEntries(copy.nodes.flatMap((node) =>
    node.type !== 'cluster' && node.data.title !== undefined ? [[node.id, node.data.title]] : [],
  ));
  const containerStates = Object.fromEntries(copy.nodes.flatMap((node) =>
    parentIds.has(node.id) || node.type === 'structure' || node.type === 'cluster' || node.data.expansionSizes
      ? [[node.id, { expanded: !!node.data.expanded }]] : [],
  ));
  return {
    content: copy,
    overrides: { nodeTitles, ...(copy.overlay ? { graph: structuredClone(copy.overlay) } : {}) },
    containerStates,
  };
}

function canvasContent(stage: CanvasBaselineView): CanvasBaselineContent {
  return {
    nodes: stage.nodes, edgeRoutes: stage.edgeRoutes, frozenGroups: stage.frozenGroups,
    ...(stage.overlay ? { overlay: stage.overlay } : {}),
    ...(stage.displayRoutes ? { displayRoutes: stage.displayRoutes } : {}),
  };
}

function projectView(stage: CanvasBaselineView, previous?: ProjectViewWorkspace): ProjectViewWorkspace {
    const draft = projectSnapshot(canvasContent(stage));
    const confirmed = stage.confirmed ? projectSnapshot(stage.confirmed) : undefined;
    const checkpoints = structuredClone(previous?.checkpoints ?? []);
    return {
      revision: stage.revision, overrides: draft.overrides, containerStates: draft.containerStates, draft: draft.content,
      ...(confirmed ? { confirmed } : {}),
      ...(stage.confirmedAt ? { confirmedAt: stage.confirmedAt } : {}),
      ...(stage.confirmationId ? { confirmationId: stage.confirmationId } : {}),
      ...(stage.confirmedRevision ? { confirmedRevision: stage.confirmedRevision } : {}),
      ...(stage.requiresConfirmation !== undefined ? { requiresConfirmation: stage.requiresConfirmation } : {}),
      checkpoints,
      ...(stage.viewport ? { viewport: structuredClone(stage.viewport) } : {}),
      ...(stage.transition ? { transition: structuredClone(stage.transition) } : {}),
      ...(stage.inheritance ? { inheritance: structuredClone(stage.inheritance) } : {}),
      ...(stage.sourceStage ? { sourceStage: structuredClone(stage.sourceStage) } : {}),
    };
}

function canvasView(stage: ProjectViewWorkspace): CanvasBaselineView {
    return {
      revision: stage.revision,
      ...structuredClone(stage.draft),
      ...(stage.confirmed ? { confirmed: structuredClone(stage.confirmed.content) } : {}),
      ...(stage.confirmedAt ? { confirmedAt: stage.confirmedAt } : {}),
      ...(stage.confirmationId ? { confirmationId: stage.confirmationId } : {}),
      ...(stage.confirmedRevision ? { confirmedRevision: stage.confirmedRevision } : {}),
      ...(stage.requiresConfirmation !== undefined ? { requiresConfirmation: stage.requiresConfirmation } : {}),
      ...(stage.viewport ? { viewport: structuredClone(stage.viewport) } : {}),
      ...(stage.transition ? { transition: structuredClone(stage.transition) } : {}),
      ...(stage.inheritance ? { inheritance: structuredClone(stage.inheritance) } : {}),
      ...(stage.sourceStage ? { sourceStage: structuredClone(stage.sourceStage) } : {}),
    };
}

/** Preserve each view's unvisited stages and independent checkpoint history. */
export function canvasWorkspaceToProject(view: CanvasWorkspaceView, projectId: string, previous?: ProjectWorkspace): ProjectWorkspace {
  if (previous && previous.projectId !== projectId) throw new Error('工作空间所属项目不匹配');
  const activeView = view.viewMode ?? 'structure';
  const inputViews: NonNullable<CanvasWorkspaceView['views']> = view.views ?? { structure: view.baselines };
  const stages: Record<string, ProjectStageWorkspace> = structuredClone(previous?.stages ?? {});
  for (const [id, stage] of Object.entries(stages)) {
    if (!stage.views) {
      const { views: _views, ...legacy } = stage;
      stages[id] = { ...stage, views: { structure: legacy } };
    }
  }
  for (const mode of ['overview', 'structure', 'full'] as const) {
    for (const [id, baseline] of Object.entries(inputViews[mode] ?? {})) {
      const old = stages[id];
      const views = { ...old?.views, [mode]: projectView(baseline, old?.views?.[mode]) };
      const alias = views[activeView] ?? views.structure ?? views.overview ?? views.full!;
      stages[id] = { ...alias, views };
    }
  }
  for (const [id, stage] of Object.entries(stages)) {
    const current = stage.views?.[activeView];
    if (current) stages[id] = { ...current, views: stage.views! };
  }
  return { version: 1, projectId, activeStageId: view.baselineId, activeView, stages };
}

export function projectWorkspaceToCanvas(workspace: ProjectWorkspace): CanvasWorkspaceView {
  const viewMode = workspace.activeView ?? 'structure';
  const views: NonNullable<CanvasWorkspaceView['views']> = {};
  for (const [id, stage] of Object.entries(workspace.stages)) {
    const stageViews = stage.views ?? { structure: stage };
    for (const mode of ['overview', 'structure', 'full'] as const) {
      const saved = stageViews[mode];
      if (saved) (views[mode] ??= {})[id] = canvasView(saved);
    }
  }
  views[viewMode] ??= {};
  return { version: 2, baselineId: workspace.activeStageId, viewMode, baselines: structuredClone(views[viewMode]), views };
}
