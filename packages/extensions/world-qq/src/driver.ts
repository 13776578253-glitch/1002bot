/** OneBot transport correlates independent echoes; reconnection never replays actions. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { object, type QQConfig, type QQLimits } from './config.ts';

export class RequestFailure extends Error {
  readonly submitted: boolean;
  constructor(message: string, submitted: boolean) { super(message); this.submitted = submitted; }
}
interface Pending { finish: (value: Record<string, unknown> | RequestFailure) => void }
export class OneBotConnection {
  private socket: WebSocket | undefined;
  private readonly controller = new AbortController();
  private loop: Promise<void> | undefined;
  private readonly pending = new Map<string, Pending>();
  private identified = false;
  private firstReady: (() => void) | undefined;
  private readonly config: QQConfig;
  private readonly limits: QQLimits;
  private readonly event: (raw: unknown, identified: boolean) => void;
  private readonly ready: () => Promise<void>;
  private readonly disconnected: () => void;
  private readonly diagnostic: (code: string, message: string) => void;
  constructor(config: QQConfig, limits: QQLimits,
    event: (raw: unknown, identified: boolean) => void,
    ready: () => Promise<void>, disconnected: () => void,
    diagnostic: (code: string, message: string) => void) {
    this.config = config; this.limits = limits; this.event = event;
    this.ready = ready; this.disconnected = disconnected; this.diagnostic = diagnostic;
  }
  get connected(): boolean { return this.identified && this.socket?.readyState === WebSocket.OPEN; }
  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const ready = new Promise<void>(resolve => { this.firstReady = resolve; });
    this.loop = this.run();
    const timed = AbortSignal.any([signal, this.controller.signal, AbortSignal.timeout(this.limits.startMs)]);
    const abort = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error('QQ connection startup cancelled or timed out'));
      timed.addEventListener('abort', onAbort, { once: true });
      ready.finally(() => timed.removeEventListener('abort', onAbort)).catch(() => undefined);
    });
    try { await Promise.race([ready, abort]); }
    catch (error) { await this.stop(); throw error; }
  }
  private async run(): Promise<void> {
    const signal = this.controller.signal;
    while (!signal.aborted) {
      try { await this.cycle(signal); }
      catch (error) { if (!signal.aborted) this.diagnostic('connection_unavailable', error instanceof Error ? error.message : String(error)); }
      if (!signal.aborted) try { await delay(this.limits.reconnectMs, undefined, { signal }); } catch { break; }
    }
  }
  private async cycle(signal: AbortSignal): Promise<void> {
    const ws = new WebSocket(this.config.endpoint, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
      maxPayload: this.limits.frameBytes, handshakeTimeout: this.limits.connectMs, perMessageDeflate: false,
    });
    this.socket = ws; this.identified = false;
    let lastFrame = Date.now();
    const closed = new Promise<void>(resolve => ws.once('close', () => {
      if (!signal.aborted) this.diagnostic('connection_closed', 'OneBot connection closed; inbound pushes during the gap may be lost');
      this.identified = false; this.failPending('OneBot disconnected'); this.disconnected(); resolve();
    }));
    const abort = () => ws.terminate();
    signal.addEventListener('abort', abort, { once: true });
    ws.on('error', () => { if (!signal.aborted) this.diagnostic('transport_error', 'OneBot transport failed or a frame exceeded maxPayload'); });
    ws.on('pong', () => { lastFrame = Date.now(); });
    ws.on('ping', () => { lastFrame = Date.now(); });
    ws.on('message', (bytes, binary) => {
      lastFrame = Date.now();
      try {
        if (binary) throw new Error('OneBot binary frame is unsupported');
        const raw: unknown = JSON.parse(bytes.toString());
        if (!object(raw)) throw new Error('Malformed OneBot frame');
        if (typeof raw.echo === 'string') this.pending.get(raw.echo)?.finish(raw);
        else if (typeof raw.post_type === 'string') this.event(raw, this.identified);
      } catch (error) { this.diagnostic('protocol_error', error instanceof Error ? error.message : String(error)); ws.terminate(); }
    });
    const idle = setInterval(() => { if (Date.now() - lastFrame > this.limits.idleMs) ws.terminate(); }, Math.min(this.limits.idleMs, 1000));
    try {
      await new Promise<void>((resolve, reject) => {
        const open = () => { cleanup(); resolve(); };
        const error = () => { cleanup(); reject(new Error('OneBot handshake failed')); };
        const cleanup = () => { ws.off('open', open); ws.off('error', error); ws.off('close', error); };
        ws.once('open', open); ws.once('error', error); ws.once('close', error);
      });
      const login = await this.request('get_login_info', {}, randomUUID(), signal, true);
      if (login.status !== 'ok' || login.retcode !== 0 || !object(login.data) || login.data.user_id !== this.config.binding.accountId) throw new Error('OneBot login account does not match QQ binding');
      if (signal.aborted || ws.readyState !== WebSocket.OPEN) throw new Error('OneBot closed during account confirmation');
      this.identified = true;
      await this.ready();
      this.firstReady?.(); this.firstReady = undefined;
      await closed;
    } finally {
      clearInterval(idle); signal.removeEventListener('abort', abort);
      ws.terminate(); await closed;
      if (this.socket === ws) this.socket = undefined;
    }
  }
  request(action: string, params: Record<string, unknown>, echo: string, signal: AbortSignal, login = false): Promise<Record<string, unknown>> {
    if (signal.aborted) return Promise.reject(new RequestFailure('Request cancelled before submission', false));
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || !login && !this.identified || this.pending.size >= this.limits.pendingActions) return Promise.reject(new RequestFailure('OneBot is unavailable or busy', false));
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (value: Record<string, unknown> | RequestFailure) => {
        if (finished) return; finished = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort); this.pending.delete(echo);
        if (value instanceof RequestFailure) reject(value); else resolve(value);
      };
      const abort = () => finish(new RequestFailure('Request cancelled after submission', true));
      const timer = setTimeout(() => finish(new RequestFailure('OneBot response deadline reached', true)), this.limits.apiMs);
      this.pending.set(echo, { finish }); signal.addEventListener('abort', abort, { once: true });
      try { ws.send(JSON.stringify({ action, params, echo }), error => { if (error) finish(new RequestFailure('OneBot send failed after submission', true)); }); }
      catch { finish(new RequestFailure('OneBot send failed after submission', true)); }
    });
  }
  private failPending(message: string): void { for (const pending of [...this.pending.values()]) pending.finish(new RequestFailure(message, true)); }
  halt(): void { this.controller.abort(); this.socket?.terminate(); this.failPending('QQ World stopped'); }
  async stop(): Promise<void> { this.halt(); await this.loop; }
}
