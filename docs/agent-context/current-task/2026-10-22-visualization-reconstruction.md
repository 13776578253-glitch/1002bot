# Visualization 重建三阶段实施

Time: 2026-10-22

Intent: 按照方案 A 将 visualization 包压缩为三个连续交付阶段，彻底摆脱碎片化 Wave 与粗糙白板状态。采用推荐的目录解耦方案：将看板组件解耦至 playground/src/board/，图形引擎引入分层几何与正交路由计算（elk/geometry/ports），将 1002bot 专属数据迁移至 examples/1002bot/。

Logic:
1. 阶段一（产品外壳）：在 playground/src/board/ 下拆分实现 ArchitectureBoard、Sidebar、Stagebar、Toolbar、DeltaBar、Inspector 等标准组件，复原完整产品交互外观。
2. 阶段二（图形引擎与路由）：实现 core/layout/geometry.ts、core/layout/elk.ts、react/nodes/ports.tsx；在 OrthoEdge 中消费真实折线路径；端点投影实现折叠时映射到最近祖先、展开时映射到真实端口。
3. 阶段三（业务数据解耦与演进体验）：将 src/data/ 与 src/adapters/ 迁移至 examples/1002bot/，通用包内保留纯粹的引擎、组件与样式，构建脚本更新数据生成路径。

Impact: 重构 packages/visualization 目录结构，保持公共导出与测试通过。

Verification plan:
- 检查构建、测试与 web 类型检查通过；
- 启动 Vite playground 验证三条路线演进浏览与操作交互；
- node:test 测试套件覆盖更新后的路径。

Open issues: none


## 实施与验证进展

Time: 2026-10-22 19:30

Change:
1. 阶段一（产品外壳）：在 playground/src/board/ 完整实现 ArchitectureBoard、Sidebar、Stagebar、Toolbar、DeltaBar、Inspector 等外壳组件；在 default.css 恢复高保真看板样式；支持开发路线切换、带序号阶段列表、阶段导航、展开/收起一层、自动整理及抽屉详情。
2. 阶段二（图形引擎与路由）：实现 core/layout/geometry.ts（包含 A* 正交避障路由器与圆角路径生成）、core/layout/elk.ts（分层嵌套布局）、react/nodes/ports.tsx（稳定端口把手）；OrthoEdge 正确消费布局输出的折线路径，杜绝穿模与乱线；保持端点折叠与展开投影。
3. 阶段三（业务数据解耦）：将 1002bot 专属模型与适配代码迁移至 examples/1002bot/（canonical-model.ts、stages.ts、adapter.ts）；从 package.json 导出中解耦业务数据，使 visualization 包纯化为通用的 Schema、图形引擎、React Flow 组件与主题；切换阶段时延续展开状态与手动坐标。

Verification:
- packages/visualization 测试套件扩展至 28 项，node:test 全部通过（28/28）；
- tsc -p tsconfig.json 与 tsc -p tsconfig.web.json 双配置类型检查通过；
- pnpm --filter @1002bot/visualization build 生成纯净 typed 产物并通过 check:dist；
- pnpm --filter @1002bot/visualization build:web 打包 playground 成功（195 模块，vendor 397KB）；
- 仓库级 pnpm test 242/242 项全绿，pnpm run typecheck 全绿。

Commit suggestion: refactor(visualization): implement modular product board and decoupled elk layout

## 2026-10-22 目标树修复

Intent: 对照用户给出的 packages/visualization 结构核对当前实现，修复缺失的通用出口、布局/路由、React Flow 看板与 1002bot 示例适配，并保持已有工作区改动。

Planned logic: 先以目录、导出、脚本、测试和类型检查建立基线；按失败证据修复结构或行为；完成后追加实际变更、验证命令与未完成项。

Verification plan: packages/visualization 的 test、typecheck、typecheck:web、build、build:web、check:dist；必要时使用 Codex 原生页面检查 playground。

Open issues: baseline pending

## 2026-10-22 目标树修复：重构规划冻结

Change:
1. 根据当前实现和用户要求，确认需要重写 Canonical Graph、Projection、Layout Engine、React Flow Adapter、Canvas Renderer 五层契约；规划文件为 docs/agent-context/plans/2026-10-22-visualization-graph-layer-rewrite.md。
2. 规划将递归 children/path 边端点替换为扁平 CanonicalGraph、稳定 node/edge/port ID、显式 parentId、端口方向与 boundary port；Projection 改用 node ID 展开状态；Layout 输出世界坐标与稳定 edge route；React Flow 使用稳定 node/edge/handle ID；Canvas Renderer 拆出 scene/controller/panels。
3. 记录当前已确认缺口：GraphNode.ports 未贯穿 Canvas/Flow data，projectionToFlow 丢弃 routed points，ArchitectureBoard 与 EvolutionCanvas 重复承担 Inspector，当前布局仍按路径推断父子关系。

