Owner: `src/state/memory-session.ts`, `src/state/jsonl-session.ts`, `src/index.ts`, `src/agent/conversation-agent.ts`, `src/providers/openai-responses-provider.ts`, `src/providers/responses-tool-names.ts`, `src/runtime/runtime.ts`, `src/runtime/compose.ts`, `src/runtime/session-preflight.ts`, `src/state/history-window.ts`

# 内存 Session 与 Responses 工具名

## 内存记录

核心根入口导出 MemorySessionStore、MemorySessionLimits 和 STANDARD_MEMORY_SESSION_BYTES。实例实现 SessionStore.append/read/scan，可以直接用于来源预检、历史窗口和任务投影。调用方自行选择存储生命周期。

```ts
import { MemorySessionStore, ConversationAgent } from '1002bot';
const session = new MemorySessionStore({ bytes: 256 * 1024 * 1024 });
const agent = new ConversationAgent({ sessionId: 'memory-session', persistent: false });
```

recordBytes 默认沿用 JSONL 的 16 MiB 单条上限；bytes 默认为 256 MiB 累计上限。计量 UTF-8 JSON 行，含换行符。调用边界序列化记录，串行确认后才可读取；每次读取独立解析，scan 在开始确认读取时固定记录条数并响应取消信号。达到容量或序列化失败时保留失败，后续读写继续失败。

确认记录留在同一实例内；重建存储实例清空。persistent=false 是 Agent 声明，实际记录寿命由注入的 SessionStore 决定。RunResult.persisted 表示所选 Session 追加确认，内存模式不提供跨进程保留。

## 已结清历史选择

Runtime/composeRuntime 的 includeUnsuccessfulHistory 可显式让候选窗口保留配对完整的已结清失败/取消组；ConversationAgent 的同名选项允许其进入模型上下文。需要该策略的装配同时选择两项。默认均为 false，继续只选择成功历史。

历史依然按完整组及配置预算裁剪；选项不解除 unknown、未结清或损坏审计。外部工具已经成功的效果不因随后模型失败而撤销；模型判断可读取成功回执及原消息事实。

## Responses 工具线名

Core 的 ToolDefinition、ToolCall 和 Session 使用内部名称。Responses Provider 按本次声明和历史调用建立精确映射：合法名称原样保留；标点通常转为下划线，重名或超长时增加摘要后缀。声明、通用调用、原生 function_call 项和回包共用此映射，serializeRequest 与 measureRequest 使用相同序列化。

原生 reasoning 等不透明项保留；Session 中的 function_call 名称恢复为内部身份。旧样例的原生线名通过配对 callId 的通用内部名称在重放时重新转换，原文件保持不变。未知回包名称仍由 Runtime 工具声明校验处理。既有磁盘 Session 格式无需修改。
