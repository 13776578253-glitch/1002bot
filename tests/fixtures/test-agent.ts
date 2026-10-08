import type { Agent, AgentContext, AgentContinuation, Event, ModelMessage, ProviderRequest, SessionDecl, SessionEntry } from '../../src/protocol/index.ts';

export class TestAgent implements Agent {
  readonly id = 'test-agent';
  private readonly session: SessionDecl;

  constructor(sessionId = 'fixture-session', maxTurns = 4) {
    this.session = { sessionId, maxTurns, persistent: true };
  }

  declareSession(): SessionDecl { return this.session; }

  async initialRequest(event: Event, context: AgentContext): Promise<ProviderRequest> {
    return request(this.session.sessionId, [...messagesFromHistory(context.history), ...(context.runId ? [] : [{ role: 'user' as const, content: JSON.stringify(event) }])]);
  }

  async nextRequest(input: AgentContinuation, _context: AgentContext): Promise<ProviderRequest | undefined> {
    return request(this.session.sessionId, messagesFromHistory(input.history));
  }
}

function messagesFromHistory(history: readonly SessionEntry[]): ModelMessage[] {
  return history.flatMap((entry): ModelMessage[] => {
    if (entry.kind === 'event') return [{ role: 'user', content: JSON.stringify(entry.event) }];
    if (entry.kind === 'tool_outcome') return [{ role: 'tool', toolCallId: entry.outcome.callId, content: JSON.stringify(entry.outcome) }];
    if (entry.kind === 'provider_response') {
      const response = entry.response;
      if (!response.message && !response.toolCalls.length && !response.providerData) return [];
      return [{
        role: 'assistant', content: response.message?.content ?? '', toolCalls: response.toolCalls,
        ...(response.providerData ? { providerData: response.providerData } : {}),
      }];
    }
    return [];
  });
}

function request(sessionId: string, messages: readonly ModelMessage[]): ProviderRequest {
  return {
    sessionId,
    messages,
    tools: [
      { name: 'fixture.get', description: 'Read a fixture value.', inputSchema: { type: 'object' } },
      { name: 'fixture.set', description: 'Write a fixture value.', inputSchema: { type: 'object' } },
      { name: 'fixture.fail', description: 'Return a fixture failure.', inputSchema: { type: 'object' } },
    ],
  };
}
