import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { OpenAIResponsesProvider } from '../../src/providers/openai-responses-provider.ts';
import { composeRuntime } from '../../src/runtime/compose.ts';
import { JsonlSessionStore } from '../../src/state/jsonl-session.ts';
import { MemoryState } from '../../src/state/memory-state.ts';
import type { JsonObject } from '../../src/protocol/index.ts';
import { FixtureWorld } from '../fixtures/fixture-world.ts';
import { TestAgent } from '../fixtures/test-agent.ts';

it('replays native response items and paired tool outputs across two tool rounds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-roundtrip-'));
  const store = new JsonlSessionStore(join(directory, 'session.jsonl'));
  const world = new FixtureWorld();
  const firstOutput: JsonObject[] = [
    { type: 'reasoning', id: 'reason-1', summary: [], encrypted_content: 'opaque-fixture' },
    { type: 'function_call', call_id: 'write', name: 'fixture.set', arguments: '{"key":"x","value":7}' },
    { type: 'function_call', call_id: 'fail', name: 'fixture.fail', arguments: '{"message":"expected"}' },
  ];
  const secondOutput: JsonObject[] = [{ type: 'function_call', call_id: 'read', name: 'fixture.get', arguments: '{"key":"x"}' }];
  const inputs: JsonObject[][] = [];
  const provider = new OpenAIResponsesProvider({
    apiKey: 'fixture-key', model: 'fixture-model', baseUrl: 'https://provider.invalid/v1',
    fetchImpl: (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: JsonObject[] };
      inputs.push(body.input);
      const serialized = JSON.parse(provider.serializeRequest({ sessionId: 'fixture', messages: [], tools: world.tools() })) as { tools: { name: string }[] };
      const names = new Map(world.tools().map((tool, index) => [tool.name, serialized.tools[index]!.name]));
      const native: JsonObject[] = inputs.length === 1 ? firstOutput : inputs.length === 2 ? secondOutput : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'value=7; failure observed' }] }];
      const output = native.map(item => item.type === 'function_call' ? { ...item, name: names.get(item.name as string) } : item);
      return new Response(JSON.stringify({ output }), { status: 200 });
    }) as typeof fetch,
  });
  const runtime = composeRuntime({ agent: new TestAgent(), provider, world, session: store, state: new MemoryState() });
  await runtime.start();
  await runtime.handleEvent({ id: 'roundtrip', type: 'fixture.input', source: 'test', occurredAt: '2026-10-05T00:00:00Z', payload: { text: 'write, fail, then read' } });
  await runtime.stop();
  const entries = await store.read();
  assert.equal(inputs.length, 3);
  assert.equal(world.value('x'), 7);
  const outcomes = entries.filter((entry) => entry.kind === 'tool_outcome').map((entry) => entry.outcome);
  assert.deepEqual(outcomes.map((outcome) => [outcome.callId, outcome.status]), [['write', 'succeeded'], ['fail', 'failed'], ['read', 'succeeded']]);
  const firstInput = inputs[0]!;
  const results = outcomes.map((outcome) => ({ type: 'function_call_output', call_id: outcome.callId, output: JSON.stringify(outcome) }));
  const declarations = JSON.parse(provider.serializeRequest({ sessionId: 'fixture', messages: [], tools: world.tools() })) as { tools: { name: string }[] };
  const aliases = new Map(world.tools().map((tool, index) => [tool.name, declarations.tools[index]!.name]));
  const wire = (items: JsonObject[]) => items.map(item => item.type === 'function_call' ? { ...item, name: aliases.get(item.name as string) } : item);
  assert.deepEqual(inputs[1], [...firstInput, ...wire(firstOutput), results[0], results[1]]);
  assert.deepEqual(inputs[2], [...firstInput, ...wire(firstOutput), results[0], results[1], ...wire(secondOutput), results[2]]);
  assert.equal(entries.filter((entry) => entry.kind === 'provider_response').at(-1)?.response.message?.content, 'value=7; failure observed');
  // The adapter's continuation data must survive JSONL serialization for replay.
  assert.deepEqual(await new JsonlSessionStore(join(directory, 'session.jsonl')).read(), entries);
});
