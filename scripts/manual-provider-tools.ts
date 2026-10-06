import assert from 'node:assert/strict';
import { OpenAIResponsesProvider } from '../src/providers/openai-responses-provider.ts';
import type { JsonObject, ModelMessage, ToolOutcome } from '../src/protocol/index.ts';

const apiKey = process.env.PROVIDER_API_KEY;
const model = process.env.PROVIDER_MODEL;
const baseUrl = process.env.PROVIDER_BASE_URL;
if (!apiKey || !model) throw new Error('Set PROVIDER_API_KEY and PROVIDER_MODEL; PROVIDER_BASE_URL is optional');

const provider = new OpenAIResponsesProvider({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) });
const messages: ModelMessage[] = [{ role: 'user', content: 'Call read_fixture_value with key="x", then report the exact value it returns.' }];
const tools = [{
  name: 'read_fixture_value', description: 'Read a local fixture value.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', enum: ['x'] } } } satisfies JsonObject,
}];
const outcomes: ToolOutcome[] = [];

for (let turn = 0; turn < 4; turn++) {
  const response = await provider.complete({ sessionId: 'manual-tools', messages, tools }, AbortSignal.timeout(30_000));
  if (!response.toolCalls.length) {
    assert.ok(outcomes.length > 0, 'The model did not call the fixture tool');
    assert.ok(outcomes.every((outcome) => outcome.status === 'succeeded'), 'A fixture tool failed');
    assert.ok(response.message, 'The model did not return a final message');
    assert.ok(response.message.content.includes('fixture_value_7'), 'The final text omitted the tool value');
    console.log(JSON.stringify({ status: 'passed', requests: turn + 1, callIds: outcomes.map((outcome) => outcome.callId), message: response.message.content }));
    break;
  }
  messages.push({ role: 'assistant', content: response.message?.content ?? '', toolCalls: response.toolCalls, ...(response.providerData ? { providerData: response.providerData } : {}) });
  for (const call of response.toolCalls) {
    const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) as JsonObject : call.arguments;
    const outcome: ToolOutcome = call.toolName === 'read_fixture_value' && args?.key === 'x'
      ? { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: 'fixture_value_7' }
      : { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'invalid_fixture_call', message: 'Expected read_fixture_value with key=x' } };
    outcomes.push(outcome);
    messages.push({ role: 'tool', toolCallId: call.callId, content: JSON.stringify(outcome) });
  }
  if (turn === 3) throw new Error('Provider did not finish within four requests');
}
