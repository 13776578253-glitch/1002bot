/** Offline peers exercise real WS and Responses HTTP; only model decisions are scripted. */
import { createServer, type Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { OpenAIResponsesProvider, type JsonObject } from '1002bot';
import type { QQConfig } from '@1002bot/world-qq';

export interface WireRequest { input: JsonObject[]; tools: { name: string }[] }
export type ModelScript = (request: WireRequest, index: number) => Promise<JsonObject> | JsonObject;
export class ChatFixture {
  readonly ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  readonly http: Server;
  readonly requests: WireRequest[] = [];
  readonly requestBytes: number[] = [];
  readonly actions: { action: string; params: JsonObject }[] = [];
  readonly replies: { messageId: number; text: string }[] = [];
  readonly modelErrors: string[] = [];
  failAfterSend = false;
  loseSendConfirmation = false;
  private nextMessage = 1;
  private nextReply = -1;
  private baseUrl = '';
  config!: Omit<QQConfig, 'journalPath'>;
  constructor(script?: ModelScript) {
    this.ws.on('connection', socket => socket.on('message', bytes => {
      const request = JSON.parse(bytes.toString()) as { action: string; echo: string; params: JsonObject };
      this.actions.push({ action: request.action, params: request.params });
      if (request.action === 'get_login_info') socket.send(JSON.stringify({ echo: request.echo, status: 'ok', retcode: 0, data: { user_id: 10001 } }));
      else if (request.action === 'send_group_msg' || request.action === 'send_private_msg') {
        const message = request.params.message as JsonObject[], text = (message[0]?.data as JsonObject).text as string;
        const messageId = this.nextReply--; this.replies.push({ messageId, text });
        if (!this.loseSendConfirmation) socket.send(JSON.stringify({ echo: request.echo, status: 'ok', retcode: 0, data: { message_id: messageId } }));
      } else socket.send(JSON.stringify({ echo: request.echo, status: 'failed', retcode: 1404, data: null }));
    }));
    this.http = createServer(async (req, res) => {
      try {
        const parts: Buffer[] = []; for await (const part of req) parts.push(part as Buffer);
        const bytes = Buffer.concat(parts), request = JSON.parse(bytes.toString()) as WireRequest;
        this.requestBytes.push(bytes.length); this.requests.push(request);
        const body = await (script ? script(request, this.requests.length - 1) : this.respond(request));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      } catch (error) { this.modelErrors.push(String(error)); res.writeHead(500).end(); }
    });
  }
  async start(): Promise<void> {
    if (!this.ws.address()) await new Promise<void>(resolve => this.ws.once('listening', resolve));
    await new Promise<void>(resolve => this.http.listen(0, '127.0.0.1', resolve));
    const ws = this.ws.address(), http = this.http.address();
    if (!ws || typeof ws === 'string' || !http || typeof http === 'string') throw new Error('Fixture requires TCP peers');
    this.baseUrl = `http://127.0.0.1:${http.port}/v1`;
    this.config = { endpoint: `ws://127.0.0.1:${ws.port}/`, accessToken: 'fixture-token',
      binding: { worldId: 'qq', sessionId: 'qq-chat-fixture', streamId: 'messages', epoch: 'fixture-chat', accountId: 10001, conversation: { kind: 'group', id: 20001 } },
      limits: { apiMs: 200, retryMs: 5, reconnectMs: 20, connectMs: 500, startMs: 1500 } };
  }
  provider(): OpenAIResponsesProvider { return new OpenAIResponsesProvider({ apiKey: 'fixture-key', model: 'fixture-model', baseUrl: this.baseUrl }); }
  push(text: string, reference?: number): number {
    const id = this.nextMessage++;
    this.pushRaw({ post_type: 'message', self_id: 10001, message_type: 'group', group_id: 20001, user_id: 30001,
      message_id: id, time: Math.floor(Date.now() / 1000), message: [...(reference === undefined ? [] : [{ type: 'reply', data: { id: String(reference) } }]), { type: 'text', data: { text } }] });
    return id;
  }
  pushRaw(raw: JsonObject): void { for (const socket of this.ws.clients) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(raw)); }
  private respond(request: WireRequest): JsonObject {
    const get = request.tools[0]!.name, send = request.tools[1]!.name;
    const last = request.input.at(-1)!;
    const call = (name: string, args: JsonObject): JsonObject => ({ output: [{ type: 'reasoning', id: `reason-${this.requests.length}`, summary: [], encrypted_content: 'fixture-opaque' },
      { type: 'function_call', call_id: `call-${this.requests.length}`, name, arguments: JSON.stringify(args) }] });
    if (last.type === 'function_call_output') {
      const outcome = JSON.parse(last.output as string) as { toolName: string; output?: { message?: { text: string } } };
      if (outcome.toolName === 'qq.get_message') return call(send, { text: `引用：${outcome.output?.message?.text}` });
      if (this.failAfterSend) { this.failAfterSend = false; return { status: 'failed', error: { code: 'fixture_model_error', message: 'Failed after confirmed send' }, output: [] }; }
      return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Local completion summary' }] }] };
    }
    const event = JSON.parse(last.content as string) as { payload: { text: string; references: number[] } };
    if (event.payload.references.length) return call(get, { message_id: event.payload.references[0]! });
    // repeat 从实际模型输入寻找此前已发送文本，脚本本身不保存会话记忆。
    const prior = request.input.filter(item => item.type === 'function_call' && item.name === send).at(-1);
    const previous = prior ? (JSON.parse(prior.arguments as string) as { text: string }).text : undefined;
    return call(send, { text: event.payload.text === 'repeat' ? `此前：${previous ?? '无历史'}` : `收到：${event.payload.text}` });
  }
  async close(): Promise<void> {
    for (const socket of this.ws.clients) socket.terminate();
    this.http.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => this.ws.close(() => resolve())), new Promise<void>(resolve => this.http.close(() => resolve()))]);
  }
}
export async function untilChat(predicate: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error('Chat fixture timed out'); await delay(5); }
}
