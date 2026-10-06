# 1002bot M1 实现交接计划

状态：可执行。P0 的主要方向和 M1 验收口径已冻结；本文件交给下一位 AI 作为 M1 实现入口。

## 交接结论

可以开始执行 M1。下一位 AI 不需要重新讨论项目身份、顶层职责、第一条垂直闭环、测试禁网约束或 VRChat 的阶段位置。仍未确定的内容属于实现细节，必须在实现任务记录中写明选择和验证结果；它们不能被默认为新的架构方向。

## 必读文件

按以下顺序阅读：

1. `agent-context/AGENTS-en.md`
2. `agent-context/plans/1002bot-p0-decision-questions.md`
3. `docs/1002bot-M1-通用Agent基础规划.md`
4. `docs/1002bot-M1-Phase0详细规划.md`
5. `agent-context/current-task/2026-10-03-p0决策问题合集.md`

实现开始前先检查仓库现状。当前没有已确认的 Node、pnpm、TypeScript 或测试基线；如果缺少 `package.json` 和对应脚本，先建立最小可运行基线，再进入功能实现。

## 已冻结的架构

`1002bot` 是独立实现的多 World Agent 平台。Cortico、AstrBot、AIRI 和旧 OSC 项目只作为经审阅的结构与思想参考。P0 不迁移代码；任何模块代码迁移都必须在该模块任务开始前单独裁定。

生产代码的顶层职责如下：

| 模块 | 所有权 |
| --- | --- |
| Runtime | 生命周期、事件入口、主循环、取消、generation/lease 和清理 |
| Agent | 判断、最小上下文策略和 Session 声明 |
| State | 持久状态与 Memory 边界 |
| World | 外部事件、工具声明、领域校验、工具执行和结果 |
| Provider | 模型协议适配；M1 包含 OpenAI Responses 兼容适配器 |
| Assembly | 组合根；唯一入口为 `src/runtime/compose.ts` |

Runtime、Agent、World 只通过 `src/protocol` 的契约通信，不持有彼此内部对象。目标目录为：

```text
src/runtime/
src/agent/
src/state/
src/providers/
src/worlds/
src/protocol/
tests/fixtures/
tests/integration/
tests/e2e/
tests/architecture/
```

## M1 固定范围

M1 只实现单 Bot、单 Session、单 FixtureWorld 的最小垂直闭环：

```text
FixtureWorld event
  -> Runtime
  -> TestAgent
  -> Provider
  -> Tool dispatch
  -> FixtureWorld ToolOutcome
  -> JSONL Session
```

固定要求：

- `TestAgent` 和内存 Memory/State 位于 `tests/fixtures`，只作为测试基础设施；M1 后可删除。
- Session 使用 JSONL 持久化；Event 与 Run/Tool trace 在 M1 使用内存实现。
- 通用事件字段为 `id`、`type`、`source`、`occurredAt`、`payload` 和可选 `meta`。
- ToolOutcome 必须表达 `succeeded`、`failed`、`cancelled`、`unknown`。
- Core 负责结构化参数解析，World 负责领域语义校验。
- FixtureWorld 至少有查询、状态写入、失败三类工具；具体名称由实现任务选定并记录。
- Provider 契约必须可替换；自动化测试使用脚本 Provider，不连接网络。
- OpenAI Responses 兼容 Provider 必须实现，但真实请求只由项目负责人在最后手动验收。
- M1 只做正确性，不建立性能基线。

## Runtime 停止语义

实现以下初版状态机：

```text
new -> starting -> running -> stopping -> stopped
             \-> failed -> stopped
```

- 每次 `start()` 创建新的 generation、根取消信号和组件 lease。
- `stop()` 进入 `stopping` 时立即递增 generation、关闭 lease 并取消活动请求。
- `stopping` 和 `stopped` 上重复 `stop()` 幂等；停止开始后不接受新事件、模型请求或工具调用。
- 迟到回调必须检查 generation、lease 和取消状态；失败时丢弃，不写 Session/Event/Trace，也不启动新工作。
- cleanup 独立于正常运行通道，必须幂等并有 deadline；单个组件超时不能阻塞其他组件清理。
- 无法确认的外部副作用保留 `unknown`。
- 重启创建新的 generation 和 lease；旧回调永久无效。

deadline 数值、组件停止顺序和外部副作用账本留在实现任务中裁定，并通过测试固定。

## 首个实现批次

按以下顺序推进，每完成一个批次就更新当前任务记录：

1. 建立 `package.json`、TypeScript 配置、测试配置和 `pnpm test`/`pnpm run typecheck` 基线。
2. 在 `src/protocol` 定义事件、Provider、Tool、World、Session 和生命周期所需的最小公共契约。
3. 实现 `src/runtime` 生命周期、generation/lease、取消传播和 `src/runtime/compose.ts`。
4. 实现 JSONL Session、内存 State，以及 Event/Run/Tool trace 的内存边界。
5. 实现 Provider 契约、ScriptedProvider 和 OpenAI Responses 兼容适配器。
6. 在 `tests/fixtures` 实现 TestAgent、内存 Memory 和 FixtureWorld。
7. 接通事件到模型、工具调用、ToolOutcome 和 Session 的垂直闭环。
8. 补齐生命周期、停止竞态、恢复、Provider/工具失败、未知工具、非法参数和架构边界测试。
9. 提供一个无网络最小 CLI 或脚本样例，作为人工检查入口；不启动真实 Bot。

## M1 验收

执行 AI 交付前必须同时提供：

- `pnpm test` 通过。
- `pnpm run typecheck` 通过。
- 自动化测试确认无网络访问。
- 测试证明重复停止、启动失败清理、取消和迟到回调不会产生越代写入。
- 测试证明 JSONL Session 可恢复，工具调用与结果按 `callId` 配对。
- 测试覆盖查询、状态写入、失败工具、未知工具和非法参数。
- 架构测试确认 Runtime/Agent 不依赖具体 World、OSC、VRChat 或 `tests` 生产路径，组合根只有 `src/runtime/compose.ts`。
- 提供无网络运行样例及结果摘要。
- 单独列出真实 Provider 的人工验收步骤和未验证项，不把手动结果伪装成自动化证据。

实现完成后先由另一 AI 做 Review，再由项目负责人进行 M1 验收。若实现范围偏离本文件，暂停编码，回到计划记录并说明偏移原因。

## 明确禁止的范围扩张

- 不在 M1 实现 VRChat OSC、OSCQuery、屏幕采样、视觉模型或实时控制。
- 不在 M1 设计 VRChat 的具体接口；只保留需求登记。
- 不在 P0/M1 直接迁移 Cortico 或其他参考项目代码。
- 不加入多 Bot、多 Session、多 World 并发、插件市场、Web 控制台、云端部署或生产级事件数据库。
- 不把 TestAgent、FixtureWorld 或测试 Memory 放进生产 `src`。
- 不把网络真实 Provider 调用放进自动化测试。

## 交付记录要求

每个实现批次都在 `agent-context/current-task/` 追加记录，写明时间、变更、影响、验证、开放问题和提交建议。稳定架构变更更新 `docs/`；完成后的计划复制到 `agent-context/history/plans/` 并在原计划中标注归档位置。

归档：M1 基线和验收收尾已完成，本计划已复制到 `agent-context/history/plans/1002bot-m1-work-handoff.md`；原文件保留作为活动入口的历史记录。
