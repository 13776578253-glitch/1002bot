# 1002bot P0 决策问题合集

状态：P0 主要决策已冻结，可进入 M1 实现。generation/lease 的 deadline 数值、停止顺序和外部副作用账本属于实现任务细节。

用途：记录已经完成的 P0 裁定，并作为 M1 实现前的决策索引。执行入口见 `docs/agent-context/plans/1002bot-m1-work-handoff.md`。

回答方式：本表的主要问题已经回答。标记为“可后定”的项目和表中明确保留的实现细节，不构成 M1 阻塞项；实现时必须记录具体选择。

## 一、项目身份与仓库治理

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-01 | 必答 | `1002bot` 的产品身份是什么？ | 独立通用 Agent 项目；面向多个 World 的 Agent 平台；其他 | 面向多个 World 的 Agent 平台 |
| P0-02 | 必答 | Cortico 在 `1002bot` 中承担什么参考角色？ | 主要结构和代码迁移源；只作为结构参考；与 AstrBot/AIRI/旧 OSC 同等参考；其他 | 主要结构和代码迁移源 |
| P0-03 | 必答 | 允许迁移/照搬参考项目到什么程度？ | 结构和设计思想；单个模块代码；大段代码或目录；完整子系统；按阶段裁定 | 结构和设计思想/单个模块代码 |
| P0-04 | 必答 | P0 阶段对参考代码采取什么处理？ | 只借鉴思想；允许直接迁移已裁定模块；其他 | P0 阶段只借鉴思想，不迁移代码 |
| P0-05 | 必答 | 后续是否允许重新裁定代码迁移？ | 允许，在对应模块开始前单独裁定；不允许；其他 | 允许，在对应模块开始前单独裁定 |
| P0-06 | 必答 | 哪些文件是规划/决策权威？ | `docs/agent-context/plans` 管理活动计划，`docs` 管理稳定架构文档；其他 | docs/agent-context/plans 管理活动计划，docs 管理稳定架构文档 |
| P0-07 | 必答 | 计划完成后如何归档？ | 复制到 `docs/agent-context/history/plans` 并保留原计划归档标记；其他 | 复制到 docs/agent-context/history/plans 并保留原计划归档标记 |
| P0-08 | 可后定 | 是否需要中英文双语文档？ | 仅中文；中文为主、关键规则英文；中英文同步 | 目前仅中文 |

## 二、协作流程与监督边界

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-09 | 必答 | 每个 Phase 是否固定采用 Plan → Work → Review？ | 是，三个阶段分离；允许小任务合并；其他 | 允许小任务合并 |
| P0-10 | 必答 | Plan、Work、Review 是否必须由不同 AI 会话完成？ | 必须；只有 Review 独立；按风险决定 | 只有 Review 独立 |
| P0-11 | 必答 | 项目负责人在哪些节点进行人工确认？ | P0 冻结、迁移边界、每个 Phase 结束；仅高风险动作；其他 | P0 冻结、迁移边界、每个 Phase 结束 |
| P0-12 | 必答 | 实现范围偏移时如何处理？ | 立即回到 Plan 更新并重新确认；记录偏移后继续；其他 | 立即回到 Plan 更新并重新确认 |
| P0-13 | 必答 | 谁拥有最终验收权？ | 项目负责人；独立 Review AI 后由负责人确认；其他 | 项目负责人 |
| P0-14 | 可后定 | 是否允许一个 AI 在同一 Phase 内同时修改计划和代码？ | 不允许；小型文档任务允许；按负责人指定 | 按负责人指定 |

## 三、整体架构与目录结构

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-15 | 必答 | 通用 Agent 的顶层职责如何划分？ | Runtime、Agent、State、World、Provider、Assembly；其他 | Runtime、Agent、State、World、Provider、Assembly |
| P0-16 | 必答 | Provider、Extension、Console 是否作为核心扩展点保留？ | Provider 必须保留；Extension/Console 延后；全部保留；其他 | Provider 必须保留；Extension/Console 延后 |
| P0-17 | 必答 | 生产代码的目标目录结构是什么？ | `src/runtime`、`src/agent`、`src/state`、`src/providers`、`src/worlds`、`src/protocol`；其他 | 接受模块化单仓库结构；具体文件按实现任务展开 |
| P0-18 | 必答 | 测试目录如何划分？ | 模块邻近单测，`tests/integration`、`tests/e2e`、`tests/architecture` 分层；其他 | 模块邻近单测，tests/integration、tests/e2e、tests/architecture 分层，参考agentsmd文档内的描述 |
| P0-19 | 必答 | 活动规划、历史记录、稳定文档和临时材料分别放哪里？ | 按 `agent-context` 规则；稳定架构放 `docs`；临时探索放 `scratch`；其他 | 按 agent-context 规则；稳定架构放 docs；临时探索放 scratch |
| P0-20 | 必答 | 组合根由哪个模块唯一拥有？ | `src/runtime/compose.ts`；其他 | `src/runtime/compose.ts` |
| P0-21 | 必答 | Runtime、Agent、World 是否直接持有彼此内部对象？ | 不允许；只通过契约通信；其他 | 不允许，三者通过契约通信 |
| P0-22 | 必答 | World 与 Agent 的交互方式是什么？ | 事件、工具声明、工具调用和结构化回执；其他 | 通过契约通信，不互相拿内部对象直接调用 |

