import type { JsonObject, JsonValue, ToolCall, ToolDefinition, ToolExecutionContext, ToolOutcome, World } from '../../src/protocol/index.ts';

export class FixtureWorld implements World {
  readonly id = 'fixture-world';
  private readonly values = new Map<string, JsonValue>();
  private started = false;
  readonly lifecycle: string[] = [];

  async start(): Promise<void> {
    this.lifecycle.push('start');
    this.started = true;
  }

  async stop(): Promise<void> {
    this.lifecycle.push('stop');
    this.started = false;
  }

  tools(): readonly ToolDefinition[] {
    return [
      { name: 'fixture.get', description: 'Read a fixture value.', inputSchema: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } } },
      { name: 'fixture.set', description: 'Write a fixture value.', inputSchema: { type: 'object', required: ['key', 'value'], properties: { key: { type: 'string' }, value: {} } } },
      { name: 'fixture.fail', description: 'Return a fixture failure.', inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } } },
    ];
  }

  async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
    if (!this.started) return failed(call, 'world_stopped', 'FixtureWorld is stopped');
    if (context.signal.aborted) return { callId: call.callId, toolName: call.toolName, status: 'cancelled' };
    const args = call.arguments as JsonObject;
    if (call.toolName === 'fixture.get') {
      if (typeof args.key !== 'string') return failed(call, 'invalid_key', 'key must be a string');
      return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: this.values.get(args.key) ?? null };
    }
    if (call.toolName === 'fixture.set') {
      if (typeof args.key !== 'string' || !('value' in args)) return failed(call, 'invalid_input', 'key and value are required');
      this.values.set(args.key, args.value as JsonValue);
      return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: args.value as JsonValue };
    }
    if (call.toolName === 'fixture.fail') {
      if (typeof args.message !== 'string') return failed(call, 'invalid_message', 'message must be a string');
      return failed(call, 'fixture_failure', args.message);
    }
    return failed(call, 'unknown_tool', `Unknown tool: ${call.toolName}`);
  }

  value(key: string): JsonValue | undefined { return this.values.get(key); }
}

function failed(call: ToolCall, code: string, message: string): ToolOutcome {
  return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code, message } };
}
