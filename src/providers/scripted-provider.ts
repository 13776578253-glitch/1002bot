/** Scripted transport supplies offline response sequences; tests control any injected callback behavior. */
import type { Provider, ProviderRequest, ProviderResponse } from '../protocol/index.ts';

export class ScriptedProvider implements Provider {
  readonly id = 'scripted';
  /** 调用开始即消耗序号，异步回调失败也不会倒退或重试同一响应。 */
  private index = 0;
  private readonly responses: readonly ProviderResponse[] | ((request: ProviderRequest, index: number) => ProviderResponse | Promise<ProviderResponse>);

  constructor(responses: readonly ProviderResponse[] | ((request: ProviderRequest, index: number) => ProviderResponse | Promise<ProviderResponse>)) { this.responses = responses; }

  /** 离线实现按公共请求 JSON 计量，不模拟某一 HTTP Provider 的额外封装。 */
  measureRequest(request: ProviderRequest): number { return Buffer.byteLength(JSON.stringify(request), 'utf8'); }

  async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const index = this.index++;
    if (typeof this.responses === 'function') return this.responses(request, index);
    const response = this.responses[index];
    if (!response) throw new Error(`ScriptedProvider exhausted at response ${index}`);
    return response;
  }
}
