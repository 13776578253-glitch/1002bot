/** Tasks persist Agent intent across runs; Runtime grants only lifecycle-bound confirmed commits. */
import type { AgentContext, JsonObject, RunResult, SessionEntry, ToolCall, ToolDefinition, ToolOutcome } from './index.ts';

export type TaskStatus = 'active' | 'waiting' | 'completed' | 'cancelled';
export interface TaskSchedule { revision: number; wakeAt: string; consumedByRunId?: string }
export interface TaskState {
  taskId: string;
  revision: number;
  intent: string;
  data: JsonObject;
  status: TaskStatus;
  /** 明确设置或清除安排才递增；内容修订不重新武装已消费安排。 */
  scheduleRevision: number;
  schedule?: TaskSchedule;
}
export interface TaskEffect { callId: string; toolName: string; status: ToolOutcome['status']; error?: { code: string; message: string } }
export interface TaskAttempt { runId: string; status: 'running' | RunResult['status']; effects: TaskEffect[]; omittedEffects: number; effectTotals: Record<ToolOutcome['status'], number>; code?: string }
export interface TaskSnapshot extends TaskState {
  lastAttempt?: TaskAttempt;
  /** 最近具有 World 工具回执的尝试；认领新 run 或仅修改意图不会抹掉已有效果依据。 */
  effectAttempt?: TaskAttempt;
}
export interface TaskCreate { intent: string; data?: JsonObject; status: 'active' | 'waiting'; schedule?: { wakeAt: string } }
export interface TaskUpdate {
  taskId: string;
  expectedRevision: number;
  intent?: string;
  data?: JsonObject;
  status?: TaskStatus;
  /** 省略表示保持安排；null 明确清除，wakeAt 明确重排。 */
  schedule?: { wakeAt: string } | null;
}
export interface TaskLimits { activeTasks: number; activeBytes: number; stateBytes: number; viewBytes: number; effects: number; evidenceBytes: number }
export const STANDARD_TASK_LIMITS: Readonly<TaskLimits> = Object.freeze({ activeTasks: 64, activeBytes: 128 * 1024, stateBytes: 4 * 1024, viewBytes: 16 * 1024, effects: 8, evidenceBytes: 32 * 1024 });
export interface TaskInspector {
  snapshot(): readonly TaskSnapshot[];
  read(taskId: string): Promise<TaskSnapshot | undefined>;
  evidence(taskId: string, runId: string, bytes?: number): Promise<readonly SessionEntry[]>;
}
export interface TaskRunPort extends TaskInspector {
  readonly limits: Readonly<TaskLimits>;
  readonly selectedTaskId: string | undefined;
  now(): string;
  create(input: TaskCreate): Promise<TaskSnapshot>;
  update(input: TaskUpdate): Promise<TaskSnapshot>;
  claim(taskId: string, scheduleRevision: number): Promise<TaskSnapshot>;
}
/** Agent owns tool semantics; calls share the Runtime run's authority and Session write barrier. */
export interface AgentTaskTools {
  tools(): readonly ToolDefinition[];
  executeTool(call: ToolCall, context: AgentContext): Promise<ToolOutcome>;
}
export type TaskRecord =
  | { kind: 'task_changed'; at: string; schema: 1; sessionId: string; expectedRevision: number; task: TaskState; callId?: string }
  | { kind: 'task_claimed'; at: string; schema: 1; sessionId: string; taskId: string; scheduleRevision: number; checkedAt: string; callId?: string };
