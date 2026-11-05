/** Project storage owns canvas/project conversion and one-time backups; schema normalization lives in workspace-schema.ts. */
import type { CanvasBaselineContent, CanvasBaselineView, CanvasViewMode, CanvasViewStorage, CanvasWorkspaceView } from '../model/workspace.ts';
import {
  canvasWorkspaceToProject, projectSnapshot, projectWorkspaceToCanvas,
  type ProjectStageWorkspace, type ProjectViewWorkspace, type ProjectWorkspace, type ProjectWorkspaceCheckpoint,
} from '../model/project-workspace.ts';
import { normalizeWorkspaceView } from './workspace-schema.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const viewModes = new Set<CanvasViewMode>(['overview', 'structure', 'full']);

/** 递归按键排序，供结构化比较使用。 */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

/** 复用工作区 v2 校验，把任意内容收窄为 CanvasBaselineContent。 */
function normalizeContent(value: unknown): CanvasBaselineContent {
  const normalized = normalizeWorkspaceView({ version: 2, baselineId: 'content', baselines: { content: { ...(record(value) ? value : {}), revision: 'content' } } });
  const item = normalized.baselines.content!;
  return { nodes: item.nodes, edgeRoutes: item.edgeRoutes, frozenGroups: item.frozenGroups,
    ...(item.overlay ? { overlay: item.overlay } : {}), ...(item.displayRoutes ? { displayRoutes: item.displayRoutes } : {}), ...(item.labelPins?.length ? { labelPins: item.labelPins } : {}) };
}

/** 内容与派生索引必须一致，避免读取时重建出不同视图。 */
function normalizeSnapshot(value: unknown) {
  if (!record(value)) throw new Error('项目快照格式不正确');
  const snapshot = projectSnapshot(normalizeContent(value.content));
  if (!equal(value.overrides, snapshot.overrides) || !equal(value.containerStates, snapshot.containerStates)) throw new Error('项目快照索引与内容不一致');
  return snapshot;
}

/** 校验单个阶段的草稿、确认、检查点与视图元数据。 */
function normalizeProjectView(id: string, raw: unknown): ProjectViewWorkspace {
    if (!text(id) || !record(raw) || !text(raw.revision) || !Array.isArray(raw.checkpoints)) throw new Error('项目阶段工作空间格式不正确');
    // 草稿与确认都先按内容校验；确认字段缺失时保持未确认。
    const draft = normalizeSnapshot({ content: raw.draft, overrides: raw.overrides, containerStates: raw.containerStates });
    const confirmed = raw.confirmed === undefined ? undefined : normalizeSnapshot(raw.confirmed);
    if (raw.confirmedAt !== undefined && !text(raw.confirmedAt)) throw new Error('阶段确认时间格式不正确');
    if (raw.confirmationId !== undefined && (!text(raw.confirmationId) || !confirmed || !text(raw.confirmedAt))) throw new Error('阶段确认标识格式不正确');
    // 检查点 ID 必须唯一；重复直接失败。
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
      ...(raw.requiresConfirmation !== undefined ? { requiresConfirmation: raw.requiresConfirmation } : {}),
      ...(raw.viewport !== undefined ? { viewport: raw.viewport } : {}),
      ...(raw.transition !== undefined ? { transition: raw.transition } : {}),
      ...(raw.inheritance !== undefined ? { inheritance: raw.inheritance } : {}),
      ...(raw.sourceStage !== undefined ? { sourceStage: raw.sourceStage } : {}),
    };
    const checked: CanvasBaselineView = normalizeWorkspaceView({ version: 2, baselineId: id, baselines: { [id]: candidate } }).baselines[id]!;
    // confirmationId 指向检查点时，内容与确认时间必须一致。
    const matched = checkpoints.find((item) => item.id === raw.confirmationId);
    if (matched && (!confirmed || !equal(matched.content, confirmed.content) || matched.createdAt !== raw.confirmedAt)) throw new Error('阶段确认快照与检查点不一致');
    return {
      revision: checked.revision, draft: draft.content, overrides: draft.overrides, containerStates: draft.containerStates,
      ...(confirmed ? { confirmed } : {}),
      ...(checked.confirmedAt ? { confirmedAt: checked.confirmedAt } : {}),
      ...(text(raw.confirmationId) ? { confirmationId: raw.confirmationId } : {}),
      ...(checked.confirmedRevision ? { confirmedRevision: checked.confirmedRevision } : {}),
      ...(checked.requiresConfirmation !== undefined ? { requiresConfirmation: checked.requiresConfirmation } : {}),
      checkpoints,
      ...(checked.viewport ? { viewport: checked.viewport } : {}),
      ...(checked.transition ? { transition: checked.transition } : {}),
      ...(checked.inheritance ? { inheritance: checked.inheritance } : {}),
      ...(checked.sourceStage ? { sourceStage: checked.sourceStage } : {}),
    };
}

