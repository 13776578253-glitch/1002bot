/** QQ composition aligns Session/source binding and transport limits with the existing Runtime. */
import { composeRuntime, ConversationAgent, JsonlSessionStore, MemoryState, type Provider } from '1002bot';
import { QQWorld, type QQConfig } from '@1002bot/world-qq';

export function composeQQ(config: QQConfig, sessionPath: string, provider: Provider) {
  const world = new QQWorld(config);
  const session = new JsonlSessionStore(sessionPath);
  const runtime = composeRuntime({ world, session, provider, state: new MemoryState(),
    agent: new ConversationAgent({ sessionId: config.binding.sessionId,
      instructions: 'Interpret qq.message facts from the fixed authorized conversation. Use qq.get_message for known IDs and qq.send_text when a QQ reply is appropriate. Final assistant text is local output. Report unknown effects accurately and never retry an unknown send.' }),
    worldStreams: [world.stream], eventBytes: world.limits.eventBytes,
    inputLimits: { toolMs: world.limits.apiMs + 3000 }, cleanupDeadlineMs: world.limits.cleanupMs + 1000,
  });
  return { runtime, world, session };
}
