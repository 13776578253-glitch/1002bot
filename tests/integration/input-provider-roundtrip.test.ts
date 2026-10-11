import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { ConversationAgent } from '../../src/agent/conversation-agent.ts';
import { OpenAIResponsesProvider } from '../../src/providers/openai-responses-provider.ts';
import { Runtime } from '../../src/runtime/runtime.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';
import type { JsonObject } from '../../src/protocol/index.ts';

it('completes user input through native response items, tool receipts and the terminal commit', { timeout: 3000 }, async () => {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-input-provider-')), 'session.jsonl'));
  const bodies: { input: JsonObject[]; tools: { name: string }[] }[] = [];
  const world = new FixtureWorld();
  const wire = (items: JsonObject[]) => {
    const names = new Map(world.tools().map((tool, index) => [tool.name, bodies[0]!.tools[index]!.name]));
    return items.map(item => item.type === 'function_call' ? { ...item, name: names.get(item.name as string) } : item);
  };
  const first: JsonObject[] = [
    { type: 'reasoning', id: 'reason-1', encrypted_content: 'opaque-1', summary: [] },
    { type: 'function_call', call_id: 'set', name: 'fixture.set', arguments: '{"key":"x","value":7}' },
    { type: 'function_call', call_id: 'fail', name: 'fixture.fail', arguments: '{"message":"fixture failure"}' },
  ];
  const second: JsonObject[] = [
    { type: 'reasoning', id: 'reason-2', encrypted_content: 'opaque-2', summary: [] },
    { type: 'function_call', call_id: 'get', name: 'fixture.get', arguments: '{"key":"x"}' },
  ];
  const provider = new OpenAIResponsesProvider({ apiKey: 'credential-sentinel', model: 'fixture-model', fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as { input: JsonObject[]; tools: { name: string }[] });
    const output = bodies.length === 1 ? wire(first) : bodies.length === 2 ? wire(second) : [{ type: 'message', content: [{ type: 'output_text', text: 'value=7; failure recorded' }] }];
    return new Response(JSON.stringify({ status: 'completed', output }));
  } });
  const runtime = new Runtime({ agent: new ConversationAgent({ sessionId: 'native-input' }), provider, world, session: store, state: new MemoryState() });
  await runtime.start();
  try {
    await runtime.inputs.submit({ inputId: 'native', source: 'untrusted-source', content: { kind: 'text', text: 'set/read and report failure' } });
    await runtime.inputs.idle();
    assert.equal(runtime.inputs.inspect('native')?.result?.reply, 'value=7; failure recorded');
    assert.deepEqual(bodies[1]!.input.slice(2, 5), wire(first));
    const outputs = bodies[2]!.input.filter((item) => item.type === 'function_call_output');
    assert.deepEqual(outputs.map((item) => item.call_id), ['set', 'fail', 'get']);
    assert.equal(JSON.parse(String(outputs[1]!.output)).status, 'failed');
    assert.ok(bodies[2]!.input.some((item) => item.encrypted_content === 'opaque-2'));
    assert.equal(bodies[0]!.input.some((item) => String(item.content).includes('untrusted-source')), false);
    const entries = await store.read();
    assert.deepEqual(entries.filter((entry) => entry.kind === 'provider_response')[0]!.response.providerData?.output, first);
    assert.equal(entries.at(-1)?.kind, 'run_finished');
    assert.equal(JSON.stringify(runtime.inputs.eventsSince(0)).includes('encrypted_content'), false);
    assert.equal(JSON.stringify(runtime.inputs.eventsSince(0)).includes('credential-sentinel'), false);
  } finally { await runtime.stop(); }
});