/** 校验外部项目数据并返回新记录；不修改输入，也不写存储。 */
export function normalizeProjectWorkspace(value: unknown, projectId: string): ProjectWorkspace {
  if (!record(value) || value.version !== 1 || !text(value.projectId) || !text(value.activeStageId) || !record(value.stages)) throw new Error('项目工作空间格式不正确');
  if (value.projectId !== projectId) throw new Error('工作空间所属项目不匹配');
  if (value.activeView !== undefined && !viewModes.has(value.activeView as CanvasViewMode)) throw new Error('项目当前视图类型不正确');
  const activeView = (value.activeView ?? 'structure') as CanvasViewMode;
  const stages: Record<string, ProjectStageWorkspace> = {};
  for (const [id, raw] of Object.entries(value.stages)) {
    const alias = normalizeProjectView(id, raw);
    if (!record(raw)) throw new Error('项目阶段工作空间格式不正确');
    // 旧记录没有 views 时保留单视图别名；有 views 时每个模式独立校验。
    if (raw.views === undefined) {
      stages[id] = alias;
      continue;
    }
    if (!record(raw.views) || value.activeView === undefined) throw new Error('项目视图集合格式不正确');
    const views: NonNullable<ProjectStageWorkspace['views']> = {};
    for (const [mode, view] of Object.entries(raw.views)) {
      if (!viewModes.has(mode as CanvasViewMode) || !record(view) || view.views !== undefined) throw new Error('项目视图集合格式不正确');
      views[mode as CanvasViewMode] = normalizeProjectView(id, view);
    }
    // 单视图别名必须与至少一个模式快照完全一致。
    if (!Object.values(views).some((view) => equal(alias, view))) throw new Error('项目阶段视图别名缺少对应快照');
    // 当前活动视图必须与别名一致，否则保存后读写会分叉。
    if (views[activeView] && !equal(alias, views[activeView])) throw new Error('当前项目视图与视图集合不一致');
    stages[id] = { ...alias, views };
  }
  return { version: 1, projectId, activeStageId: value.activeStageId, ...(value.activeView !== undefined ? { activeView } : {}), stages };
}

/** 创建项目作用域存储；读取校验项目归属，写入前重建并校验完整项目记录。 */
export function createProjectViewStorage(storage: Pick<Storage, 'getItem' | 'setItem'>, projectId: string): CanvasViewStorage {
  const read = (key: string): ProjectWorkspace | undefined => {
    const value = storage.getItem(key);
    return value === null ? undefined : normalizeProjectWorkspace(JSON.parse(value) as unknown, projectId);
  };
  return {
    load(key) { const workspace = read(key); return workspace ? projectWorkspaceToCanvas(workspace) : undefined; },
    save(key, view: CanvasWorkspaceView) {
      normalizeWorkspaceView(view);
      const previous = read(key);
      const workspace = canvasWorkspaceToProject(view, projectId, previous);
      // 在替换旧记录前校验完整输出。
      normalizeProjectWorkspace(workspace, projectId);
      const original = storage.getItem(key);
      // 统一卡片规格备份只写一次；已存在时永不覆盖。
      const uniformCardsBackup = `${key}:before-uniform-cards-v1`;
      if (original !== null && storage.getItem(uniformCardsBackup) === null) storage.setItem(uniformCardsBackup, original);
      const backupKey = `${key}:before-layout-intent-v1`;
      // 布局意图备份只在任一新节点带 layoutEdits 时写入。
      const allViews = view.views ? Object.values(view.views).flatMap((baselines) => Object.values(baselines)) : Object.values(view.baselines);
      if (original !== null && storage.getItem(backupKey) === null && allViews.some((stage) => stage.nodes.some((node) => node.data.layoutEdits))) storage.setItem(backupKey, original);
      // 三视图备份只在旧记录仍是单视图结构时写入。
      const threeViewsBackup = `${key}:before-three-views-v1`;
      if (original !== null && storage.getItem(threeViewsBackup) === null) {
        const raw: unknown = JSON.parse(original);
        if (record(raw) && record(raw.stages) && (raw.activeView === undefined || Object.values(raw.stages).some((stage) => record(stage) && stage.views === undefined))) storage.setItem(threeViewsBackup, original);
      }
      // 最后写主记录；此前失败不会替换旧记录。
      storage.setItem(key, JSON.stringify(workspace));
    },
  };
}
