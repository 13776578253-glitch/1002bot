# Visualization progress-report data

Intent: 使用 docs/进度汇报 构建真实历史架构输入，数据独立于代码，适配器可迁移并保持画布无业务依赖。

Logic: 从十份阶段报告提取已实现组件、所有权层级、方向链路和显式替换，保存为 JSON 目录及阶段增量；纯适配器组装完整快照和统一变化标记，Playground 从样例切换到报告输入。保留来源路径与启用状态，避免将后续能力倒写到早期阶段。使用类型契约和已有画布输入校验，不增加重复兜底分支。

Impact: 增加数据与适配器公共入口，替换 Playground 输入；不改画布交互和 bot 执行逻辑。原样例继续用于现有交互回归。

Verification plan: 数据溯源与阶段演进集成测试、适配器通用输入测试、跨层投影、模块边界与发布检查、包级和全仓测试及类型检查、原生站点验收。

Loading: Playground 使用静态资源 URL 与 fetch 加载 JSON，站点构建保留独立 JSON 产物，业务数据不内联至应用 JS；适配器继续仅接收已加载的类型化对象。

Change: 新增独立 JSON 实体目录与十个累计阶段，记录来源报告、历史实现路径、稳定身份、层级、条件链路与显式替换。src/adapters/progress-reports 为纯类型化转换模块，独立导出 ./adapters/progress-reports；Playground 的 baselines.ts 负责 URL 加载。通用 Core、React 与适配器均不导入数据集，原样例保留供交互回归使用。

Review: 对照报告复核并纠正 TriggerChannel 终态所有权、M4 subscribeDeliveries 顺序入口、QQ 投递泵保存前缀、QQ 已出队固定输入、心跳默认策略与任务到期入口。M6 保留 guarded 和默认调用路径，将操作登记记为可选新增，并明确启用条件、撤权确认与迟到确认；ResponseWorld 归独立 M6 装配，QQ Chat/TUI 默认关闭。

Verification: visualization 94/94 项测试通过，含三项通用适配器测试与五项报告数据集成测试；Core/Web/Playground 类型检查通过。库构建验证67项产物并 smoke import 新适配器；站点构建198模块，单独输出 architecture JSON 与应用 JS。仓库 pnpm test 242/242 通过，根 typecheck 通过；使用已缓存 pnpm 和任务局部命令包装，未安装依赖。

Browser verification: 原生 IAB 根入口加载报告 JSON，十项基线可选；M6 展开 Runtime、TriggerChannel、OperationRegistry，M3 展开 Runtime→TriggerRun→有界调用，M2/M3切换保留 Runtime 与目标缓存展开。最终页面展示 M3、两种显式变化文字及报告链路，浏览器 error 列表为空。证据：.scratch/visualization-progress-reports.png。

Archive: 计划原文复制至 history/plans/2026-10-30-visualization-report-data.md；当前33条任务记录快照存于 finish-task/2026-10-30-visualization-report-data-snapshot，逐文件SHA-256清单与索引标记归档来源，保留原记录。

Open issues: none within this data integration.

Commit suggestion: feat(visualization): load report baselines through an adapter
