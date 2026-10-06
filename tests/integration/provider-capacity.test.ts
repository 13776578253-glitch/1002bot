import assert from 'node:assert/strict';
import { it } from 'node:test';
import { OpenAIResponsesProvider } from '../../src/providers/openai-responses-provider.ts';
import type { ProviderRequest } from '../../src/protocol/index.ts';

const request: ProviderRequest = { sessionId: 'capacity', messages: [{ role: 'user', content: '汉字\n"quoted"' },
  { role: 'assistant', content: '', providerData: { providerId: 'openai-responses', output: [{ type: 'reasoning', encrypted_content: 'opaque'.repeat(100) }] } }],
  tools: [{ name: 'fixture.get', description: 'read', inputSchema: { type: 'object', required: ['key'] } }] };
it('measures exactly the transmitted JSON including opaque output, schema and protocol fields', async () => {
  let actual = '';
  const provider = new OpenAIResponsesProvider({ apiKey: 'test', model: 'fixture-model', fetchImpl: async (_url, init) => {
    actual = String(init?.body);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'complete' }] }] }));
  } });
  const size = provider.measureRequest(request);
  const result = await provider.complete(request, new AbortController().signal);
  assert.equal(size, Buffer.byteLength(actual));
  assert.match(actual, /encrypted_content/);
  assert.match(actual, /parameters/);
  assert.equal(result.finishReason, 'stop');
  assert.ok(result.bodyBytes! > 0);
});
it('cancels body consumption at the byte cap before interpreting any tool declarations', async () => {
  let cancelled = false;
  const provider = new OpenAIResponsesProvider({ apiKey: 'test', model: 'fixture-model', responseBytes: 64, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"output":[' + ' '.repeat(80))); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(provider.complete(request, new AbortController().signal), { code: 'response_limit' });
  assert.equal(cancelled, true);
});
for (const status of ['incomplete', 'failed']) it(`preserves the ${status} model terminal`, async () => {
  const provider = new OpenAIResponsesProvider({ apiKey: 'test', model: 'fixture-model', fetchImpl: async () => new Response(JSON.stringify({ status, output: [] })) });
  assert.equal((await provider.complete(request, new AbortController().signal)).finishReason, status === 'incomplete' ? 'length' : 'error');
});
