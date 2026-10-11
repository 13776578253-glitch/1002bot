/** Manual bridge evidence probes never run in the automated suite. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { QQWorld, type QQConfig } from '@1002bot/world-qq';

if (!process.env.QQ_CONFIG || !process.env.QQ_WS_TOKEN) throw new Error('Set QQ_CONFIG and QQ_WS_TOKEN');
const config = JSON.parse(await readFile(resolve(process.env.QQ_CONFIG), 'utf8')) as QQConfig;
config.accessToken = process.env.QQ_WS_TOKEN;
const validated = new QQWorld(config), limits = validated.limits;
const socket = new WebSocket(config.endpoint, { headers: { Authorization: `Bearer ${config.accessToken}` }, maxPayload: limits.frameBytes, handshakeTimeout: limits.connectMs, perMessageDeflate: false });
socket.on('error', () => undefined);
const pending = new Map<string, (value: Record<string, unknown> | Error) => void>();
let incoming!: (value: Record<string, unknown>) => void;
const message = new Promise<Record<string, unknown>>(resolve => { incoming = resolve; });
socket.on('message', bytes => {
  try {
    const raw = JSON.parse(bytes.toString()) as Record<string, unknown>;
    if (typeof raw.echo === 'string') pending.get(raw.echo)?.(raw);
    const b = config.binding;
    if (raw.post_type === 'message' && raw.self_id === b.accountId && raw.user_id !== b.accountId && raw.message_type === b.conversation.kind &&
      (b.conversation.kind === 'group' ? raw.group_id : raw.user_id) === b.conversation.id) incoming(raw);
  } catch { socket.terminate(); }
});
socket.on('close', () => { for (const finish of [...pending.values()]) finish(new Error('Probe disconnected; submitted effects are unknown')); });
function request(action: string, params: Record<string, unknown> = {}) {
  const echo = randomUUID();
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Probe response timed out; submitted effects are unknown')), limits.apiMs);
    const finish = (value: Record<string, unknown> | Error) => {
      clearTimeout(timer); pending.delete(echo); if (value instanceof Error) reject(value); else resolve(value);
    };
    pending.set(echo, finish);
    socket.send(JSON.stringify({ action, params, echo }), error => { if (error) finish(new Error('Probe send failed; effect may be unknown')); });
  });
}
function evidence(action: string, response: Record<string, unknown>) {
  const data = response.data as Record<string, unknown> | null;
  console.log(JSON.stringify({ action, status: response.status, retcode: response.retcode, echo: response.echo,
    fields: data ? Object.keys(data) : [], messageId: data?.message_id, messageIdType: typeof data?.message_id,
    accountId: data?.user_id, bridgeVersion: action === 'get_version_info' ? data : undefined }));
}
try {
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', () => reject(new Error('Probe handshake failed'))); });
  const login = await request('get_login_info');
  if (login.status !== 'ok' || login.retcode !== 0 || (login.data as { user_id?: unknown } | null)?.user_id !== config.binding.accountId) throw new Error('Probe login binding mismatch');
  evidence('get_login_info', login); evidence('get_version_info', await request('get_version_info'));
  console.log('Send one text message in the configured QQ conversation within 60 seconds.');
  let timer!: ReturnType<typeof setTimeout>;
  const timed = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('No authorized inbound message')), 60_000); });
  const captured = await Promise.race([message, timed]).finally(() => clearTimeout(timer));
  console.log(JSON.stringify({ action: 'message_event', self_id: captured.self_id, message_type: captured.message_type, group_id: captured.group_id,
    user_id: captured.user_id, message_id: captured.message_id, time: captured.time, messageFormat: Array.isArray(captured.message) ? 'array' : typeof captured.message }));
  evidence('get_msg', await request('get_msg', { message_id: captured.message_id }));
  if (process.env.QQ_PROBE_SEND_TEXT) {
    const text = process.env.QQ_PROBE_SEND_TEXT;
    if (Buffer.byteLength(text) > limits.textBytes || !text.trim()) throw new Error('Probe send text is invalid');
    const target = config.binding.conversation;
    const action = target.kind === 'group' ? 'send_group_msg' : 'send_private_msg';
    evidence(action, await request(action, { [target.kind === 'group' ? 'group_id' : 'user_id']: target.id, message: [{ type: 'text', data: { text } }] }));
  }
} finally { socket.terminate(); }
