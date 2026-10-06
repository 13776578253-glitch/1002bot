Owner: `src/console/terminal.ts`, `src/protocol/input.ts`, `src/runtime/input-channel.ts`, `src/runtime/input-run.ts`, `src/agent/conversation-agent.ts`, `src/providers/openai-responses-provider.ts`, `scripts/console-sample.ts`

# 终端 Console

本文是 M2 终端调试与运维入口的操作和接口说明。游戏内玩家输入的接入与持续运行目标见 [目标偏差讨论](../../scratch/Off-topic%20discussion/2026-10-06-M2目标偏差与持续运行方向.md)。

源码阅读入口见 [代码阅读与注释](../开发指南/代码阅读与注释.md)：英文注释锚定模块职责，中文注释说明受理、诊断、容量和收束边界。

Console 在整体系统中的所有权、装配和依赖关系见 [M2 进度与架构图](../2026-10-05-M2进度与架构图.md)。

在项目目录执行 `pnpm dev:console`。样例使用 FixtureWorld 和离线脚本模型，启动时打印临时 JSONL 路径。输入 `set answer 7` 写入值，再输入 `get answer` 读取；`fail reason` 演示工具失败；其他正文原样回复。

每次提交显示 inputId 和受理序号；模型请求显示 provider_started/provider_finished 和 round，工具诊断显示 round、callId、状态及错误代码/原因。最终显示 succeeded/failed/cancelled、错误原因、persisted 与完整回复。Runtime 在输入完成后仍等待后续输入。

| 输入 | 行为 |
| --- | --- |
| 普通一行正文 | 提交文本；可在前一条运行时继续提交 |
| `/begin`，正文多行，`/send` | 提交保留换行的正文 |
| `/discard` | 丢弃正在编辑的多行正文 |
| `//正文` | 去掉首个 `/` 后提交，用于发送以 `/` 开头的正文 |
| `/cancel [inputId]` | 取消指定输入，省略 ID 取消当前运行 |
| `/inspect inputId` | 查看有限缓存中的状态；淘汰后显示 expired_or_not_found |
| `/status` | 查看 Runtime、活动 ID 与本 Console 尚未完成的输入数 |
| `/stop`、`/start` | 正常生命周期停止与启动；受理过的 ID 在同一 Runtime 重启后仍不能复用 |
| `/quit`、Ctrl+C | 取消活动输入与待执行队列，等待停止后退出 |
| EOF | 等待已受理队列终态，然后停止退出；未提交的多行正文丢弃 |

多行编辑期间仅 `/send` 与 `/discard` 被解释为编辑命令。命令由 Console 本地处理，输入来源字段没有模型权限语义。

通用入口为 `runtime.inputs`：submit 返回受理/拒绝回执；subscribe 接收运行、模型轮次、工具诊断、write_pending 与最终结果；cancel、inspect、eventsSince 和 idle 分别用于取消、有限状态查询、游标补读与队列收束。round 从 1 开始表示本输入的 Provider 请求尝试编号；0 表示尚未开始请求，快照同时保留当前编号。Console 仅依赖这一公共契约和生命周期接口。Agent、Provider、World 与 Session 在组合根替换；首个生产 World 尚未选定。

用户输入与环境 Event 独立定义。Agent 的初始用户入口为 initialInputRequest，后续 AgentContinuation.input 为 Event | UserInput。M1 原 Event 入口保留，运行环境事件时拒绝受理用户输入；用户队列运行时拒绝直接 Event 调用，避免两条入口同时执行 World 工具。首批不新增环境事件调度器。

| 标准参数 | 数值 |
| --- | ---: |
| 实际 Provider 请求 JSON 体 | 64 KiB UTF-8 |
| 单条正文；ID/source | 8 KiB；各 128 字节 |
| 初始历史选择预留 | 16 KiB |
| 待执行输入；每次输入模型请求 | 8 条；8 次 |
| 每批工具；Provider 响应体 | 8 个；1 MiB |
| Provider；工具时限 | 30 秒；10 秒 |
| 执行；排队时限 | 各 120 秒 |
| 受理 ID | 每个 Runtime 最多 4096 |
| 事件缓存；输入快照 | 256 条/4 MiB；128 条/4 MiB |

容量由 STANDARD_INPUT_LIMITS 定义；组合根可以覆盖正整数参数。Responses 适配器使用同一序列化方法计量与发送，请求体包含消息、工具 schema 和原始输出项，凭据头不计入。响应读取有独立 responseBytes 上限，默认同为 1 MiB；调整运行容量时，应同步配置适配器的响应读取上限。进程内 Provider 按响应结构的序列化字节数计量。

ConversationAgent 只选择配对完整的成功历史轮次，原始输出项随整轮保留或淘汰。当前活动轮次超限时发布 context_limit，已确认的工具成功仍按 succeeded 记录，不重试。旧 M1 日志保留，不纳入首批用户上下文；没有自动摘要。

受理队列在内存中，首批没有崩溃恢复、跨进程去重或结果投递保证。run_finished 在 JSONL 终态追加完成后发布；写入失败标记 persisted=false，存储持续挂起保持 write_pending 并阻塞 stop。现有 JSONL 追加未增加 fsync 或事务保证。

M2 工具已经进入 World 执行后抛异常，无法确认结果，按 unknown 收束；明确领域失败应由 World 返回 failed 回执。unknown 诊断保留原 callId 与原因，缺少原因时标记 tool_unknown。取消、工具超时和回执 ID 错配分别保留对应错误代码，未开始的同批调用标记 cancelled/not_executed。

tool_finished 描述执行结果，在依赖 Session 写入前发布；回执存储失败也保留实时诊断。unknown 的停止决定在写入前锁定，立即关闭输入受理，收束后停止 Runtime 并取消剩余输入。run_finished.persisted 表示终态记录的追加结果，回执追加失败仍报告 storage_error；不是整轮事务成功的承诺。公共 error 只复制 code/message，不附带错误对象的其他元数据、Provider 原始项或凭据字段。

迟到 Provider/World 结果不会写入新代。World 仍须遵守取消与 cleanup 信号；正常启动不能撤销外部副作用。
