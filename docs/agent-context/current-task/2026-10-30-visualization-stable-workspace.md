# Visualization stable workspace

Intent: 实施已确认的稳定布局、自动恢复、撤销与折叠关系聚合计划。

Logic: 为布局引入free/fixed/locked约束与原子事务，拆分持久化视图和交互临时态；路径与标签增量失效，选择/视口独立；在现有Canonical投影之外增加关系聚合，不改变原始图语义。

Impact: 可选公共persistence接口、Playground本机存储、画布操作与连接列表；不改真实报告数据、bot逻辑或现有数据适配器，不引入新布局库。

Verification plan: 模型行为回归、增量路由计数与精确路径校验、序列化/恢复与事务协作、聚合与定位测试，Core/Web/Playground类型检查、库/站点构建、全仓测试和原生浏览器操作及性能采样。

Time: 2026-10-31 00:25

Model milestone: 新增free/fixed/locked约束、固定障碍物原子展开、保护分组/解组、世界坐标补偿；新增可序列化工作视图、来源修订合并、100步事务历史及本机存储边界。增量几何使用节点/父级/邻接/空间索引，按端点与旧新障碍失效；路径和标签保持缓存，标签随路径段运输后做精确碰撞检查。折叠聚合在展示层保留所有Canonical边身份。

Verification: 当前完整工作区visualization 133/133测试通过，Core/Web/Playground类型检查、库构建85项产物与站点构建207模块通过；仓库pnpm test 242/242与根typecheck通过。模型/来源恢复/异步存储排序/聚合/路由/不变引用均有回归。公开接口和UI接入另作下一提交。

Performance investigation: M6手动分组的Node探针标签搜索为主要耗时，精确标签复用将计算P95从18.59ms降至5.59ms。浏览器在精确模式下最终连接节点采样23帧，帧P95=12.6ms、几何P95=13.8ms、约束P95=1.3ms、最多8/58条路径重算；无连接State采样32帧，帧P95=18.7ms、几何P95=0.5ms、零路径重算。采样为本机开发站点单次操作，不作为持续帧率承诺。
