/** Responses transport owns wire conversion and native replay; it does not own Session or Runtime lifecycle. */
import type { JsonObject, ModelMessage, Provider, ProviderRequest, ProviderResponse, ToolCall } from '../protocol/index.ts';
import { InputError, STANDARD_INPUT_LIMITS } from '../protocol/index.ts';

export interface OpenAIResponsesOptions {
  /** 仅用于传输认证头，不进入公共请求契约或 Session 记录。 */
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** 可注入离线传输替身，测试无需联网。 */
  fetchImpl?: typeof fetch;
  /** 分块读取原始响应体的字节上限；独立配置，装配时应与 Runtime 响应容量对齐。 */
  responseBytes?: number;
}

export class OpenAIResponsesProvider implements Provider {
  readonly id = 'openai-responses';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly options: OpenAIResponsesOptions;

  constructor(options: OpenAIResponsesOptions) {
    this.options = options;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (options.responseBytes !== undefined && (!Number.isSafeInteger(options.responseBytes) || options.responseBytes < 1)) throw new Error('Invalid responseBytes');
  }

  /** 测量与实际发送共用这一序列化入口，包含模型名、工具声明和原生响应重放。 */
  serializeRequest(request: ProviderRequest): string {
    return JSON.stringify({
      model: this.options.model,
      input: request.messages.flatMap((message) => toResponsesInput(message, this.id)),
      tools: request.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema })),
    });
  }
  measureRequest(request: ProviderRequest): number { return Buffer.byteLength(this.serializeRequest(request), 'utf8'); }

  async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
      body: this.serializeRequest(request),
      signal,
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Responses request failed with HTTP ${response.status}`); }
    const body = await readBody(response, this.options.responseBytes ?? STANDARD_INPUT_LIMITS.responseBytes, signal);
    return { ...parseResponses(body.value, this.id), bodyBytes: body.bytes };
  }
}

function toResponsesInput(message: ModelMessage, providerId: string): JsonObject[] {
  // 原生项已包含文本和调用，优先整体重放；再次展开通用字段会重复消息。
  if (message.providerData?.providerId === providerId) return [...message.providerData.output];
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new Error('Tool result is missing toolCallId');
    return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }];
  }
  return [
    ...(message.content ? [{ role: message.role, content: message.content }] : []),
    ...(message.toolCalls ?? []).map((call) => ({ type: 'function_call', call_id: call.callId, name: call.toolName, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments) })),
  ];
}

/** 提取通用文本与调用，同时保留全部对象形式的 output 项供下一轮原生重放。 */
function parseResponses(body: JsonObject, providerId: string): ProviderResponse {
  const output = Array.isArray(body.output) ? body.output.filter(isObject) : [];
  const toolCalls: ToolCall[] = [];
  const text: string[] = [];
  for (const item of output) {
    if (!isObject(item)) continue;
    if (item.type === 'function_call' && typeof item.call_id === 'string' && typeof item.name === 'string') {
      toolCalls.push({ callId: item.call_id, toolName: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : '{}' });
    }
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (isObject(part) && typeof part.text === 'string') text.push(part.text);
      }
    }
  }
  return {
    ...(text.length ? { message: { role: 'assistant' as const, content: text.join('') } } : {}),
    toolCalls,
    providerData: { providerId, output },
    ...(isObject(body.error) ? { error: { code: typeof body.error.code === 'string' ? body.error.code : 'provider_error', message: typeof body.error.message === 'string' ? body.error.message : 'Provider failed' } } : {}),
    // 响应失败或截断优先于工具声明，不能仅因存在调用就继续执行。
    finishReason: body.status === 'failed' || body.error ? 'error' : body.status === 'incomplete' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop',
  };
}

/** 在 JSON 解析之前限制原始字节数，防止完整缓存超限响应后才检查容量。 */
async function readBody(response: Response, limit: number, signal: AbortSignal): Promise<{ value: JsonObject; bytes: number }> {
  if (!response.body) throw new Error('Responses body is missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  // 不等待底层生产者完成 cancel；取消协作不应阻塞本轮收束。
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new InputError('response_limit', `Provider response exceeds ${limit} bytes`);
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isObject(value)) throw new Error('Responses body must be an object');
    return { value, bytes: size };
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
