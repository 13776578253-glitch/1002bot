# Visualization 扁平基线

Time: 2026-10-23

Intent: 重构评审发现嵌套坐标系缺陷后，先将 playground 退到无嵌套的扁平演示数据，稳定外壳与基础样式；节点逻辑与展开样式留待后续阶段处理。

Logic:
1. 新增 `playground/src/data/demo-stages.ts` 手写扁平数据：单路线 4 阶段，全部节点直挂根节点，无 group 嵌套、无端口声明；阶段间保留 added/modified/removed/rewired 演进供 Delta 面板与卡片高亮使用。
2. `playground/src/main.tsx` 改为导入演示数据；`dev` 脚本不再执行数据生成；删除 `playground/src/generated/`（`pnpm gen:data` 可随时重建 1002bot 数据）。
3. Sidebar 移除演示数据不涉及的 git 检出信息与聚合提示文案；ArchitectureBoard 去掉 `gitCheckoutMeta` 属性。
4. `tests/demo-data.test.ts` 锁定"数据扁平、每阶段可装配场景"基线。

Impact: 仅 playground 数据与外壳组件；Core/React 包运行时代码不变；`examples/1002bot` 与 `gen:data` 脚本保留。

Verification plan: 包级 test、typecheck、build:web；浏览器核对 4 阶段渲染、演进高亮与导航；提交前仓库级 `pnpm test` 与 `pnpm run typecheck`。

Open issues: none

## 2026-10-28 画布渲染修复

Intent: 恢复当前 Playground 画布渲染并核对 React Flow 端点连接。

Logic: 画布消费场景 hook 的 scene/error 状态；节点端口与连线使用同一 handle ID。保留现有演示数据和未提交布局修改。

Verification plan: 包级测试、类型检查、构建；在 Playground 检查页面与阶段交互。

Change: EvolutionCanvas 解包 scene/error 并显示场景错误；CardNode 和 AggregateNode 将节点 ID 传给 NodePorts，与边适配器共用端口 handle ID。

Verification: 2026-10-28 包级 test 10/10、typecheck 和 build:web 通过；Vite 页面显示画布，M1 至 M4 切换及节点详情可见。当前 Playground 为扁平无端口演示，嵌套、带端口连线及拖拽的浏览器验证待完成。画布初始布局较高，详情面板遮挡部分节点。
