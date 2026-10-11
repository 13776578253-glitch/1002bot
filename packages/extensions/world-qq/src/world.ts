/** QQ World owns durable perception and explicit effects; Runtime owns all model execution. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Event, JsonObject, ToolCall, ToolDefinition, ToolExecutionContext, ToolOutcome, World, WorldDeliveryPort } from '1002bot/protocol';
import { nativeKey, messageId, object, validateConfig, type QQConfig, type QQDiagnostic, type QQLimits } from './config.ts';
import { OneBotConnection, RequestFailure } from './driver.ts';
import { QQJournal } from './journal.ts';
import { fingerprint, normalize, type MessageSnapshot } from './normalize.ts';

export class QQWorld implements World {
  readonly id: string;
  readonly stream: { streamId: string; epoch: string };
  readonly limits: QQLimits;
  private readonly config: QQConfig;
  private readonly journal: QQJournal;
  private connection: OneBotConnection | undefined;
  private running = false;
  private sourceStopped = false;
  private lastDiagnostic: QQDiagnostic | undefined;
  private controller = new AbortController();
  private captureTail: Promise<void> = Promise.resolve();
  private early: unknown[] = [];
  private bufferedBytes = 0;
  private bufferedEntries = 0;
  private peakBytes = 0;
  private peakEntries = 0;
  private subscription: { port: WorldDeliveryPort; controller: AbortController; task: Promise<void> } | undefined;
  private readonly tasks = new Set<Promise<unknown>>();
  private activeTools = 0;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  constructor(config: QQConfig) {
    this.limits = validateConfig(config);
    this.config = { ...config, binding: { sessionId: config.binding.sessionId, worldId: config.binding.worldId,
      streamId: config.binding.streamId, epoch: config.binding.epoch, accountId: config.binding.accountId, conversation: { ...config.binding.conversation } } };
    this.id = config.binding.worldId; this.stream = { streamId: config.binding.streamId, epoch: config.binding.epoch };
    this.journal = new QQJournal(config.journalPath, this.config.binding, this.limits);
  }
  inspect() { return { running: this.running, connected: this.connection?.connected ?? false, sourceStopped: this.sourceStopped,
    sequence: this.journal.sequence, savedPrefix: this.journal.saved, journalBytes: this.journal.bytes,
    bufferedEntries: this.bufferedEntries, bufferedBytes: this.bufferedBytes, peakEntries: this.peakEntries, peakBytes: this.peakBytes,
    diagnostic: this.lastDiagnostic }; }
  start(signal: AbortSignal): Promise<void> {
    if (this.running || this.starting || this.stopping) return Promise.reject(new Error('QQ World lifecycle is busy'));
    signal.throwIfAborted();
    this.controller = new AbortController(); this.sourceStopped = false; this.running = true;
    const task = this.open(AbortSignal.any([signal, this.controller.signal]));
    this.starting = task;
    return task.finally(() => { if (this.starting === task) this.starting = undefined; });
  }
  private async open(signal: AbortSignal): Promise<void> {
    try {
      await this.journal.start(signal);
      signal.throwIfAborted();
      this.connection = new OneBotConnection(this.config, this.limits, (raw, ready) => this.enqueue(raw, ready), async () => {
        for (const raw of this.early.splice(0)) this.scheduleCapture(raw);
        await this.captureTail;
        if (this.sourceStopped) throw new Error('QQ source stopped during startup');
      }, () => this.clearEarly(), (code, message) => this.diagnose(code, message));
      await this.connection.start(AbortSignal.any([signal, this.controller.signal]));
    } catch (error) {
      this.running = false; this.controller.abort();
      await this.releaseResources(); throw error;
    }
  }
  private enqueue(raw: unknown, ready: boolean): void {
    if (!this.running || this.sourceStopped || !object(raw) || !['message', 'message_sent'].includes(String(raw.post_type))) return;
    if (raw.post_type === 'message_sent') return;
    const bytes = Buffer.byteLength(JSON.stringify(raw));
    if (this.bufferedEntries + 1 > this.limits.bufferEntries || this.bufferedBytes + bytes > this.limits.bufferBytes) { this.fatal('capture_capacity', 'QQ capture buffer reached capacity'); return; }
    this.bufferedEntries++; this.bufferedBytes += bytes;
    this.peakEntries = Math.max(this.peakEntries, this.bufferedEntries); this.peakBytes = Math.max(this.peakBytes, this.bufferedBytes);
    if (ready) this.scheduleCapture(raw); else this.early.push(raw);
  }
  private clearEarly(): void {
    for (const raw of this.early) { this.bufferedEntries--; this.bufferedBytes -= Buffer.byteLength(JSON.stringify(raw)); }
    this.early = [];
  }
  private scheduleCapture(raw: unknown): void {
    this.captureTail = this.captureTail.then(async () => {
      try {
        if (!this.running || this.sourceStopped) return;
        const message = normalize(raw, this.config.binding, this.limits);
        if (!message) return;
        await this.journal.exclusive(async () => {
          const key = nativeKey(this.config.binding, message.messageId);
          const original = await this.journal.findMessage(key);
          if (original) {
            if (fingerprint(original) !== fingerprint(message)) this.fatal('native_identity_conflict', 'Native QQ key maps to different facts');
            return;
          }
          const event: Event = { id: key, type: 'qq.message', source: this.id,
            occurredAt: new Date(message.nativeTime! * 1000).toISOString(), payload: message };
          if (Buffer.byteLength(JSON.stringify(event)) > this.limits.eventBytes) { this.diagnose('event_capacity', 'QQ message exceeds eventBytes; rejected before sequence allocation'); return; }
          const delivery = { ...this.stream, sequence: this.journal.sequence + 1, event };
          await this.journal.append({ kind: 'received', key, message, delivery }, true);
          this.journal.sequence = delivery.sequence;
        });
      } catch (error) { this.fatal('capture_failed', error instanceof Error ? error.message : String(error)); }
      finally { this.bufferedEntries--; this.bufferedBytes -= Buffer.byteLength(JSON.stringify(raw)); }
    });
  }
  subscribeDeliveries(port: WorldDeliveryPort): () => void {
    if (!this.running || this.subscription) throw new Error('QQ delivery subscription is unavailable');
    const controller = new AbortController();
    const subscription = { port, controller, task: Promise.resolve() };
    this.subscription = subscription;
    subscription.task = this.pump(port, AbortSignal.any([controller.signal, this.controller.signal])).catch(error => {
      if (!controller.signal.aborted && !this.controller.signal.aborted) this.fatal('delivery_failed', error instanceof Error ? error.message : String(error));
    });
    this.track(subscription.task);
    return () => { controller.abort(); if (this.subscription === subscription) this.subscription = undefined; };
  }
  private async pump(port: WorldDeliveryPort, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if (this.journal.saved < this.journal.sequence) {
        const delivery = await this.journal.delivery(this.journal.saved + 1);
        if (!delivery) throw new Error('Missing original QQ envelope');
        if (signal.aborted) return;
        let receipt;
        try { receipt = await interruptible(port.submit(delivery), signal); }
        catch (error) {
          if (signal.aborted) return;
          this.diagnose('delivery_retry', error instanceof Error ? error.message : String(error));
          try { await delay(this.limits.retryMs, undefined, { signal }); } catch { return; }
          continue;
        }
        if (signal.aborted) return;
        if (receipt.status !== 'rejected') {
          // accepted 只释放 Runtime 受理权；World 的保存前缀由真实保存证明推进。
          try { await interruptible(port.waitSaved(delivery), signal); }
          catch (error) {
            if (signal.aborted) return;
            this.diagnose('saving_retry', error instanceof Error ? error.message : String(error));
            try { await delay(this.limits.retryMs, undefined, { signal }); } catch { return; }
            continue;
          }
          if (signal.aborted) return;
          const prefix = port.progress(this.stream.streamId).receivedPrefix;
          if (prefix < delivery.sequence || prefix > this.journal.sequence) throw new Error('Invalid Runtime received prefix');
          await this.journal.append({ kind: 'saved', sequence: prefix }); this.journal.saved = prefix;
          continue;
        }
        if (!['queue_full', 'delivery_window_full', 'sequence_gap'].includes(receipt.code)) {
          this.diagnose('delivery_rejected', `${receipt.code}: ${receipt.message}`); return;
        }
      }
      try { await delay(this.limits.retryMs, undefined, { signal }); } catch { return; }
    }
  }
  tools(): readonly ToolDefinition[] { return [
    { name: 'qq.get_message', description: '查询当前固定会话中已捕获或确认发送的消息。本地快照注明观察时间；fresh 要求远端充分证明消息归属。',
      inputSchema: { type: 'object', properties: { message_id: { type: 'integer', minimum: -2147483648, maximum: 2147483647 }, fresh: { type: 'boolean' } }, required: ['message_id'], additionalProperties: false } },
    { name: 'qq.send_text', description: '发送纯文本到配置授权的固定 QQ 会话。成功仅为协议确认；unknown 表示效果不明，不得重发。',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
  ]; }
  executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
    if (this.activeTools >= this.limits.pendingActions) return Promise.resolve({ callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'tools_busy', message: 'QQ tool concurrency capacity reached' } });
    this.activeTools++;
    const task = this.execute(call, context).finally(() => { this.activeTools--; }); this.track(task); return task;
  }
  private track(task: Promise<unknown>): void { this.tasks.add(task); void task.finally(() => this.tasks.delete(task)).catch(() => undefined); }
  private async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
    const outcome = (status: ToolOutcome['status'], code: string, message: string): ToolOutcome => ({ callId: call.callId, toolName: call.toolName, status, error: { code, message } });
    if (!this.running || this.sourceStopped) return outcome('failed', 'world_unavailable', 'QQ World is stopped or blocked');
    const signal = AbortSignal.any([context.signal, this.controller.signal]);
    let args: unknown;
    try { args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments; } catch { return outcome('failed', 'invalid_arguments', 'Expected a JSON object'); }
    if (!object(args)) return outcome('failed', 'invalid_arguments', 'Expected an object');
    if (signal.aborted) return outcome('cancelled', 'cancelled', 'Tool cancelled before submission');
    if (call.toolName === 'qq.get_message') {
      if (!messageId(args.message_id) || Object.keys(args).some(key => !['message_id', 'fresh'].includes(key)) || args.fresh !== undefined && typeof args.fresh !== 'boolean') return outcome('failed', 'invalid_arguments', 'Expected message_id and optional fresh');
      try {
        const known = await this.journal.findMessage(nativeKey(this.config.binding, args.message_id));
        if (!known) return outcome('failed', 'unknown_message', 'Message is not bound to this World conversation');
        if (!args.fresh) return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: { source: 'local_snapshot', fresh: false, observedAt: known.observedAt, message: known } };
        const response = await this.connection!.request('get_msg', { message_id: args.message_id }, randomUUID(), signal);
        const data = response.data;
        // 哈希消息号和旧绑定不足以证明远端身份；要求账号、会话、时间及发送者同时匹配。
        if (response.status !== 'ok' || response.retcode !== 0 || !object(data) || data.self_id !== known.accountId || data.message_id !== known.messageId ||
          data.message_type !== known.conversation.kind || (known.conversation.kind === 'group' ? data.group_id : data.user_id) !== known.conversation.id ||
          data.time !== known.nativeTime || (data.user_id ?? (object(data.sender) ? data.sender.user_id : undefined)) !== known.senderId) return outcome('failed', 'unproven_message', 'Remote response does not prove account, conversation and original identity; use local snapshot');
        const message = normalize({ ...data, post_type: 'message' }, this.config.binding, this.limits);
        if (!message || fingerprint(message) !== fingerprint(known)) return outcome('failed', 'unproven_message', 'Remote content does not match captured message');
        return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: { source: 'onebot_get_msg', fresh: true, observedAt: message.observedAt, message } };
      } catch (error) { return outcome('failed', 'query_failed', error instanceof Error ? error.message : String(error)); }
    }
    if (call.toolName !== 'qq.send_text') return outcome('failed', 'unknown_tool', 'Unknown QQ tool');
    if (Object.keys(args).some(key => key !== 'text') || typeof args.text !== 'string' || !args.text.trim() || Buffer.byteLength(args.text) > this.limits.textBytes) return outcome('failed', 'invalid_text', 'Expected bounded nonempty plain text');
    const text = args.text, operationId = randomUUID();
    try { await this.journal.append({ kind: 'intent', operationId, callId: call.callId, text, at: new Date().toISOString() }, true); }
    catch (error) { this.fatal('intent_failed', String(error)); return outcome('failed', 'intent_failed', 'Send intent was not persisted; no external request submitted'); }
    let result: ToolOutcome, message: MessageSnapshot | undefined;
    let evidence: JsonObject = {};
    try {
      const target = this.config.binding.conversation;
      const response = await this.connection!.request(target.kind === 'group' ? 'send_group_msg' : 'send_private_msg',
        { [target.kind === 'group' ? 'group_id' : 'user_id']: target.id, message: [{ type: 'text', data: { text } }] }, operationId, signal);
      const rawId = object(response.data) ? response.data.message_id : undefined;
      evidence = { submitted: true, status: typeof response.status === 'string' ? response.status.slice(0, 64) : null,
        retcode: typeof response.retcode === 'number' && Number.isFinite(response.retcode) ? response.retcode : null,
        messageId: typeof rawId === 'number' && Number.isFinite(rawId) ? rawId : typeof rawId === 'string' ? rawId.slice(0, 64) : null };
      if (response.status !== 'ok' || response.retcode !== 0 || !object(response.data) || !messageId(response.data.message_id)) result = outcome('unknown', 'unconfirmed_send', 'Submitted send has no complete synchronous confirmation');
      else {
        const id = response.data.message_id;
        message = { accountId: this.config.binding.accountId, conversation: { ...target }, messageId: id, nativeTime: null,
          senderId: this.config.binding.accountId, text, mentions: [], references: [], unsupported: [], metadataTruncated: false, observedAt: new Date().toISOString() };
        result = { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: { operationId, messageId: id, confirmation: 'onebot_sync', observedAt: message.observedAt } };
      }
    } catch (error) {
      if (error instanceof RequestFailure) evidence = { submitted: error.submitted };
      result = outcome(error instanceof RequestFailure && !error.submitted ? signal.aborted ? 'cancelled' : 'failed' : 'unknown', 'send_unconfirmed', error instanceof Error ? error.message : String(error));
    }
    result.output = { ...(object(result.output) ? result.output : {}), operationId, evidence };
    try { await this.journal.commitResult({ kind: 'result', operationId, outcome: result, ...(message ? { message } : {}) }); }
    catch (error) {
      const unconfirmed = { ...outcome('unknown', 'confirmation_failed', 'Possible send; confirmation record failed'), output: { operationId, evidence } };
      await this.journal.append({ kind: 'result', operationId, outcome: unconfirmed }).catch(() => undefined);
      this.fatal('confirmation_failed', error instanceof Error ? error.message : String(error)); return unconfirmed;
    }
    if (result.status === 'unknown') this.fatal('unknown_send', 'QQ send effect is unknown; inspect operation record before continuing');
    return result;
  }
  private diagnose(code: string, message: string): void {
    this.lastDiagnostic = { code, message: message.slice(0, 1024), at: new Date().toISOString() };
    try { this.config.onDiagnostic?.(this.lastDiagnostic); } catch { /* Diagnostics do not own transport cleanup. */ }
  }
  private fatal(code: string, message: string): void {
    this.sourceStopped = true; this.diagnose(code, message); this.connection?.halt();
    const diagnostic = this.lastDiagnostic!;
    this.track(this.journal.append({ kind: 'diagnostic', ...diagnostic }).catch(() => undefined));
  }
  async stop(signal: AbortSignal): Promise<void> {
    this.running = false; this.controller.abort(); this.subscription?.controller.abort(); this.subscription = undefined;
    this.connection?.halt();
    if (!this.stopping) {
      const starting = this.starting;
      const cleanup = (async () => { await starting?.catch(() => undefined); await this.releaseResources(); })();
      this.stopping = cleanup;
      void cleanup.finally(() => { if (this.stopping === cleanup) this.stopping = undefined; }).catch(() => undefined);
    }
    const cleanup = this.stopping;
    try { await interruptible(cleanup, AbortSignal.any([signal, AbortSignal.timeout(this.limits.cleanupMs)])); }
    catch (error) { this.diagnose('cleanup_timeout', 'QQ cleanup wait ended; underlying cleanup continues'); throw error; }
  }
  private async releaseResources(): Promise<void> {
    this.clearEarly();
    const connection = this.connection; this.connection = undefined;
    await connection?.stop(); await this.captureTail; await Promise.allSettled([...this.tasks]); await this.journal.close();
  }
}

async function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => { abort = () => reject(new Error('QQ operation wait cancelled')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}
