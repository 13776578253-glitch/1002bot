# Visualization stable workspace

Intent: 实施已确认的稳定布局、自动恢复、撤销与折叠关系聚合计划。

Logic: 为布局引入free/fixed/locked约束与原子事务，拆分持久化视图和交互临时态；路径与标签增量失效，选择/视口独立；在现有Canonical投影之外增加关系聚合，不改变原始图语义。

Impact: 可选公共persistence接口、Playground本机存储、画布操作与连接列表；不改真实报告数据、bot逻辑或现有数据适配器，不引入新布局库。

Verification plan: 模型行为回归、增量路由计数与精确路径校验、序列化/恢复与事务协作、聚合与定位测试，Core/Web/Playground类型检查、库/站点构建、全仓测试和原生浏览器操作及性能采样。

Time: 2026-10-31 00:25

Model milestone: 新增free/fixed/locked约束、固定障碍物原子展开、保护分组/解组、世界坐标补偿；新增可序列化工作视图、来源修订合并、100步事务历史及本机存储边界。增量几何使用节点/父级/邻接/空间索引，按端点与旧新障碍失效；路径和标签保持缓存，标签随路径段运输后做精确碰撞检查。折叠聚合在展示层保留所有Canonical边身份。

Verification: 当前完整工作区visualization 133/133测试通过，Core/Web/Playground类型检查、库构建85项产物与站点构建207模块通过；仓库pnpm test 242/242与根typecheck通过。模型/来源恢复/异步存储排序/聚合/路由/不变引用均有回归。公开接口和UI接入另作下一提交。

Performance investigation: M6手动分组的Node探针标签搜索为主要耗时，精确标签复用将计算P95从18.59ms降至5.59ms。浏览器在精确模式下最终连接节点采样23帧，帧P95=12.6ms、几何P95=13.8ms、约束P95=1.3ms、最多8/58条路径重算；无连接State采样32帧，帧P95=18.7ms、几何P95=0.5ms、零路径重算。采样为本机开发站点单次操作，不作为持续帧率承诺。

Time: 2026-10-31 11:46 (Asia/Singapore)

Correction: 前一条Time字段00:25是未核实的记录时间；本次收尾时间按UTC时钟03:46转换为Asia/Singapore 11:46。此前模型验收的具体执行时刻以保存日志为准。

Change: 模型里程碑已提交d09be65。完成事务控制器、按阶段保存/恢复、来源修订前置合并、顺序化异步写入和失败重试；接入固定/锁定/冻结及撤销重做，拖动和视口分别在结束时保存。展示层接入聚合连接列表及原始端点定位；公开持久化接口和Playground localStorage适配器，通用工作视图不绑定业务存储键。

Native verification: 原生浏览器完成冻结12个可见节点及完整撤销、锁定拖动保护及刷新恢复、固定节点手动移动/撤销、固定冲突原子保留、跨阶段展开同步、手动分组改名/刷新/整体移动与撤销。分组移动前后子节点局部坐标保持(24,60)。M6含103条Canonical关系，折叠原投影56条，展示27条，其中16条聚合；5条存储关系列表保留成员、路径与新增文字。定位detached / late成功展开祖先并聚焦端点。刷新后模块几何和视口逐值一致。最后完整刷新后的浏览器错误日志为空。截图：.scratch/visualization-stable-workspace.png。

Final checks: visualization 133/133、全仓242/242测试通过；Core/Web/Playground及全仓类型检查通过，库构建85项产物、站点构建207模块通过。最终全仓检查日志：.scratch/visualization-stable-final-root-tests.log与.scratch/visualization-stable-final-root-typecheck.log。git diff --check通过。

Scope: 自动恢复当前工作视图；无命名视图、导入导出、全局重新布局、ELK、Worker、圈画注释或附着点编辑。性能结果为本机开发站点采样；连接节点帧P95 12.6ms，无连接State帧P95 18.7ms，持续60 FPS目标仍需更长时间和更多设备采样。

Archive: 计划原文复制到docs/agent-context/history/plans/2026-10-30-visualization-stable-workspace.md并校验SHA-256。current-task现有34条记录归档到docs/agent-context/finish-task/2026-10-31-visualization-stable-workspace-snapshot，原件保留并由该目录索引标记已归档，逐件验证SHA-256。

Open issues: none
Commit suggestion: feat(visualization): restore views and inspect folded relations
