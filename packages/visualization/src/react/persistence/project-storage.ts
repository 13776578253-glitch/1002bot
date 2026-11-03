/** Project-scoped browser storage bridge for the existing canvas session. */
import type { CanvasBaselineContent, CanvasBaselineView, CanvasViewStorage, CanvasWorkspaceView } from '../model/workspace.ts';
import {
  canvasWorkspaceToProject, projectSnapshot, projectWorkspaceToCanvas,
  type ProjectStageWorkspace, type ProjectWorkspace, type ProjectWorkspaceCheckpoint,
} from '../model/project-workspace.ts';
import { normalizeWorkspaceView } from './local-storage.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

function normalizeContent(value: unknown): CanvasBaselineContent {
  const normalized = normalizeWorkspaceView({ version: 2, baselineId: 'content', baselines: { content: { ...(record(value) ? value : {}), revision: 'content' } } });
  const item = normalized.baselines.content!;
  return { nodes: item.nodes, edgeRoutes: item.edgeRoutes, frozenGroups: item.frozenGroups,
    ...(item.overlay ? { overlay: item.overlay } : {}), ...(item.displayRoutes ? { displayRoutes: item.displayRoutes } : {}) };
}

function normalizeSnapshot(value: unknown) {
  if (!record(value)) throw new Error('项目快照格式不正确');
  const snapshot = projectSnapshot(normalizeContent(value.content));
  if (!equal(value.overrides, snapshot.overrides) || !equal(value.containerStates, snapshot.containerStates)) throw new Error('项目快照索引与内容不一致');
  return snapshot;
}

/** Validate externally supplied project data without altering the stored value. */
export function normalizeProjectWorkspace(value: unknown, projectId: string): ProjectWorkspace {
  if (!record(value) || value.version !== 1 || !text(value.projectId) || !text(value.activeStageId) || !record(value.stages)) throw new Error('项目工作空间格式不正确');
  if (value.projectId !== projectId) throw new Error('工作空间所属项目不匹配');
  const stages: Record<string, ProjectStageWorkspace> = {};
  for (const [id, raw] of Object.entries(value.stages)) {
    if (!text(id) || !record(raw) || !text(raw.revision) || !Array.isArray(raw.checkpoints)) throw new Error('项目阶段工作空间格式不正确');
    const draft = normalizeSnapshot({ content: raw.draft, overrides: raw.overrides, containerStates: raw.containerStates });
    const confirmed = raw.confirmed === undefined ? undefined : normalizeSnapshot(raw.confirmed);
    if (raw.confirmedAt !== undefined && !text(raw.confirmedAt)) throw new Error('阶段确认时间格式不正确');
    if (raw.confirmationId !== undefined && (!text(raw.confirmationId) || !confirmed || !text(raw.confirmedAt))) throw new Error('阶段确认标识格式不正确');
    const ids = new Set<string>();
    const checkpoints: ProjectWorkspaceCheckpoint[] = raw.checkpoints.map((entry) => {
      if (!record(entry) || !text(entry.id) || !text(entry.createdAt) || ids.has(entry.id)) throw new Error('项目检查点格式不正确');
      ids.add(entry.id);
      return { id: entry.id, createdAt: entry.createdAt, ...normalizeSnapshot(entry) };
    });
    const candidate = {
      revision: raw.revision, ...draft.content,
      ...(confirmed ? { confirmed: confirmed.content } : {}),
      ...(raw.confirmedAt ? { confirmedAt: raw.confirmedAt } : {}),
      ...(raw.confirmedRevision !== undefined ? { confirmedRevision: raw.confirmedRevision } : {}),
      ...(raw.viewport !== undefined ? { viewport: raw.viewport } : {}),
      ...(raw.transition !== undefined ? { transition: raw.transition } : {}),
      ...(raw.inheritance !== undefined ? { inheritance: raw.inheritance } : {}),
      ...(raw.sourceStage !== undefined ? { sourceStage: raw.sourceStage } : {}),
    };
    const checked: CanvasBaselineView = normalizeWorkspaceView({ version: 2, baselineId: id, baselines: { [id]: candidate } }).baselines[id]!;
    const matched = checkpoints.find((item) => item.id === raw.confirmationId);
    if (text(raw.confirmationId) && !matched) throw new Error('阶段确认快照缺少对应检查点');
    if (matched && (!confirmed || !equal(matched.content, confirmed.content) || matched.createdAt !== raw.confirmedAt)) throw new Error('阶段确认快照与检查点不一致');
    stages[id] = {
      revision: checked.revision, draft: draft.content, overrides: draft.overrides, containerStates: draft.containerStates,
      ...(confirmed ? { confirmed } : {}),
      ...(checked.confirmedAt ? { confirmedAt: checked.confirmedAt } : {}),
      ...(text(raw.confirmationId) ? { confirmationId: raw.confirmationId } : {}),
      ...(checked.confirmedRevision ? { confirmedRevision: checked.confirmedRevision } : {}),
      checkpoints,
      ...(checked.viewport ? { viewport: checked.viewport } : {}),
      ...(checked.transition ? { transition: checked.transition } : {}),
      ...(checked.inheritance ? { inheritance: checked.inheritance } : {}),
      ...(checked.sourceStage ? { sourceStage: checked.sourceStage } : {}),
    };
  }
  return { version: 1, projectId, activeStageId: value.activeStageId, stages };
}

export function createProjectViewStorage(storage: Pick<Storage, 'getItem' | 'setItem'>, projectId: string): CanvasViewStorage {
  const read = (key: string): ProjectWorkspace | undefined => {
    const value = storage.getItem(key);
    return value === null ? undefined : normalizeProjectWorkspace(JSON.parse(value) as unknown, projectId);
  };
  return {
    load(key) { const workspace = read(key); return workspace ? projectWorkspaceToCanvas(workspace) : undefined; },
    save(key, view: CanvasWorkspaceView) {
      const previous = read(key);
      const workspace = canvasWorkspaceToProject(view, projectId, previous);
      // Validate the complete output before replacing the prior record.
      normalizeProjectWorkspace(workspace, projectId);
      const original = storage.getItem(key);
      const backupKey = `${key}:before-layout-intent-v1`;
      if (original !== null && storage.getItem(backupKey) === null && Object.values(view.baselines).some((stage) => stage.nodes.some((node) => node.data.layoutEdits))) storage.setItem(backupKey, original);
      storage.setItem(key, JSON.stringify(workspace));
    },
  };
}
