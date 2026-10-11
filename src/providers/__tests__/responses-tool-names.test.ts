import assert from 'node:assert/strict';
import { it } from 'node:test';
import { responsesToolNames } from '../responses-tool-names.ts';
import type { ProviderRequest } from '../../protocol/index.ts';
import { OpenAIResponsesProvider } from '../openai-responses-provider.ts';

const request = (names: string[]): ProviderRequest => ({ sessionId: 'codec', messages: [], tools: names.map(name => ({ name, description: 'fixture', inputSchema: { type: 'object' } })) });
it('encodes dotted names reversibly while retaining legal names and avoiding alias collisions', () => {
  const first = responsesToolNames(request(['domain.read', 'domain_read']), 'fixture');
  const alias = first.toWire('domain.read');
  const next = responsesToolNames(request(['domain.read', 'domain_read', alias]), 'fixture');
  assert.match(alias, /^[a-zA-Z0-9_-]+$/); assert.equal(first.fromWire(alias), 'domain.read');
  assert.equal(first.toWire('domain_read'), 'domain_read');
  assert.notEqual(next.toWire('domain.read'), alias); assert.equal(next.toWire(alias), alias);
  assert.equal(next.fromWire(next.toWire('domain.read')), 'domain.read');
});
it('includes historical function names without modifying native Provider records', () => {
  const input = request(['current']);
  input.messages = [{ role: 'assistant', content: '', providerData: { providerId: 'fixture', output: [{ type: 'function_call', name: 'old.read', call_id: 'old', arguments: '{}' }, { type: 'reasoning', opaque: 'keep' }] } }];
  const before = structuredClone(input), names = responsesToolNames(input, 'fixture');
  assert.match(names.toWire('old.read'), /^[a-zA-Z0-9_-]+$/); assert.equal(names.fromWire(names.toWire('old.read')), 'old.read');
  assert.deepEqual(input, before);
});
it('replays legacy native wire names using the paired internal call without changing archived data', () => {
  const input = request(['domain.read']);
  input.messages = [{ role: 'assistant', content: '', toolCalls: [{ callId: 'old', toolName: 'domain.read', arguments: {} }],
    providerData: { providerId: 'openai-responses', output: [{ type: 'function_call', name: 'domain_read', call_id: 'old', arguments: '{}' }, { type: 'reasoning', encrypted_content: 'opaque' }] } }];
  const before = structuredClone(input), provider = new OpenAIResponsesProvider({ apiKey: 'fixture', model: 'fixture-model' });
  const body = JSON.parse(provider.serializeRequest(input)) as { input: { name?: string; encrypted_content?: string }[]; tools: { name: string }[] };
  assert.equal(body.input[0]!.name, body.tools[0]!.name); assert.equal(body.input[1]!.encrypted_content, 'opaque');
  assert.equal(provider.measureRequest(input), Buffer.byteLength(provider.serializeRequest(input))); assert.deepEqual(input, before);
});
