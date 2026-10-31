# Visualization incremental stage layout P0+P1

Intent: 实施已确认的增量阶段快照、显式确认、冻结子图和首版冻结路径。阶段切换只处理来源差异，失败原子阻止并提供只读候选预览；冻结组保护内部节点与内部路径，跨边界路径首版为 `pinned`。

Logic: 来源 `VisualizationBaseline` 增加阶段差异与替换来源，workspace 升级为 v2 并区分草稿与已确认快照。阶段切换由纯函数流水线 `Prepare → Diff → Place → Route → Validate → Commit` 完成；新增节点优先填补空隙，必要时展开必要祖先和有限扩容，冻结/锁定对象零位移。冻结组复用现有 `structure` / `cluster`，内部节点锁定、内部路径锁定、容器可整体移动；路径使用 canonical edge ID，冻结路径作为后续布线障碍。

Impact: 更新 `packages/visualization` 的 Core 合同、workspace 持久化、React 会话/控制器、节点与连线控件及测试。保持 Canonical Graph 只读；不接入真实 bot，不改变报告数据语义。旧 v1 工作视图迁移为 v2，已确认字段缺失时按迁移快照处理。

Verification plan: 覆盖阶段差异、替换来源、v1→v2 迁移、显式确认、首次 M1→M2 增量安置、失败回滚与只读预览、冻结组整体移动、只读展开、内部锁定路径逐点不变、跨边界 pinned 路径、路径障碍与刷新恢复。运行包级测试、类型检查、库/站点构建；使用 Playground 报告数据做原生浏览器验收并记录几何和耗时指标。提交前运行仓库测试与类型检查。

Time: 2026-10-31 14:32

Change: 完成 P0/P1。新增 `core/graph/diff.ts`、`stage-transition.ts`、`placement.ts`、`frozen.ts`、`edge-routes.ts`、`transition-panel.tsx`。workspace 升级为 v2，区分草稿与已确认快照，v1 记录迁移为已确认 v2；新增 `previousId`、`previousStageId`、路径/冻结组/覆盖层占位和阶段切换记录。控制器接入显式确认、增量切换、失败只读候选预览、冻结/解冻、只读展开、路径 auto/pinned/locked 与刷新恢复。路由缓存支持保留路径障碍，阶段校验拒绝锁定路径穿过新布局；跨阶段展开同步跳过冻结容器。

Verification: 包级 154/154 测试通过；Core/Web/Playground 类型检查通过；库构建验证 101 个 JS/声明/样式产物；站点构建 213 模块。仓库 `pnpm test` 242/242 通过，根 `pnpm run typecheck` 通过。浏览器在独立端口 5200 验收：M1 冻结 Runtime 后切 M2 被原子阻止，候选预览列出 3 个 frozen-violation，baseline 保持 M1；取消、解冻、重新确认后 M2 成功，25 个可见节点；M2 冻结 10 个节点，路径锁定后存储为 v2 且 baselineId=M2.0，刷新恢复 25 个节点和锁定路径；浏览器 error 列表为空。自由节点保留率 8/14=57%，位移来自必要容器展开；冻结成员零位移和冻结组成功跨阶段由模型回归覆盖。截图：`.scratch/visualization-p0p1-blocked.png`、`.scratch/visualization-p0p1-m2-success.png`、`.scratch/visualization-p0p1-frozen.png`、`.scratch/visualization-p0p1-route.png`。

Open issues: 自由节点在必要容器扩容时仍会移动，当前按指标记录并与冻结组区分；首版跨边界路径为 pinned，分段锁定留待后续；5199 的既有 Vite 进程出现过热更新缓存，验收使用独立端口 5200，不改动既有进程。

Commit suggestion: feat(visualization): add incremental stage layout and frozen routes

Archive: 计划原文复制到 `docs/agent-context/history/plans/2026-10-31-visualization-incremental-stage-layout.md`，SHA-256 `db07518299fa45cfa68d6b77ea502c39aa947376cd6aaedca52dca21a208390b` 一致。

Time: 2026-10-31
Review takeover: 用户要求先修稳P0/P1并重排后续路线。审查发现同会话阶段切回读初始保存值、未合并旧来源便升级revision、冻结成员删除静默丢账本、已确认自由节点仍被自动移动、owner路径标签坐标不一致、过期路径仍套用。此前“完成P0/P1”结论修正为接口与基础实现已具备，关键不变量尚未通过验收。

Intent: 保留StageDiff及workspace v2框架；修复阶段内容缓存与修订归属、父阶段继承、候选预览隔离、冻结账本恢复及路径保护边界。模型修复保护已确认几何并把冻结结构变更转为结构化冲突。补行为回归与原生浏览器验证；P2/P3/P4不在本轮实现。

Verification: 添加往返阶段保存、来源修订、冻结删除与解冻恢复、路径端点/标签与拖动保护测试；运行包与全仓必要检查。历史计划保持归档原文，修订路线另存本轮接手计划。

Time: 2026-10-31 15:48 (Asia/Singapore)
Change: 接手修复阶段缓存与修订归属、显式父阶段确认、候选视口/路径隔离、冻结前约束/人工路径恢复、owner标签坐标、真实端点捕获、端口指纹与锁定移动校验；锁定路径失效改为旧新区间空间失效，避免冻结拖动全图重算。v1迁移为未确认草稿。完整审查与未完成项见current-task/2026-10-31-visualization-takeover-review.md，修订路线见plans/2026-10-31-visualization-takeover.md；旧计划与归档原文保留。
Verification: 包164/164测试通过，Core/Web/Playground类型检查通过，库构建101项产物、站点213模块通过。全仓第一次241通过/1取消（m4-delivery容量测试90秒超时），串行复跑242/242通过，根类型检查通过。日志位于.scratch/visualization-takeover-*。原生5199浏览器验证M1移动State后M1→M2→M1位置字符串相同、刷新恢复、冻结Runtime/解冻恢复free/撤销冻结，最终刷新error列表为空。截图.scratch/visualization-takeover.png。
Status: 完成审查及第一批纠错，P0/P1整体尚未验收关闭。默认首次M1→M2因旧展开算法推动agent而严格阻止，源布局保留。完整冻结后代路径、跨边界分段保护、自动路径跨阶段复用和来源修订三方合并仍待实现，按修订路线优先于P2推进。
Archive: current-task记录复制到finish-task/2026-10-31-visualization-takeover-snapshot；索引标记原件已归档，原件保留且逐件SHA-256校验。takeover路线仍在实施，保留在plans，不标记完成归档。
