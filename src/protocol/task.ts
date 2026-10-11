/** Tasks persist Agent intent across runs; Runtime grants only lifecycle-bound confirmed commits. */
import type { AgentContext, JsonObject, RunResult, SessionEntry, ToolCall, ToolDefinition, ToolOutcome } from './index.ts';

export type TaskStatus = 'active' | 'waiting' | 'completed' | 'cancelled';
/** An explicit arrangement is consumed by one run; rearming requires a new schedule revision. */
export interface TaskSchedule {
  revision: number;
  /** 任务时钟上的到期时间；到期只提供心跳候选，执行仍经过统一队列。 */
  wakeAt: string;
  /** 认领记录确认后绑定；本轮失败或重启均保留消费事实。 */
  consumedByRunId?: string
}
/** Agent intent is distinct from run completion and World effect outcomes. */
export interface TaskState {
  taskId: string;
  /** 每次内容更新递增；认领安排不改变此版本。 */
  revision: number;
  intent: string;
  data: JsonObject;
  status: TaskStatus;
  /** 明确设置或清除安排才递增；内容修订不重新武装已消费安排。 */
  scheduleRevision: number;
  schedule?: TaskSchedule;
}
/** Bounded references preserve World outcome classifications; full receipts remain in Session. */
export interface TaskEffect { callId: string; toolName: string; status: ToolOutcome['status']; error?: { code: string; message: string } }
export interface TaskAttempt {
  runId: string;
  /** 关联 run 的结果；任务状态仍由 Agent 显式更新。 */
  status: 'running' | RunResult['status'];
  effects: TaskEffect[];
  /** 因数量或字节预算省略的 World 回执引用数。 */
  omittedEffects: number;
  /** 包含省略引用的各状态累计数；Agent 任务工具回执不计入。 */
  effectTotals: Record<ToolOutcome['status'], number>;
  code?: string
}
export interface TaskSnapshot extends TaskState {
  /** 最近修改或认领此任务的 run；只读查询不会建立尝试关联。 */
  lastAttempt?: TaskAttempt;
  /** 最近具有 World 工具回执的尝试；认领新 run 或仅修改意图不会抹掉已有效果依据。 */
  effectAttempt?: TaskAttempt;
}
export interface TaskCreate { intent: string; data?: JsonObject; status: 'active' | 'waiting'; schedule?: { wakeAt: string } }
export interface TaskUpdate {
  taskId: string;
  /** 与已确认内容版本匹配才可提交，排队等待期间不自动改用新版本。 */
  expectedRevision: number;
  intent?: string;
  data?: JsonObject;
  status?: TaskStatus;
  /** 省略表示保持安排；null 明确清除，wakeAt 明确重排。 */
  schedule?: { wakeAt: string } | null;
}
/** Task state, attempt summaries, model views and archive reads each have explicit capacity bounds. */
export interface TaskLimits {
  /** 活跃任务数上限；单次 run 关联的任务数也受此上限约束。 */
  activeTasks: number;
  /** 活跃任务纯状态数组的 JSON UTF-8 字节上限，尝试摘要另行限额。 */
  activeBytes: number;
  /** 单个任务纯状态以及单个尝试摘要各自的 JSON UTF-8 字节上限。 */
  stateBytes: number;
  /** 交给模型的任务视图整体 JSON UTF-8 字节上限。 */
  viewBytes: number;
  /** 单个尝试摘要保留的 World 回执引用数上限。 */
  effects: number;
  /** 显式查询一个完整已结清 run 的记录 JSON UTF-8 字节总和上限。 */
  evidenceBytes: number
}
export const STANDARD_TASK_LIMITS: Readonly<TaskLimits> = Object.freeze({ activeTasks: 64, activeBytes: 128 * 1024, stateBytes: 4 * 1024, viewBytes: 16 * 1024, effects: 8, evidenceBytes: 32 * 1024 });
/** Read-only inspection exposes confirmed projections and explicit archive queries. */
export interface TaskInspector {
  /** 返回活跃任务的独立副本。 */
  snapshot(): readonly TaskSnapshot[];
  /** 流式扫描归档，包含终态任务；不存在时返回 undefined。 */
  read(taskId: string): Promise<TaskSnapshot | undefined>;
  /** 返回关联任务的完整已结清 run，包含失败与 unknown；超预算整组拒绝。 */
  evidence(taskId: string, runId: string, bytes?: number): Promise<readonly SessionEntry[]>;
}
/** Mutation authority belongs to the current run and is revoked with its lifecycle or tool call. */
export interface TaskRunPort extends TaskInspector {
  readonly limits: Readonly<TaskLimits>;
  /** 本轮已确认认领的任务；普通创建或更新不会设置此字段。 */
  readonly selectedTaskId: string | undefined;
  /** Runtime 注入的任务时钟，用于到期选择与认领检查。 */
  now(): string;
  /** 创建与更新均在 Session 追加确认、投影发布后返回。 */
  create(input: TaskCreate): Promise<TaskSnapshot>;
  update(input: TaskUpdate): Promise<TaskSnapshot>;
  /** 消费到期且未消费的指定安排；Promise 在 Session 追加确认后完成。 */
  claim(taskId: string, scheduleRevision: number): Promise<TaskSnapshot>;
}
/** Agent owns tool semantics; calls share the Runtime run's authority and Session write barrier. */
export interface AgentTaskTools {
  tools(): readonly ToolDefinition[];
  executeTool(call: ToolCall, context: AgentContext): Promise<ToolOutcome>;
}
/** Session control facts carry the originating run; callId binds tool-issued commits to a declared Agent call. */
export type TaskRecord =
  | { kind: 'task_changed'; at: string; schema: 1; sessionId: string; expectedRevision: number; task: TaskState; callId?: string }
  | { kind: 'task_claimed'; at: string; schema: 1; sessionId: string; taskId: string; scheduleRevision: number; checkedAt: string; callId?: string };