## 四、迁移、复用与重新实现策略

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-23 | 必答 | Cortico 的哪些部分优先迁移？ | Core 生命周期、Session、Loop、EventStore、Provider、World 契约；按清单逐项决定；其他 | 按清单逐项决定，P0 只借鉴思想 |
| P0-24 | 必答 | Cortico 哪些部分明确不直接迁移？ | Web、部署工具、Minecraft、现有 Bot/Persona、扩展分发；按清单逐项决定 | 按清单逐项决定，P0 只借鉴思想 |
| P0-25 | 必答 | AstrBot 主要借鉴范围是什么？ | Pipeline、Runner、插件注册、Provider/平台适配；不把 IM 语义带入 Core；其他 | Pipeline、Runner、插件注册、Provider/平台适配 |
| P0-26 | 必答 | AIRI 主要借鉴范围是什么？ | Perception、Reflex、Conscious/Planner、Action、隔离桥接；不把游戏实现直接当通用 Core；其他 | Perception、Reflex、Conscious/Planner、Action、隔离桥接；不把游戏实现直接当通用 Core |
| P0-27 | 必答 | 旧 OSC 项目哪些代码可以成为未来 World 的迁移源？ | codec、Transport、Capability、Mapper、ActionKernel、测试替身、harness；逐项登记 | 逐项登记 |
| P0-28 | 必答 | 后续允许代码迁移时，验收如何裁定？ | 在对应迁移任务中单独裁定；其他 | 对应任务开始前单独裁定 |
| P0-29 | 必答 | 迁移后是否保留原目录和命名？ | 以 `1002bot` 目录规则为准重命名；尽量保留；按模块决定 | 以 1002bot 目录规则为准重命名 |
| P0-30 | 必答 | 后续迁移任务是否区分保留行为与新实现？ | 是，在对应任务中明确；其他 | 是，在对应任务中明确 |

## 五、M1 的目标与完成定义

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-31 | 必答 | M1 的核心目标是什么？ | 通用 Agent 最小可运行基座；可持续运行的 Agent Runtime；其他 | 通用 Agent 最小可运行基座；可持续运行的 Agent Runtime |
| P0-32 | 必答 | M1 是否必须包含真实模型 Provider？ | 不作为自动化前置，使用 ScriptedProvider；必须接一个真实 Provider；其他 | 必须实现 OpenAI Responses 兼容 Provider；自动化测试不联网，最后人工验收真实请求 |
| P0-33 | 必答 | M1 是否必须包含 Agent 和 State 的可运行实例？ | 必须有最小 TestAgent 和内存 Memory；只冻结契约；其他 | `tests/fixtures` 提供最小 TestAgent 和内存 Memory；M1 完成后可删除，若集成测试仍需要则保留为测试基础设施，不进入生产实现 |
| P0-34 | 必答 | M1 是否必须包含持久化 Session、Event 和 Run/Tool trace？ | 三者都要；只实现接口并用内存替身；按优先级分阶段 | Session 持久化，Event/Trace 内存 |
| P0-35 | 必答 | M1 的第一条垂直闭环由什么组成？ | FixtureWorld event → Runtime → TestAgent → Provider → Tool → Outcome → Session；其他 | FixtureWorld event → Runtime → TestAgent → Provider → Tool → Outcome → Session |
| P0-36 | 必答 | FixtureWorld 需要几个工具？ | 至少查询、状态写入、失败工具；其他 | 固定三类语义：查询、状态写入、失败；具体名称在实现任务中确定，后续可扩展 |
| P0-37 | 必答 | M1 是否包含多 Session、多 Bot 或多 World？ | 单 Bot/单主 Session/单 FixtureWorld；其他 | 但bot单session单fixture |
| P0-38 | 必答 | M1 的完成定义用什么结果判断？ | 可重复自动化测试；人工运行样例；二者都要；其他 | 二者都要 |
| P0-39 | 可后定 | M1 是否包含控制台或 CLI？ | 仅测试入口；最小 CLI；控制台；延后 | 最小 CLI |

