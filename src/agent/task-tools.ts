/** Agent task tools express explicit intent; confirmed state and effect evidence come from Runtime. */
import type { AgentContext, AgentTaskTools, JsonObject, TaskCreate, TaskRunPort, TaskSnapshot, TaskUpdate, ToolCall, ToolDefinition, ToolOutcome } from '../protocol/index.ts';
import { InputError } from '../protocol/index.ts';
import { jsonObject } from '../state/task-projection.ts';

const stateProperties: JsonObject = { intent: { type: 'string' }, data: { type: 'object' }, status: { type: 'string', enum: ['active', 'waiting', 'completed', 'cancelled'] }, schedule: { anyOf: [{ type: 'object', additionalProperties: false, required: ['wakeAt'], properties: { wakeAt: { type: 'string' } } }, { type: 'null' }] } };
const definition = (name: string, description: string, required: string[], properties: JsonObject): ToolDefinition => ({ name, description, inputSchema: { type: 'object', additionalProperties: false, required, properties } });
const definitions: readonly ToolDefinition[] = [
  definition('agent_task_create', 'Persist an explicit task intent. Waiting ends this run; only an explicit wakeAt arms a future attempt.', ['intent', 'status'], { ...stateProperties, status: { type: 'string', enum: ['active', 'waiting'] }, schedule: { type: 'object', additionalProperties: false, required: ['wakeAt'], properties: { wakeAt: { type: 'string' } } } }),
  definition('agent_task_update', 'Commit with expectedRevision. Omit schedule to preserve its consumption; supply wakeAt to rearm or null to clear. Completion is an explicit decision.', ['taskId', 'expectedRevision'], { ...stateProperties, taskId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 } }),
  definition('agent_task_list', 'Read a bounded confirmed active view; omitted reports tasks outside this view.', [], {}),
  definition('agent_task_read', 'Read a confirmed active or archived task including real attempt/effect references.', ['taskId'], { taskId: { type: 'string' } }),
  definition('agent_task_evidence', 'Read one complete settled task attempt, including failed-run effects. Oversized evidence is rejected as a whole.', ['taskId', 'runId'], { taskId: { type: 'string' }, runId: { type: 'string' }, bytes: { type: 'integer', minimum: 1 } }),
];
export class TaskTools implements AgentTaskTools {
  tools(): readonly ToolDefinition[] { return structuredClone(definitions); }
  async executeTool(call: ToolCall, context: AgentContext): Promise<ToolOutcome> {
    try {
      const port = context.tasks;
      if (!port) throw new InputError('task_capability', 'This run has no task commit capability');
      const args = call.arguments;
      if (!jsonObject(args)) throw new InputError('invalid_arguments', 'Task arguments must be a JSON object');
      const spec = definitions.find(item => item.name === call.toolName);
      if (!spec || Object.keys(args).some(key => !(key in (spec.inputSchema.properties as JsonObject)))) throw new InputError('invalid_arguments', 'Unexpected task tool or argument');
      let output: unknown;
      if (call.toolName === 'agent_task_create') {
        text(args.intent, 'intent');
        if (args.status !== 'active' && args.status !== 'waiting') throw new InputError('invalid_arguments', 'New task status must be active or waiting');
        if (args.data !== undefined && !jsonObject(args.data)) throw new InputError('invalid_arguments', 'data must be a JSON object');
        const input: TaskCreate = { intent: args.intent as string, status: args.status, ...(args.data ? { data: args.data as JsonObject } : {}) };
        if (args.schedule !== undefined) input.schedule = schedule(args.schedule);
        output = await port.create(input);
      } else if (call.toolName === 'agent_task_update') {
        text(args.taskId, 'taskId');
        if (!Number.isSafeInteger(args.expectedRevision) || (args.expectedRevision as number) < 1) throw new InputError('invalid_arguments', 'expectedRevision must be a positive integer');
        const input: TaskUpdate = { taskId: args.taskId as string, expectedRevision: args.expectedRevision as number };
        if (args.intent !== undefined) { text(args.intent, 'intent'); input.intent = args.intent as string; }
        if (args.data !== undefined) { if (!jsonObject(args.data)) throw new InputError('invalid_arguments', 'data must be a JSON object'); input.data = args.data; }
        if (args.status !== undefined) { if (!['active', 'waiting', 'completed', 'cancelled'].includes(args.status as string)) throw new InputError('invalid_arguments', 'Invalid task status'); input.status = args.status as TaskUpdate['status'] & string; }
        if (args.schedule !== undefined) input.schedule = args.schedule === null ? null : schedule(args.schedule);
        output = await port.update(input);
      } else if (call.toolName === 'agent_task_list') output = taskView(port);
      else if (call.toolName === 'agent_task_read') { text(args.taskId, 'taskId'); output = await port.read(args.taskId as string) ?? null; }
      else { text(args.taskId, 'taskId'); text(args.runId, 'runId'); output = await port.evidence(args.taskId as string, args.runId as string, args.bytes as number | undefined); }
      return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: output as ToolOutcome['output'] & {} };
    } catch (error) {
      // 必要追加失败必须交回执行器停止，不能作为可继续的普通工具失败。
      if (error instanceof InputError && error.code === 'storage_error') throw error;
      return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: error instanceof InputError ? error.code : 'task_error', message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
export function taskView(port: TaskRunPort): { items: TaskSnapshot[]; omitted: number; selectedTaskId: string | null } {
  const tasks = [...port.snapshot()].sort((a, b) => a.taskId === port.selectedTaskId ? -1 : b.taskId === port.selectedTaskId ? 1 : a.taskId.localeCompare(b.taskId));
  const result = { items: [] as TaskSnapshot[], omitted: tasks.length, selectedTaskId: port.selectedTaskId ?? null };
  for (const task of tasks) {
    result.items.push(task); --result.omitted;
    if (Buffer.byteLength(JSON.stringify(result)) > port.limits.viewBytes) { result.items.pop(); ++result.omitted; break; }
  }
  if (tasks.some(task => task.taskId === port.selectedTaskId) && !result.items.some(task => task.taskId === port.selectedTaskId)) throw new InputError('task_view_limit', 'Selected task cannot fit the model view');
  return result;
}
function text(value: unknown, name: string): void { if (typeof value !== 'string' || !value.trim()) throw new InputError('invalid_arguments', `${name} must be nonempty text`); }
function schedule(value: unknown): { wakeAt: string } {
  if (!jsonObject(value) || Object.keys(value).join(',') !== 'wakeAt' || typeof value.wakeAt !== 'string' || !Number.isFinite(Date.parse(value.wakeAt))) throw new InputError('invalid_arguments', 'schedule must contain a valid wakeAt');
  return { wakeAt: value.wakeAt };
}
