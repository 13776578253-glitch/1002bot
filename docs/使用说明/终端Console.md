Owner: `src/console/terminal.ts`, `src/protocol/input.ts`, `src/protocol/trigger.ts`, `src/runtime/input-channel.ts`, `src/runtime/trigger-channel.ts`, `src/runtime/trigger-run.ts`, `src/agent/conversation-agent.ts`, `src/providers/openai-responses-provider.ts`, `scripts/console-sample.ts`

# 终端 Console

本文保留 M2 行式入口的操作说明。2026-10-08 起 src/console 定位为内部测试入口，未来有成熟测试替代时可删除；正式可选前端为独立 TUI 包。游戏内玩家输入的接入与持续运行目标见 [目标偏差讨论](../../scratch/Off-topic%20discussion/2026-10-06-M2目标偏差与持续运行方向.md)。

源码阅读入口见 [代码阅读与注释](../开发指南/代码阅读与注释.md)：英文注释锚定模块职责，中文注释说明受理、诊断、容量和收束边界。

2026-10-08 注释核对补充了共享诊断流、UserInput 取消目标和 EOF 等待全部受理来源的边界；本次未改变命令或执行行为。

Console 的 M2 交付基线见 [M2 进度与架构图](../2026-10-05-M2.0进度与架构图.md)，当前统一触发结构见 [M3 进度与架构图](../2026-10-08-M3.0进度与架构图.md)。

独立全屏组合样例为 `pnpm dev:tui`，安装与验证范围见 [包安装与迁移](包安装与迁移.md) 和 [全屏 TUI](全屏TUI.md)。样例显式注入行式回退；TUI 单包默认要求原始 TTY。

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

用户输入、World Event 和 Heartbeat 保留各自语义，共用一个 FIFO 队列与执行器。runtime.inputs 是 UserInput 门面，runtime.triggers 提供通用受理、取消、查询与诊断；handleEvent 进入同一队列并返回自身的 RunResult。受理拒绝抛稳定错误，执行失败或取消通过结果表达。新事件不自动取消活动处理，本批不按来源插队或合并批次。

Agent 的入口分别为 initialInputRequest、initialRequest 和可选 initialHeartbeatRequest；续轮 input 为 Event | UserInput | HeartbeatTrigger。Event/Heartbeat 可以无文本成功，Console 输入继续要求最终回复。非用户诊断显示触发种类、ID 与来源；Console 取消和快照命令仍针对 UserInput。

| 标准参数 | 数值 |
| --- | ---: |
| 实际 Provider 请求 JSON 体 | 64 KiB UTF-8 |
| 单条正文；ID/source | 8 KiB；各 128 字节 |
| 初始历史选择预留 | 16 KiB |
| 待执行输入；每次输入模型请求 | 8 条；8 次 |
| 每批工具；Provider 响应体 | 8 个；1 MiB |
| Provider；工具时限 | 30 秒；10 秒 |
| 执行；排队时限 | 各 120 秒 |
| 受理 ID | UserInput 每个 Runtime 累计最多 4096；legacy World 独立 4096；ordered World 使用有限位置，内部心跳不占用 |
| 事件缓存；输入快照 | 256 条/4 MiB；128 条/4 MiB |

容量由 STANDARD_INPUT_LIMITS 定义；组合根可以覆盖正整数参数。Responses 适配器使用同一序列化方法计量与发送，请求体包含消息、工具 schema 和原始输出项，凭据头不计入。响应读取有独立 responseBytes 上限，默认同为 1 MiB；调整运行容量时，应同步配置适配器的响应读取上限。进程内 Provider 按响应结构的序列化字节数计量。

ConversationAgent 只选择配对完整的成功历史轮次，原始输出项随整轮保留或淘汰。当前活动轮次超限时发布 context_limit，已确认的工具成功仍按 succeeded 记录，不重试。旧 M1 日志保留，不纳入首批用户上下文；没有自动摘要。

accepted 在内存受理后返回，随受理启动 trigger_received 追加，执行等待追加确认。UserInput 和 legacy World 没有跨进程去重或结果投递保证；M4 ordered World 的保存与前缀重建见后补迁移说明，没有自动恢复执行。run_finished 在 JSONL 终态追加成功或明确失败后发布；写入失败标记 persisted=false 并停止后续处理，存储持续挂起阻塞 stop。现有 JSONL 追加未增加 fsync 或事务保证。

M2 工具已经进入 World 执行后抛异常，无法确认结果，按 unknown 收束；明确领域失败应由 World 返回 failed 回执。unknown 诊断保留原 callId 与原因，缺少原因时标记 tool_unknown。取消、工具超时和回执 ID 错配分别保留对应错误代码，未开始的同批调用标记 cancelled/not_executed。

tool_finished 描述执行结果，在依赖 Session 写入前发布；回执存储失败也保留实时诊断。unknown 的停止决定在写入前锁定，立即关闭输入受理，收束后停止 Runtime 并取消剩余输入。run_finished.persisted 表示终态记录的追加结果，回执追加失败仍报告 storage_error；不是整轮事务成功的承诺。公共 error 只复制 code/message，不附带错误对象的其他元数据、Provider 原始项或凭据字段。

迟到 Provider/World 结果不会写入新代。World 仍须遵守取消与 cleanup 信号；正常启动不能撤销外部副作用。

## M4 启动与历史边界

具备 scan 的 Session 在 start 时先检查归档。未结清、unknown、悬空调用或损坏记录会阻止重新开放执行；`/start` 不会解除这些问题。只读诊断及离线 World 来源 Console 见 [M4 顺序投递与迁移](M4顺序投递与迁移.md)。原行式 Console 的命令与 UserInput 身份不变。

Agent.history 改为近期完整运行候选加本项记录；Runtime.trace 改为有限近期视图。完整记录留在 Session；默认单条 JSONL 记录为 16 MiB。World 通用取消/查询使用回执 triggerId，不能继续直接使用原 Event.id。新来源契约不改变混合 FIFO、固定输入或心跳跳过策略。

## M5 可选任务接续

ConversationAgent 可显式启用任务工具，当前 run 的回复/取消语义与本地命令保持原入口；任务操作通过同一工具诊断和最终结果展示。确认任务状态、安排消费、归档查询和手动时钟闭环见 [M5 任务与心跳](M5任务与心跳延续.md)。独立离线样例 `scripts/m5-console.ts` 不增加 TUI 产品页，原 console-sample 默认仍关闭任务功能。
