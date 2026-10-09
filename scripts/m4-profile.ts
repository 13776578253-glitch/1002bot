/** Offline growth measurement records archive size separately from bounded views and per-run scan work. */
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { JsonlSessionStore } from '../src/state/jsonl-session.ts';
import { Runtime } from '../src/runtime/runtime.ts';
import { ConversationAgent } from '../src/agent/conversation-agent.ts';
import { MemoryState } from '../src/state/memory-state.ts';
import { ScriptedProvider } from '../src/providers/scripted-provider.ts';
import { FixtureWorld } from '../tests/fixtures/fixture-world.ts';
import type { SessionEntry } from '../src/protocol/index.ts';

const directory = await mkdtemp(join(tmpdir(), 'bot-m4-profile-'));
const path = join(directory, 'session.jsonl');
class Store extends JsonlSessionStore {
  scans = 0; fullReads = 0;
  override scan(signal?: AbortSignal) { ++this.scans; return super.scan(signal); }
  override read() { ++this.fullReads; return super.read(); }
}
const store = new Store(path), stream = { streamId: 'facts', epoch: 'profile-1' };
const build = (session: Store) => new Runtime({ world: new FixtureWorld(), agent: new ConversationAgent({ sessionId: 'profile' }), session, state: new MemoryState(), worldStreams: [stream],
  provider: new ScriptedProvider(() => ({ finishReason: 'stop', toolCalls: [], message: { role: 'assistant', content: 'done' } })) });
const runtime = build(store);
await runtime.start();
const observations = [];
let processed = 0;
try {
  for (const total of [64, 256, 1024]) {
    const begin = performance.now();
    for (let sequence = processed + 1; sequence <= total; ++sequence) {
      const receipt = await runtime.deliveries.submit({ ...stream, sequence, event: { id: `event-${sequence}`, source: 'fixture', type: 'fixture.input', occurredAt: '2026-10-09T00:00:00Z', payload: sequence } });
      if (receipt.status !== 'accepted') throw new Error(JSON.stringify(receipt));
      await runtime.triggers.idle();
    }
    const runMs = performance.now() - begin;
    observations.push({ total, newRuns: total - processed, runMs, msPerRun: runMs / (total - processed), archiveBytes: (await stat(path)).size,
      heapUsed: process.memoryUsage().heapUsed, history: runtime.diagnosis.history, traceEntries: runtime.trace.length, scans: store.scans, fullReads: store.fullReads, positions: runtime.deliveries.progress(stream.streamId).uncompacted });
    processed = total;
  }
} finally { await runtime.stop(); }
let maximumRecordBytes = 0, records = 0;
for await (const entry of new JsonlSessionStore(path).scan()) { ++records; maximumRecordBytes = Math.max(maximumRecordBytes, Buffer.byteLength(JSON.stringify(entry as SessionEntry) + '\n')); }
const reopened = new Store(path), rebuilt = build(reopened), begin = performance.now();
await rebuilt.start(); const rebuildMs = performance.now() - begin; await rebuilt.stop();
console.log(JSON.stringify({ node: process.version, platform: process.platform, directory, observations, records, maximumRecordBytes, rebuildMs, rebuiltPrefix: rebuilt.deliveries.progress(stream.streamId).settledPrefix }, null, 2));
