/** Serializable project workspace with independent stage drafts and checkpoints. */
import type { UserGraphOverlay } from './overlay.ts';
import type { CanvasBaselineContent, CanvasBaselineView, CanvasWorkspaceView } from './workspace.ts';

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

export interface ProjectStageWorkspace {
  revision: string;
  overrides: ProjectOverrides;
  containerStates: ProjectContainerStates;
  draft: CanvasBaselineContent;
  confirmed?: ProjectWorkspaceSnapshot;
  confirmedAt?: string;
  confirmationId?: string;
  confirmedRevision?: string;
  checkpoints: ProjectWorkspaceCheckpoint[];
  viewport?: CanvasBaselineView['viewport'];
  transition?: CanvasBaselineView['transition'];
  inheritance?: CanvasBaselineView['inheritance'];
  sourceStage?: CanvasBaselineView['sourceStage'];
}

export interface ProjectWorkspace {
  version: 1;
  projectId: string;
  activeStageId: string;
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

/** Preserve unvisited stages and checkpoint history across ordinary canvas saves. */
export function canvasWorkspaceToProject(view: CanvasWorkspaceView, projectId: string, previous?: ProjectWorkspace): ProjectWorkspace {
  if (previous && previous.projectId !== projectId) throw new Error('工作空间所属项目不匹配');
  const stages: Record<string, ProjectStageWorkspace> = structuredClone(previous?.stages ?? {});
  for (const [id, stage] of Object.entries(view.baselines)) {
    const draft = projectSnapshot(canvasContent(stage));
    const confirmed = stage.confirmed ? projectSnapshot(stage.confirmed) : undefined;
    const checkpoints = stages[id]?.checkpoints ?? [];
    if (confirmed && stage.confirmationId && stage.confirmedAt && !checkpoints.some((item) => item.id === stage.confirmationId)) {
      checkpoints.push({ id: stage.confirmationId, createdAt: stage.confirmedAt, ...structuredClone(confirmed) });
    }
    stages[id] = {
      revision: stage.revision, overrides: draft.overrides, containerStates: draft.containerStates, draft: draft.content,
      ...(confirmed ? { confirmed } : {}),
      ...(stage.confirmedAt ? { confirmedAt: stage.confirmedAt } : {}),
      ...(stage.confirmationId ? { confirmationId: stage.confirmationId } : {}),
      ...(stage.confirmedRevision ? { confirmedRevision: stage.confirmedRevision } : {}),
      checkpoints,
      ...(stage.viewport ? { viewport: structuredClone(stage.viewport) } : {}),
      ...(stage.transition ? { transition: structuredClone(stage.transition) } : {}),
      ...(stage.inheritance ? { inheritance: structuredClone(stage.inheritance) } : {}),
      ...(stage.sourceStage ? { sourceStage: structuredClone(stage.sourceStage) } : {}),
    };
  }
  return { version: 1, projectId, activeStageId: view.baselineId, stages };
}

export function projectWorkspaceToCanvas(workspace: ProjectWorkspace): CanvasWorkspaceView {
  return {
    version: 2,
    baselineId: workspace.activeStageId,
    baselines: Object.fromEntries(Object.entries(workspace.stages).map(([id, stage]) => [id, {
      revision: stage.revision,
      ...structuredClone(stage.draft),
      ...(stage.confirmed ? { confirmed: structuredClone(stage.confirmed.content) } : {}),
      ...(stage.confirmedAt ? { confirmedAt: stage.confirmedAt } : {}),
      ...(stage.confirmationId ? { confirmationId: stage.confirmationId } : {}),
      ...(stage.confirmedRevision ? { confirmedRevision: stage.confirmedRevision } : {}),
      ...(stage.viewport ? { viewport: structuredClone(stage.viewport) } : {}),
      ...(stage.transition ? { transition: structuredClone(stage.transition) } : {}),
      ...(stage.inheritance ? { inheritance: structuredClone(stage.inheritance) } : {}),
      ...(stage.sourceStage ? { sourceStage: structuredClone(stage.sourceStage) } : {}),
    }])),
  };
}
