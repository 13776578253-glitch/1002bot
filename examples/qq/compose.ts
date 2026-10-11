/** QQ composition aligns Session/source binding and transport limits with the existing Runtime. */
import { composeRuntime, ConversationAgent, JsonlSessionStore, MemorySessionStore, MemoryState, type Provider, type InputLimits, type MemorySessionLimits } from '1002bot';
import { QQWorld, type QQConfig } from '@1002bot/world-qq';

/** Message semantics belong to this QQ composition; final model text stays local. */
const instructions = 'Interpret qq.message facts from the fixed authorized conversation. The current event already contains the sender, text, messageId, mentions and references; use it directly. Use qq.get_message only when an earlier referenced message is needed, with the local snapshot by default. Send QQ replies through qq.send_text. Final assistant text is a local summary. Confirmed sends in settled failed runs remain real replies; use their content for follow-up questions and never repeat an unknown send.';

export function composeQQ(config: QQConfig, sessionPath: string, provider: Provider) {
  const world = new QQWorld(config);
  const session = new JsonlSessionStore(sessionPath);
  const runtime = composeRuntime({ world, session, provider, state: new MemoryState(),
    agent: new ConversationAgent({ sessionId: config.binding.sessionId,
      instructions }),
    worldStreams: [world.stream], eventBytes: world.limits.eventBytes,
    inputLimits: { toolMs: world.limits.apiMs + 3000 }, cleanupDeadlineMs: world.limits.cleanupMs + 1000,
  });
  return { runtime, world, session };
}

/** A fresh chat composition owns both in-memory records for one process-local conversation. */
export function composeQQChat(config: Omit<QQConfig, 'journalPath'>, provider: Provider, options: { sessionLimits?: MemorySessionLimits; inputLimits?: Partial<InputLimits> } = {}) {
  const world = new QQWorld({ endpoint: config.endpoint, accessToken: config.accessToken, binding: config.binding,
    ...(config.limits ? { limits: config.limits } : {}), ...(config.onDiagnostic ? { onDiagnostic: config.onDiagnostic } : {}), storage: 'memory' });
  const session = new MemorySessionStore(options.sessionLimits);
  // 两端共同采用实例内确认历史；失败轮次的已发送回复保持可见。
  const agent = new ConversationAgent({ sessionId: config.binding.sessionId, persistent: false, includeUnsuccessfulHistory: true, instructions });
  const runtime = composeRuntime({ world, session, agent, provider, state: new MemoryState(), includeUnsuccessfulHistory: true,
    worldStreams: [world.stream], eventBytes: world.limits.eventBytes,
    inputLimits: { toolMs: world.limits.apiMs + 3000, ...options.inputLimits }, cleanupDeadlineMs: world.limits.cleanupMs + 1000 });
  return { runtime, world, session, agent };
}
