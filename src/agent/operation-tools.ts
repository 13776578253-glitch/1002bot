/** Agent explicitly requests late evidence; Runtime owns original-call association and read budgets. */
import type { AgentContext, AgentTaskTools, JsonValue, ToolCall, ToolDefinition, ToolOutcome } from '../protocol/index.ts';
import { InputError } from '../protocol/index.ts';
import { jsonObject } from '../state/task-projection.ts';
export class OperationTools implements AgentTaskTools {
  tools(): readonly ToolDefinition[] { return [{ name: 'agent_operation_evidence', description: 'Read an original World call late result explicitly. It is not automatic history; an oversized record is rejected whole.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['runId', 'callId'], properties: {
      runId: { type: 'string' }, callId: { type: 'string' }, bytes: { type: 'integer', minimum: 1 } } } }]; }
  async executeTool(call: ToolCall, context: AgentContext): Promise<ToolOutcome> {
    try {
      if (!context.readLate) throw new InputError('operation_capability', 'This run has no late evidence capability');
      const args = call.arguments;
      if (!jsonObject(args) || Object.keys(args).some(key => !['runId', 'callId', 'bytes'].includes(key))
        || typeof args.runId !== 'string' || !args.runId || typeof args.callId !== 'string' || !args.callId
        || args.bytes !== undefined && (typeof args.bytes !== 'number' || !Number.isSafeInteger(args.bytes) || args.bytes < 1)) throw new InputError('invalid_arguments', 'Expected runId, callId and optional positive bytes');
      const record = await context.readLate({ runId: args.runId, callId: args.callId, ...(args.bytes !== undefined ? { bytes: args.bytes as number } : {}) });
      return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: JSON.parse(JSON.stringify(record ?? { found: false })) as JsonValue };
    } catch (error) { return { callId: call.callId, toolName: call.toolName, status: 'failed', error: {
      code: error instanceof InputError ? error.code : 'operation_query_error', message: error instanceof Error ? error.message : String(error) } }; }
  }
}
