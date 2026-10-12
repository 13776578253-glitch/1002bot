/** File-backed World exposes controlled observation delays and a World-owned comparable version domain. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolOutcome, World, WorldEventSink } from '../../src/protocol/index.ts';

export interface Observation { entity: string; epoch: string; version: number; value: number }
function gate() {
  let finish!: () => void, done = false;
  const promise = new Promise<void>(yes => { finish = yes; });
  return { promise, resolve: () => { done = true; finish(); }, get done() { return done; } };
}
export class ResponseWorld implements World {
  readonly id = 'response-fixture';
  private sink: WorldEventSink | undefined;
  private readonly holds = new Map<string, { released: ReturnType<typeof gate>; started: ReturnType<typeof gate> }>();
  private readonly active = new Set<Promise<ToolOutcome>>();
  private latestValue: Observation | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  readonly path: string;
  readonly stopReleases: boolean;
  constructor(path: string, stopReleases = true) { this.path = path; this.stopReleases = stopReleases; }
  hold(label: string): void {
    if (this.holds.get(label) && !this.holds.get(label)!.released.done) throw new Error('Observation label is already pending');
    this.holds.set(label, { released: gate(), started: gate() });
  }
  entered(label: string): Promise<void> { return this.holds.get(label)!.started.promise; }
  hasEntered(label: string): boolean { return !!this.holds.get(label)?.started.done; }
  release(label: string): void { const hold = this.holds.get(label); hold?.released.resolve(); if (hold && !hold.started.done) this.holds.delete(label); }
  releaseAll(): void { for (const label of this.holds.keys()) this.release(label); }
  get latest(): Observation { return structuredClone(this.latestValue!); }
  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); await mkdir(dirname(this.path), { recursive: true });
    try { this.observe(JSON.parse(await readFile(this.path, 'utf8')) as Observation); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const value = { entity: 'answer', epoch: 'fixture-epoch', version: 0, value: 0 };
      await writeFile(this.path, JSON.stringify(value)); this.observe(value);
    }
  }
  async stop(): Promise<void> {
    this.sink = undefined;
    if (this.stopReleases) { this.releaseAll(); await Promise.allSettled([...this.active]); }
    await this.writes;
  }
  subscribeEvents(sink: WorldEventSink): () => void { this.sink = sink; return () => { if (this.sink === sink) this.sink = undefined; }; }
  tools(): readonly ToolDefinition[] { return [
    { name: 'fixture.observe', description: 'Read one versioned observation; a fixture label can delay the original response.', effects: 'none',
      inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } },
    { name: 'fixture.current', description: 'Read the current World file.', effects: 'none', inputSchema: { type: 'object', properties: {} } },
    { name: 'fixture.write', description: 'Write the World file before an optional delayed confirmation.', effects: 'external',
      inputSchema: { type: 'object', properties: { value: { type: 'number' }, label: { type: 'string' } }, required: ['value'] } },
  ]; }
  executeTool(call: ToolCall, _context: ToolExecutionContext): Promise<ToolOutcome> {
    const operation = this.perform(call); this.active.add(operation);
    void operation.then(() => this.active.delete(operation), () => this.active.delete(operation));
    return operation;
  }
  private async perform(call: ToolCall): Promise<ToolOutcome> {
    const args = call.arguments as { label?: string; value?: number };
    const observation = call.toolName === 'fixture.write' ? await this.update(args.value!) : JSON.parse(await readFile(this.path, 'utf8')) as Observation;
    const hold = args.label ? this.holds.get(args.label) : undefined;
    if (hold) { hold.started.resolve(); await hold.released.promise; if (this.holds.get(args.label!) === hold) this.holds.delete(args.label!); }
    this.observe(observation);
    return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: { observation: { ...observation } } };
  }
  private update(value: number): Promise<Observation> {
    const operation = this.writes.then(async () => {
      const old = JSON.parse(await readFile(this.path, 'utf8')) as Observation;
      const next = { ...old, version: old.version + 1, value };
      await writeFile(this.path, JSON.stringify(next)); this.observe(next); return next;
    });
    this.writes = operation; return operation;
  }
  async publish(value: number) {
    const observation = await this.update(value);
    return this.sink?.({ id: `observation-${observation.version}`, type: 'fixture.observation', source: this.id, occurredAt: new Date().toISOString(), payload: { ...observation } });
  }
  /** 比较限定在同实体/epoch；较旧主动结果不能覆盖已收到的被动事实。 */
  private observe(value: Observation): void {
    if (!this.latestValue || value.entity === this.latestValue.entity && value.epoch === this.latestValue.epoch && value.version >= this.latestValue.version) this.latestValue = structuredClone(value);
  }
}
