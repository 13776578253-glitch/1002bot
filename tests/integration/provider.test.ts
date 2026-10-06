import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OpenAIResponsesProvider } from '../../src/providers/openai-responses-provider.ts';

describe('Responses provider adapter', () => {
  it('maps a request and parses function calls without network access', async () => {
    let seenUrl = '';
    let seenBody: any;
    const provider = new OpenAIResponsesProvider({
      apiKey: 'test-key',
      model: 'fixture-model',
      baseUrl: 'https://provider.invalid/v1',
      fetchImpl: (async (input, init) => {
        seenUrl = String(input);
        seenBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ output: [{ type: 'function_call', call_id: 'call-1', name: 'fixture.get', arguments: '{"key":"x"}' }] }), { status: 200 });
      }) as typeof fetch,
    });
    const result = await provider.complete({ sessionId: 's', messages: [{ role: 'user', content: 'read' }], tools: [{ name: 'fixture.get', description: 'read', inputSchema: { type: 'object' } }] }, new AbortController().signal);
    assert.equal(seenUrl, 'https://provider.invalid/v1/responses');
    assert.equal(seenBody.model, 'fixture-model');
    assert.equal(result.finishReason, 'tool_calls');
    assert.deepEqual(result.toolCalls[0], { callId: 'call-1', toolName: 'fixture.get', arguments: '{"key":"x"}' });
  });
});
