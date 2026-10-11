/** A run fixes tool ownership before model work; platform and Agent tools share call/receipt pairing. */
import type { Agent, AgentContext, ToolCall, ToolDefinition, World } from '../protocol/index.ts';
import { InputError } from '../protocol/index.ts';
export function toolRegistry(agent: Agent, world: World) {
  const owned = agent.taskTools?.tools() ?? [];
  const declarations = [...world.tools(), ...owned];
  // 同一份声明用于模型请求、名称校验与执行分流；重名在模型调用前拒绝。
  const names = new Set<string>();
  for (const tool of declarations) {
    if (names.has(tool.name)) throw new InputError('tool_name_conflict', `Tool has more than one owner: ${tool.name}`);
    names.add(tool.name);
  }
  const agentNames = new Set(owned.map(tool => tool.name));
  return { declarations: declarations as readonly ToolDefinition[],
    isAgent: (name: string) => agentNames.has(name),
    executeAgent: (call: ToolCall, context: AgentContext) => agent.taskTools!.executeTool(call, context) };
}
