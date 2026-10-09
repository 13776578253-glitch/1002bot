/** Source progress is a projection of confirmed Session facts, with a bounded uncompacted suffix. */
import type { DeliveryLimits, SessionEntry, WorldDelivery, WorldDeliveryIdentity, WorldProgress, WorldReceipt, WorldStream } from '../protocol/index.ts';
import { InputError, STANDARD_DELIVERY_LIMITS, worldTriggerId } from '../protocol/index.ts';
import { createHash } from 'node:crypto';

interface Slot {
  digest: string;
  eventDigest: string;
  settled: boolean;
  saved: Promise<WorldDeliveryIdentity>;
  resolve(value: WorldDeliveryIdentity): void;
  reject(error: unknown): void;
}
interface Stream extends WorldStream { registered: boolean; admitted: number; received: number; settled: number; slots: Map<number, Slot> }
export class WorldDeliveryState {
  readonly limits: DeliveryLimits;
  readonly worldId: string;
  readonly sessionId: string;
  private readonly streams = new Map<string, Stream>();
  constructor(worldId: string, sessionId: string, declarations: readonly WorldStream[], limits: Partial<DeliveryLimits> = {}) {
    this.worldId = worldId; this.sessionId = sessionId;
    this.limits = Object.freeze({ ...STANDARD_DELIVERY_LIMITS, ...limits });
    for (const [name, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid delivery ${name}`);
    if (!label(worldId) || !sessionId.trim()) throw new Error('Invalid World/Session binding');
    if (declarations.length > this.limits.streams) throw new Error('World stream capacity reached');
    for (const declaration of declarations) {
      if (!label(declaration.streamId) || !label(declaration.epoch) || this.streams.has(declaration.streamId)) throw new Error('Invalid or duplicate World stream');
      this.streams.set(declaration.streamId, { streamId: declaration.streamId, epoch: declaration.epoch, registered: false, admitted: 0, received: 0, settled: 0, slots: new Map() });
    }
  }
  get ordered(): boolean { return this.streams.size > 0; }
  get positions(): number { return [...this.streams.values()].reduce((sum, stream) => sum + stream.slots.size, 0); }
  registrations(): SessionEntry[] {
    return [...this.streams.values()].filter(stream => !stream.registered).map(stream => ({ kind: 'world_stream_registered', at: new Date().toISOString(), schema: 1,
      sessionId: this.sessionId, worldId: this.worldId, streamId: stream.streamId, epoch: stream.epoch }));
  }
  assess(delivery: WorldDelivery): WorldReceipt | undefined {
    const identity = this.identity(delivery);
    const triggerId = worldTriggerId(identity);
    const reject = (code: string, message: string, expectedSequence?: number): WorldReceipt => ({ status: 'rejected', triggerId, code, message, ...(expectedSequence !== undefined ? { expectedSequence } : {}) });
    const stream = this.streams.get(delivery.streamId);
    if (!stream?.registered) return reject('unregistered_stream', 'World stream is not registered');
    if (delivery.epoch !== stream.epoch) return reject('epoch_mismatch', 'World epoch does not match its registered stream');
    if (!Number.isSafeInteger(delivery.sequence) || delivery.sequence < 1) return reject('invalid_sequence', 'Expected a positive safe sequence');
    if (delivery.sequence <= stream.admitted) {
      const slot = stream.slots.get(delivery.sequence);
      if (slot && slot.digest !== digest(delivery)) return reject('delivery_conflict', 'Delivery identity has different facts or validity');
      return { status: 'duplicate', triggerId, stage: delivery.sequence <= stream.settled || slot?.settled ? 'settled' : delivery.sequence <= stream.received ? 'saved' : 'admitted' };
    }
    if (delivery.sequence !== stream.admitted + 1) return reject('sequence_gap', 'World sequence must be contiguous', stream.admitted + 1);
    if (this.positions >= this.limits.positions) return reject('delivery_window_full', 'World uncompacted positions reached capacity');
    return undefined;
  }
  identity(delivery: WorldStream & { sequence: number }): WorldDeliveryIdentity { return { worldId: this.worldId, streamId: delivery.streamId, epoch: delivery.epoch, sequence: delivery.sequence }; }
  reserve(delivery: WorldDelivery): void {
    const stream = this.streams.get(delivery.streamId)!;
    stream.admitted = delivery.sequence;
    stream.slots.set(delivery.sequence, makeSlot(delivery));
  }
  fail(identity: WorldDeliveryIdentity, error: unknown): void { this.streams.get(identity.streamId)?.slots.get(identity.sequence)?.reject(error); }
  waitSaved(identity: WorldStream & { sequence: number }): Promise<WorldDeliveryIdentity> {
    const stream = this.streams.get(identity.streamId);
    if (!stream?.registered || stream.epoch !== identity.epoch || !Number.isSafeInteger(identity.sequence) || identity.sequence < 1) return Promise.reject(new InputError('invalid_delivery', 'Saved query does not name a registered identity'));
    if (identity.sequence <= stream.received) return Promise.resolve(this.identity(identity));
    const slot = stream.slots.get(identity.sequence);
    return slot?.saved ?? Promise.reject(new InputError('not_admitted', 'Delivery has not been admitted'));
  }
  progress(streamId: string, accepting: boolean): WorldProgress {
    const stream = this.streams.get(streamId);
    if (!stream) throw new InputError('unregistered_stream', 'World stream is not declared');
    return { worldId: this.worldId, streamId, epoch: stream.epoch, admittedTail: stream.admitted, receivedPrefix: stream.received,
      settledPrefix: stream.settled, nextExpectedSequence: stream.admitted < Number.MAX_SAFE_INTEGER ? stream.admitted + 1 : null,
      uncompacted: stream.slots.size, accepting: accepting && stream.registered };
  }
  /** 同一方法供启动扫描和确认后增量投影使用；不能先于 Session.append 成功调用。 */
  observe(entry: SessionEntry): void {
    if (entry.kind === 'world_stream_registered') {
      const stream = this.streams.get(entry.streamId);
      if (entry.schema !== 1 || entry.sessionId !== this.sessionId || entry.worldId !== this.worldId || !stream || stream.epoch !== entry.epoch || stream.registered) throw new InputError('stream_binding', 'Saved World registration conflicts with composition');
      stream.registered = true; return;
    }
    if (!entry.delivery) {
      if (entry.kind === 'trigger_received' && entry.trigger.kind === 'world_event' && 'delivery' in entry.trigger) throw new InputError('delivery_record', 'Ordered receipt lacks its association');
      return;
    }
    const identity = entry.delivery;
    const stream = this.streams.get(identity.streamId);
    if (!stream?.registered || identity.worldId !== this.worldId || identity.epoch !== stream.epoch || !Number.isSafeInteger(identity.sequence) || identity.sequence < 1 || entry.triggerKind !== 'world_event' || entry.triggerId !== worldTriggerId(identity)) throw new InputError('delivery_record', 'Saved delivery does not match its registered stream');
    if (entry.kind === 'trigger_received') {
      if (entry.trigger.kind !== 'world_event' || !('delivery' in entry.trigger) || worldTriggerId(entry.trigger.delivery) !== worldTriggerId(identity) || identity.sequence !== stream.received + 1) throw new InputError('delivery_record', 'Saved receipt has a gap or conflicting identity');
      let slot = stream.slots.get(identity.sequence);
      if (!slot) {
        if (this.positions >= this.limits.positions) throw new InputError('recovery_capacity', 'Saved World suffix exceeds declared capacity');
        const delivery: WorldDelivery = { streamId: identity.streamId, epoch: identity.epoch, sequence: identity.sequence, event: entry.trigger.event,
          ...(entry.trigger.expiresAt !== undefined ? { expiresAt: entry.trigger.expiresAt } : {}) };
        slot = makeSlot(delivery); stream.slots.set(identity.sequence, slot);
      }
      if (slot.eventDigest !== fingerprint(entry.trigger.event)) throw new InputError('delivery_conflict', 'Confirmed receipt changed its admitted facts');
      stream.admitted = Math.max(stream.admitted, identity.sequence);
      stream.received = identity.sequence; slot.resolve(identity);
    } else if (entry.kind === 'run_finished') {
      const slot = stream.slots.get(identity.sequence);
      if (!slot || slot.settled || identity.sequence > stream.received) throw new InputError('delivery_record', 'Terminal has no unsettled saved receipt');
      slot.settled = true;
      // 后项已终态确认也保留名额，直到较早项结清使连续前缀越过它。
      while (stream.slots.get(stream.settled + 1)?.settled) stream.slots.delete(++stream.settled);
    } else {
      const slot = stream.slots.get(identity.sequence);
      if (identity.sequence <= stream.settled || !slot) throw new InputError('delivery_record', 'Execution appears outside its unsettled receipt');
      if (entry.kind === 'event' && slot.eventDigest !== fingerprint(entry.event)) throw new InputError('delivery_conflict', 'Execution facts differ from the saved receipt');
    }
  }
}
function makeSlot(value: WorldDelivery): Slot {
  let resolve!: Slot['resolve'], reject!: Slot['reject'];
  const saved = new Promise<WorldDeliveryIdentity>((yes, no) => { resolve = yes; reject = no; });
  void saved.catch(() => undefined);
  return { digest: digest(value), eventDigest: fingerprint(value.event), settled: false, saved, resolve, reject };
}
function digest(value: WorldDelivery): string {
  return fingerprint([value.event, value.expiresAt ?? null]);
}
function fingerprint(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
  return createHash('sha256').update(canonical).digest('hex');
}
function label(value: string): boolean { return typeof value === 'string' && !!value.trim() && Buffer.byteLength(value) <= 128; }