Verification:
- node --experimental-strip-types --test packages/visualization/tests/*.test.ts：28/28 通过。
- node_modules/.bin/tsc -p packages/visualization/tsconfig.json --noEmit：通过。
- node_modules/.bin/tsc -p packages/visualization/tsconfig.web.json --noEmit：通过。
- node_modules/.bin/tsc -p packages/visualization/tsconfig.build.json --noEmit：通过。
- pnpm 基线命令受 Corepack 下载 pnpm 10.30.3 的网络隔离影响，未执行成功。

Open issues: 需要按规划 Phase 1-6 实施；本轮未改动运行时代码。

Commit suggestion: docs(visualization): plan stable graph layer rewrite

## 2026-10-22 规划修订：数据边界、单一布局与 Scene 装配

Change:
1. 明确 Canonical Graph、Projection、Layout/Scene、React Store 四类数据的唯一权威位置；adapter 负责节点解析和 Graph Patch，Core 负责递归与投影，React 不解析业务节点。
2. 将 layered.ts 定义为唯一 ELK 结构布局；pinned.ts 仅作为 ELK 输入约束和输出修正器；geometry.ts 只负责坐标/边界/端口几何；router.ts 负责最终关系路径及校验；metrics.ts 与 CSS variables、ResizeObserver 共同收敛实际尺寸。
3. 将 core/engine/scene.ts 定义为唯一场景装配入口，增加 sceneVersion、graphRevision、stageId、metricsRevision 和 React hook request sequence；Inspector/Delta 统一归属 react/panels，playground/board 只做组合和布局。
4. 划清 schema/validate.ts 与 graph/validate.ts 的结构校验和图语义校验职责；保留 examples/1002bot 为业务过渡目录，并核对当前没有 ./stages 消费者。

Verification: 计划文件 diff check 通过；本轮只修改规划和任务记录，上一轮可视化 28/28 测试及 Core/Web/Build 类型检查保持通过。

Open issues: 进入实现前需要按 Phase 0 冻结 GraphPatch、metrics measurement round-trip 和 ELK provider 的具体 API。

Commit suggestion: docs(visualization): refine graph layer boundaries

## 2026-10-22 执行批准：Graph/Scene/Layout 重构启动

Intent: 用户批准在 feat/visualization 分支实施完整重构，重点是 Canvas Renderer 与 Layout Engine；样式先对齐参考图的轻量视觉约束，具体参数通过 Theme/metrics 保持可调。

Scope: Canonical Graph、Projection、Layout、engine/scene.ts、React Flow Adapter、Canvas Renderer、Store 和 1002bot adapter；保持数据/样式/解析/递归核心分离；不把业务数据引入正式包入口。

Accepted design: layered.ts 是唯一 ELK 结构布局；pinned.ts 仅提供约束和输出修正；geometry.ts 只处理坐标/边界/端口几何；router.ts 负责最终关系路径；metrics.ts 与 React 实际尺寸闭环；engine/scene.ts 是唯一场景装配入口；React panels 只保留单一 Inspector/Delta 实现。

Visual direction: 参考图的浅色网格/点阵背景、白色圆角节点、状态色边框、聚合虚线容器、细灰正交箭头与少量增量色标，样式实现必须通过 theme tokens 和 metrics 调整。

Verification plan: 先通过 Core/React 单元与集成测试，再执行 typecheck、build、build:web、check:dist；使用 Codex 原生方式验收 playground，重点检查布局、折叠投影、异步场景版本、拖拽位置、端口和面板单一归属。

Open issues: implementation in progress

## 2026-10-22 重构实现收尾

Change:
1. 完成扁平 Canonical Graph、Graph Patch revision、schema/graph 双层校验、stable ID Projection、boundary port 和 stable evolution diff。
2. 完成唯一 layered/ELK provider、pinned 约束装饰、metrics、geometry、router 与世界坐标 LayoutResult；删除竞争性的独立 tidy 实现，保留兼容转发。
3. 新增 engine/scene.ts 唯一场景装配入口和异步 use-canvas-scene request sequence；React Flow Adapter 改为稳定 node/edge/handle ID 与 parent-local 坐标转换。
4. 重构 Canvas Renderer、Store、Card/Aggregate/Ports、Inspector/DeltaPanel；删除 playground 重复面板；主题增加点阵背景、白色圆角节点和聚合虚线边界的可调 token。
5. 1002bot adapter 改为 flat graph snapshots，重新生成 12 阶段 playground 数据；正式包入口保持通用 Core/React，不依赖业务数据。
6. 用新契约测试替换旧递归模型测试，覆盖 Graph Patch、Projection、Scene、Layout 和 React Flow Adapter。

Verification:
- node --experimental-strip-types --test packages/visualization/tests/*.test.ts：8/8 通过。
- packages/visualization tsconfig、tsconfig.web、tsconfig.build：通过。
- typed dist 编译、声明重写、check-dist：通过。
- playground Vite production build：201 modules，通过。
- 12 个 1002bot 阶段均可生成 CanvasScene。
- Codex 原生浏览器页面已观察到 playground、阶段导航、Inspector、展开后的嵌套节点和 React Flow 控件；另一个新端口页面受本机浏览器 localhost 访问限制。

Open issues: 具体色值、状态文案和卡片细节留在 Theme/metrics 后续微调；当前 pnpm 仍受 Corepack 网络隔离影响。

Commit suggestion: refactor(visualization): rebuild scene and layout pipeline
