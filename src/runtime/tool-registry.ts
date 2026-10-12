/** A run fixes tool ownership before model work; platform and Agent tools share call/receipt pairing. */
import type { Agent, AgentContext, ToolCall, ToolDefinition, ToolOutcome, World } from '../protocol/index.ts';
import { InputError } from '../protocol/index.ts';
export function toolRegistry(agent: Agent, world: World) {
  const providers = [agent.taskTools, agent.operationTools].filter(item => item !== undefined).map(provider => ({ provider, tools: provider.tools() }));
  const executors = new Map(providers.flatMap(({ provider, tools }) => tools.map(tool => [tool.name, provider] as const)));
  const owned = providers.flatMap(item => item.tools);
  const declarations = structuredClone([...world.tools(), ...owned]);
  // 同一份声明用于模型请求、名称校验与执行分流；重名在模型调用前拒绝。
  const names = new Set<string>();
  for (const tool of declarations) {
    if (tool.effects !== undefined && tool.effects !== 'none' && tool.effects !== 'external') throw new InputError('invalid_tool_capability', 'Tool effect capability is unsupported');
    if (names.has(tool.name)) throw new InputError('tool_name_conflict', `Tool has more than one owner: ${tool.name}`);
    names.add(tool.name);
  }
  const agentNames = new Set(owned.map(tool => tool.name));
  return { declarations: declarations as readonly ToolDefinition[],
    isAgent: (name: string) => agentNames.has(name),
    effects: (name: string) => declarations.find(tool => tool.name === name)?.effects,
    executeAgent: (call: ToolCall, context: AgentContext) => executors.get(call.toolName)!.executeTool(call, context) };
}
/** 仅校验公共回执头；领域输出内容仍由工具实现拥有。 */
export function matchesOutcome(value: ToolOutcome, call: Pick<ToolCall, 'callId' | 'toolName'>): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.callId === call.callId && value.toolName === call.toolName
    && ['succeeded', 'failed', 'cancelled', 'unknown'].includes(value.status);
}
