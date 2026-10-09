import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it } from 'node:test';
import { JsonlSessionStore } from '../jsonl-session.ts';
import { HistoryWindow, queryHistory } from '../history-window.ts';
import { STANDARD_HISTORY_LIMITS } from '../../protocol/index.ts';
import type { SessionEntry } from '../../protocol/index.ts';

const at = '2026-10-09T00:00:00Z';
function run(id: string): SessionEntry[] {
  const base = { at, runId: id, triggerKind: 'world_event' as const, triggerId: id, generation: 1 };
  return [
    { ...base, kind: 'event', event: { id, source: 'fixture', type: 'fixture.input', occurredAt: at, payload: id } },
    { ...base, kind: 'run_started', inputId: id },
    { ...base, kind: 'provider_response', response: { finishReason: 'tool_calls', toolCalls: [{ callId: 'read', toolName: 'fixture.get', arguments: {} }], providerData: { providerId: 'fixture', output: [{ type: 'opaque_future_item', extra: { retained: true } }] } } },
    { ...base, kind: 'tool_call', call: { callId: 'read', toolName: 'fixture.get', arguments: {} } },
    { ...base, kind: 'tool_outcome', outcome: { callId: 'read', toolName: 'fixture.get', status: 'succeeded', output: 7 } },
    { ...base, kind: 'run_finished', inputId: id, result: { status: 'succeeded', persisted: true } },
  ];
}
it('evicts entire runs and preserves opaque items and tool pairs inside the history budget', () => {
  const window = new HistoryWindow({ runs: 1 });
  for (const entry of [...run('first'), ...run('second')]) window.append(entry);
  const entries = window.snapshot();
  assert.deepEqual(new Set(entries.map(entry => entry.runId)), new Set(['second']));
  assert.equal(entries.filter(entry => entry.kind === 'tool_call').length, 1); assert.equal(entries.filter(entry => entry.kind === 'tool_outcome').length, 1);
  assert.deepEqual(entries.find(entry => entry.kind === 'provider_response')?.response.providerData?.output, [{ type: 'opaque_future_item', extra: { retained: true } }]);
  (entries.find(entry => entry.kind === 'tool_outcome')!.outcome as { output: unknown }).output = 'changed';
  assert.equal(window.snapshot().find(entry => entry.kind === 'tool_outcome')?.outcome.output, 7);
});
it('omits an oversized or incomplete run as a whole instead of retaining unmatched protocol halves', () => {
  const tooSmall = new HistoryWindow({ bytes: 128 }); for (const entry of run('large')) tooSmall.append(entry);
  assert.equal(tooSmall.snapshot().length, 0); assert.equal(tooSmall.stats.omittedRuns, 1);
  const incomplete = new HistoryWindow(); for (const entry of run('missing').filter(entry => entry.kind !== 'tool_outcome')) incomplete.append(entry);
  assert.equal(incomplete.snapshot().length, 0);
});
it('queries earlier complete runs with a declared budget without including receipts or active facts', async () => {
  const store = new JsonlSessionStore(join(await mkdtemp(join(tmpdir(), 'bot-history-')), 'session.jsonl'));
  for (const entry of [...run('one'), ...run('two'), ...run('three')]) await store.append(entry);
  const entries = await queryHistory(store, STANDARD_HISTORY_LIMITS, { beforeRunId: 'three', runs: 1 });
  assert.deepEqual(new Set(entries.map(entry => entry.runId)), new Set(['two']));
  await assert.rejects(queryHistory(store, STANDARD_HISTORY_LIMITS, { runs: STANDARD_HISTORY_LIMITS.runs + 1 }), /budget/);
  const unsuccessful = run('failed');
  const terminal = unsuccessful.at(-1)!;
  if (terminal.kind === 'run_finished') terminal.result.status = 'failed';
  for (const entry of unsuccessful) await store.append(entry);
  assert.equal((await queryHistory(store, STANDARD_HISTORY_LIMITS, { runs: 1 })).some(entry => entry.runId === 'failed'), false);
  assert.equal((await queryHistory(store, STANDARD_HISTORY_LIMITS, { runs: 1, includeUnsuccessful: true })).every(entry => entry.runId === 'failed'), true);
});
it('scans a fixed file boundary while retaining byte-split UTF-8 and diagnosing a torn tail', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'bot-scan-')), 'session.jsonl');
  const store = new JsonlSessionStore(path);
  const entry = run('你好')[0]!;
  if (entry.kind === 'event') entry.event.payload = '你好🙂'.repeat(14000);
  await store.append(entry); await store.append(run('later')[0]!);
  const scan = store.scan()[Symbol.asyncIterator]();
  assert.deepEqual((await scan.next()).value, entry);
  await store.append(run('outside')[0]!);
  const ids: string[] = []; for (;;) { const next = await scan.next(); if (next.done) break; ids.push(next.value.runId!); }
  assert.deepEqual(ids, ['later']);
  await appendFile(path, '{"kind":"event"', 'utf8'); const before = await readFile(path);
  await assert.rejects(store.read(), /tail/); assert.deepEqual(await readFile(path), before);
});
it('bounds individual records and leaves the write chain failed after a capacity error', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'bot-record-cap-')), 'session.jsonl');
  const store = new JsonlSessionStore(path, 32);
  await assert.rejects(store.append(run('oversized')[0]!), /exceeds/);
  await assert.rejects(store.read(), /exceeds/);
  const reader = new JsonlSessionStore(path, 32); await writeFile(path, JSON.stringify(run('old')[0]) + '\n', 'utf8');
  await assert.rejects(reader.read(), /exceeds/);
});
