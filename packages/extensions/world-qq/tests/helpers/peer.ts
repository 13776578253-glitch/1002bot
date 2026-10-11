/** Local OneBot peer records actual WS requests and models stored messages and confirmed sends. */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { ConversationAgent, JsonlSessionStore, MemoryState, Runtime, ScriptedProvider, type Provider, type SessionStore } from '1002bot';
import type { TestContext } from 'node:test';
import type { WorldDeliveryPort } from '1002bot/protocol';
import { QQWorld, type QQConfig } from '../../src/index.ts';

export const binding = { worldId: 'qq', sessionId: 'qq-test', streamId: 'messages', epoch: 'test-epoch', accountId: 10001, conversation: { kind: 'group' as const, id: 20001 } };
export function message(id = -1, text = 'hello', overrides: Record<string, unknown> = {}) {
  return { post_type: 'message', self_id: binding.accountId, message_type: 'group', group_id: binding.conversation.id,
    message_id: id, user_id: 30001, time: 1791676800, message: [{ type: 'text', data: { text } }], ...overrides };
}
export interface Action { action: string; params: Record<string, unknown>; echo: string }
export class Peer {
  readonly server: WebSocketServer;
  readonly actions: Action[] = [];
  readonly messages = new Map<number, Record<string, unknown>>();
  endpoint = '';
  connections = 0;
  accountId = binding.accountId;
  beforeLogin: Record<string, unknown>[] = [];
  sendMode: 'ok' | 'lost' | 'async' | 'malformed' | 'disconnect' | 'failed' = 'ok';
  loginDelay = 0;
  holdQueries = false;
  readonly queries: { socket: WebSocket; action: Action }[] = [];
  private nextId = -100;
  constructor(port = 0) { this.server = new WebSocketServer({ host: '127.0.0.1', port }); }
  async start() {
    await new Promise<void>(resolve => this.server.once('listening', resolve));
    const address = this.server.address(); assert.ok(address && typeof address !== 'string');
    this.endpoint = `ws://127.0.0.1:${address.port}/`;
    this.server.on('connection', (socket, request) => {
      assert.equal(request.headers.authorization, 'Bearer test-token'); this.connections++;
      socket.on('message', bytes => {
        const action = JSON.parse(bytes.toString()) as Action; this.actions.push(action);
        if (action.action === 'get_login_info') {
          for (const raw of this.beforeLogin) socket.send(JSON.stringify(raw));
          if (this.loginDelay) setTimeout(() => { if (socket.readyState === WebSocket.OPEN) this.reply(socket, action, { user_id: this.accountId }); }, this.loginDelay);
          else this.reply(socket, action, { user_id: this.accountId });
        } else if (action.action === 'get_msg') {
          if (this.holdQueries) this.queries.push({ socket, action });
          else this.reply(socket, action, this.messages.get(Number(action.params.message_id)) ?? null);
        } else {
          assert.ok(['send_group_msg', 'send_private_msg'].includes(action.action));
          const id = this.nextId--;
          this.messages.set(id, { message_id: id, message: action.params.message });
          if (this.sendMode === 'lost') return;
          if (this.sendMode === 'disconnect') { socket.terminate(); return; }
          if (this.sendMode === 'async') socket.send(JSON.stringify({ echo: action.echo, status: 'async', retcode: 1, data: null }));
          else if (this.sendMode === 'failed') socket.send(JSON.stringify({ echo: action.echo, status: 'failed', retcode: 1500, data: null }));
          else this.reply(socket, action, this.sendMode === 'malformed' ? {} : { message_id: id });
        }
      });
    });
  }
  reply(socket: WebSocket, action: Action, data: unknown) { socket.send(JSON.stringify({ echo: action.echo, status: 'ok', retcode: 0, data })); }
  push(raw: Record<string, unknown>) {
    if (typeof raw.message_id === 'number') this.messages.set(raw.message_id, raw);
    for (const socket of this.server.clients) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(raw));
  }
  get sends() { return this.actions.filter(action => action.action.startsWith('send_')); }
  disconnect() { for (const socket of this.server.clients) socket.terminate(); }
  async close() { this.disconnect(); await new Promise<void>(resolve => this.server.close(() => resolve())); }
}
export const done = () => ({ finishReason: 'stop' as const, toolCalls: [], message: { role: 'assistant' as const, content: 'done' } });
export const context = (signal = new AbortController().signal) => ({ signal, generation: 1 });
export async function until(predicate: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!await predicate()) { if (Date.now() > end) throw new Error('Condition timed out'); await delay(5); }
}
export async function setup(t: TestContext, options: { provider?: Provider; limits?: QQConfig['limits']; directory?: string; wrapPort?: (port: WorldDeliveryPort) => WorldDeliveryPort; wrap?: (store: JsonlSessionStore) => SessionStore } = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'qq-test-'));
  const peer = new Peer(); await peer.start();
  t.after(() => peer.close());
  const config: QQConfig = { endpoint: peer.endpoint, accessToken: 'test-token', journalPath: join(directory, 'world.jsonl'), binding,
    limits: { apiMs: 100, retryMs: 10, reconnectMs: 20, startMs: 300, connectMs: 100, ...options.limits } };
  class InstrumentedWorld extends QQWorld {
    override subscribeDeliveries(port: WorldDeliveryPort) { return super.subscribeDeliveries(options.wrapPort ? options.wrapPort(port) : port); }
  }
  const world = new InstrumentedWorld(config), store = new JsonlSessionStore(join(directory, 'session.jsonl'));
  const runtime = new Runtime({ world, agent: new ConversationAgent({ sessionId: binding.sessionId }),
    session: options.wrap ? options.wrap(store) : store, state: new MemoryState(), provider: options.provider ?? new ScriptedProvider(() => done()),
    worldStreams: [world.stream], eventBytes: world.limits.eventBytes, inputLimits: { toolMs: 500 }, deliveryLimits: { positions: 2 } });
  t.after(() => runtime.stop()); t.after(() => world.stop(new AbortController().signal));
  return { directory, config, peer, world, runtime, store };
}