## 六、运行语义与契约

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-40 | 必答 | 事件的最小字段和事实等级是什么？ | 只保留通用事件字段；World 事实分类后置；其他 | `id`、`type`、`source`、`occurredAt`、`payload`、可选 `meta`；事实分类后置 |
| P0-41 | 必答 | 工具结果需要哪些终态？ | succeeded/failed/cancelled/unknown；其他 | succeeded/failed/cancelled/unknown |
| P0-42 | 必答 | 工具调用的参数校验由谁负责？ | Core 做结构解析，World 做领域语义校验；其他 | Core 做结构解析，World 做领域语义校验 |
| P0-43 | 必答 | Provider 失败、超时和取消如何进入 Session？ | 结构化错误回执；结束当前轮；按策略重试；其他 | 结构化错误回执；结束当前轮；按策略重试 |
| P0-44 | 必答 | 主循环的硬边界是什么？ | 最大轮数、取消信号、Provider deadline、工具执行 deadline；其他 | 冻结边界语义，具体数值在实现与测试阶段确定 |
| P0-45 | 必答 | Session、EventStore 和 Tool trace 是否分开持久化？ | 分开；先同一文件但接口分开；其他 | 分开 |
| P0-46 | 可后定 | M1 是否采用 JSONL、SQLite 或纯内存？ | JSONL；SQLite；内存替身并预留接口；其他 | Session 使用持久化实现，Event/Trace 使用内存实现 |
| P0-47 | 必答 | Runtime 停止后的迟到回调如何处理？ | generation/lease 失效并拒绝写入；其他 | 采用“代际失效 + 租约失效 + 有界清理”：停止立即递增 generation、关闭租约并取消当前请求；迟到回调只能被丢弃，清理动作通过独立 cleanup 路径执行；重启创建新 generation 和新租约 |

## 七、测试、审查与验收

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-48 | 必答 | M1 的自动化测试命令是什么？ | `pnpm test`、`pnpm run typecheck`；其他 | pnpm test、pnpm run typecheck |
| P0-49 | 必答 | 测试是否禁止网络和真实模型？ | 是；仅允许手动脚本连接真实服务；其他 | 自动化测试禁止网络；真实 Provider 作为实现依赖，最后由项目负责人手动验收 |
| P0-50 | 必答 | 架构边界测试要保护哪些规则？ | Core 无具体 World/OSC 依赖；唯一组合根；测试不进入生产；其他 | Core 无具体 World/OSC 依赖；唯一组合根；测试不进入生产 |
| P0-51 | 必答 | 后续迁移模块是否需要行为对照？ | 在对应迁移任务中单独裁定；其他 | 对应任务开始前单独裁定 |
| P0-52 | 必答 | Phase Review 至少检查什么？ | 目标偏移、边界、失败路径、测试证据、文档 Owner；其他 | 目标偏移、边界、失败路径、测试证据、文档 Owner |
| P0-53 | 可后定 | 是否需要性能基线？ | M1 只测正确性；加入事件/工具延迟基线；其他 | M1 只测正确性 |

## 八、真实 World 顺序与 VRChat 位置

| 编号 | 优先级 | 决策问题 | 建议选项或回答范围 | 回答 |
| --- | --- | --- | --- | --- |
| P0-54 | 必答 | 第一个真实 World 的选择标准是什么？ | 最小复杂度；最能验证事件/工具；最接近最终产品；其他 | Console/Fixture World，先验证挂载、事件和工具 |
| P0-55 | 必答 | VRChat OSC 作为第二或第三个 World，具体由什么条件决定？ | M1 完成后按契约稳定性；第一个 World 完成后按团队时间；其他 | 第一个 World 完成后按团队时间 |
| P0-56 | 必答 | VRChat World 何时开始做接口设计？ | M1 只登记需求；M1 后设计契约；现在就做迁移接口但不实现控制 | M1 只登记需求；M1 后设计契约 |
| P0-57 | 必答 | VRChat 的 System 1 控制核是否独立于通用 Core？ | 是，World 内部拥有；其他 | 是 |
| P0-58 | 可后定 | VRChat 是否需要独立进程？ | 先同进程；需要崩溃隔离时再拆；一开始独立进程；其他 | 先同进程；需要崩溃隔离时再拆 |

## 九、进入 P1 的最终门槛

| 编号 | 必答问题 | 回答 |
| --- | --- | --- |
| P0-59 | 仓库目录、协作记录、文档 Owner 和归档规则是否已固定？ | 是 |
| P0-60 | 后续代码迁移的裁定方式是否已固定？ | 否，按模块单独裁定 |
| P0-61 | Runtime/Agent/State/Provider/World/Assembly 的所有权是否已固定？ | 是，具体契约仍需实现任务细化 |
| P0-62 | M1 的第一条垂直闭环和完成定义是否已固定？ | 是 |
| P0-63 | 测试命令、无网络约束、Review 证据和人工确认点是否已固定？ | 是 |
| P0-64 | 未决事项是否都明确归入后续 Phase，而不是隐含在实现中？ | 是 |

## 回答后的产物

完成回答后，应形成以下 P0 文件：

- 仓库结构与文档 Owner 规则。
- M1 目标、非目标和第一条垂直闭环。
- Runtime / Agent / State / Provider / World / Assembly 所有权表。
- 契约字段和失败语义草案。
- 测试、Review、人工监督和进入 P1 的验收门槛。

归档：本计划已复制到 `docs/agent-context/history/plans/1002bot-p0-decision-questions.md`；后续以历史副本作为 P0 计划快照。
