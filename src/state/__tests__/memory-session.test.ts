import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MemorySessionStore } from '../memory-session.ts';
import type { SessionEntry } from '../../protocol/index.ts';

const event = (id: string): SessionEntry => ({ kind: 'event', at: '2026-10-11T00:00:00Z', event: { id, type: 'message', source: 'fixture', occurredAt: '2026-10-11T00:00:00Z', payload: { text: id } } });
it('confirms ordered memory records and isolates caller and reader mutations', async () => {
  const store = new MemorySessionStore(), first = event('first');
  const writes = [store.append(first), store.append(event('second'))];
  first.at = 'changed'; await Promise.all(writes);
  const read = await store.read();
  assert.deepEqual(read.map(entry => entry.kind === 'event' ? entry.event.id : ''), ['first', 'second']);
  assert.notEqual(read[0]!.at, 'changed'); read[0]!.at = 'reader mutation';
  assert.notEqual((await store.read())[0]!.at, 'reader mutation');
});
it('scans a fixed memory prefix and honours cancellation between records', async () => {
  const store = new MemorySessionStore(); await store.append(event('one')); await store.append(event('two'));
  const controller = new AbortController(), scan = store.scan(controller.signal)[Symbol.asyncIterator]();
  await scan.next(); await store.append(event('three'));
  assert.equal((await scan.next()).value?.event.id, 'two'); assert.equal((await scan.next()).done, true);
  const cancelled = store.scan(controller.signal)[Symbol.asyncIterator](); await cancelled.next(); controller.abort();
  await assert.rejects(cancelled.next(), { name: 'AbortError' });
});
it('poisons later memory operations after record or total capacity failure', async () => {
  const record = event('界限'), size = Buffer.byteLength(JSON.stringify(record) + '\n');
  const small = new MemorySessionStore({ recordBytes: size - 1 });
  await assert.rejects(small.append(record), /capacity/); await assert.rejects(small.read(), /capacity/);
  const total = new MemorySessionStore({ bytes: size }); await total.append(record);
  await assert.rejects(total.append(record), /capacity/); await assert.rejects(total.append(event('later')), /capacity/);
  assert.deepEqual(await new MemorySessionStore().read(), []);
});
