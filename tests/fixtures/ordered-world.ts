/** Offline World owns a persistent producer journal before delivering stable envelopes to Runtime. */
import { appendFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import type { Event, WorldDelivery, WorldDeliveryPort, WorldStream } from '../../src/protocol/index.ts';
import { FixtureWorld } from './fixture-world.ts';

type Row = { kind: 'bound'; sessionId: string; streamId: string; epoch: string }
  | { kind: 'prepared'; delivery: WorldDelivery } | { kind: 'saved'; sequence: number };
export class OrderedFixtureWorld extends FixtureWorld {
  readonly ports: WorldDeliveryPort[] = [];
  private readonly pending = new Map<number, WorldDelivery>();
  private sequence = 0;
  private confirmed = 0;
  private port: WorldDeliveryPort | undefined;
  private readonly journal: string;
  readonly stream: WorldStream;
  private readonly sessionId: string;
  private readonly capacity: number;
  constructor(journal: string, stream: WorldStream, sessionId: string, capacity = 16) {
    super(); this.journal = journal; this.stream = stream; this.sessionId = sessionId; this.capacity = capacity;
  }
  override async start(signal?: AbortSignal): Promise<void> {
    this.pending.clear(); this.sequence = 0; this.confirmed = 0;
    let bound = false;
    for await (const row of this.rows()) {
      signal?.throwIfAborted();
      if (row.kind === 'bound') {
        if (bound || row.sessionId !== this.sessionId || row.streamId !== this.stream.streamId || row.epoch !== this.stream.epoch) throw new Error('Producer binding changed');
        bound = true;
      } else if (row.kind === 'prepared') {
        if (!bound || row.delivery.sequence !== this.sequence + 1) throw new Error('Producer sequence is not contiguous');
        this.sequence = row.delivery.sequence; this.pending.set(this.sequence, row.delivery);
      } else {
        if (row.sequence < this.confirmed || row.sequence > this.sequence) throw new Error('Producer saved prefix is invalid');
        this.confirmed = row.sequence;
        for (const sequence of this.pending.keys()) if (sequence <= this.confirmed) this.pending.delete(sequence);
      }
      if (this.pending.size > this.capacity) throw new Error('Producer buffer reached capacity');
    }
    if (!bound) await this.append({ kind: 'bound', sessionId: this.sessionId, ...this.stream });
    signal?.throwIfAborted();
    await super.start();
  }
  subscribeDeliveries(port: WorldDeliveryPort): () => void { this.port = port; this.ports.push(port); return () => { if (this.port === port) this.port = undefined; }; }
  get producerProgress() { return { sequence: this.sequence, saved: this.confirmed, pending: this.pending.size }; }
  async prepare(event: Event): Promise<WorldDelivery> {
    if (this.pending.size >= this.capacity) throw new Error('Producer buffer reached capacity');
    const delivery = { ...this.stream, sequence: this.sequence + 1, event: structuredClone(event) };
    await this.append({ kind: 'prepared', delivery });
    this.sequence = delivery.sequence; this.pending.set(this.sequence, delivery);
    return structuredClone(delivery);
  }
  async send(delivery: WorldDelivery) {
    if (!this.port) throw new Error('Producer is not subscribed');
    const receipt = await this.port.submit(delivery);
    if (receipt.status !== 'rejected') {
      await this.port.waitSaved(delivery);
      // 来源只推进连续保存前缀；Runtime 查询提供确认依据，不凭 accepted 释放事实。
      const prefix = this.port.progress(this.stream.streamId).receivedPrefix;
      if (prefix > this.confirmed) {
        await this.append({ kind: 'saved', sequence: prefix }); this.confirmed = prefix;
        for (const sequence of this.pending.keys()) if (sequence <= prefix) this.pending.delete(sequence);
      }
    }
    return receipt;
  }
  async original(sequence: number): Promise<WorldDelivery> {
    for await (const row of this.rows()) if (row.kind === 'prepared' && row.delivery.sequence === sequence) return row.delivery;
    throw new Error('Producer fact not found');
  }
  private async append(row: Row): Promise<void> { await mkdir(dirname(this.journal), { recursive: true }); await appendFile(this.journal, JSON.stringify(row) + '\n', 'utf8'); }
  private async *rows(): AsyncIterable<Row> {
    const stream = createReadStream(this.journal, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try { for await (const line of lines) if (line) yield JSON.parse(line) as Row; }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    finally { lines.close(); stream.destroy(); }
  }
}
