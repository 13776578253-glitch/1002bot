# Visualization 清理与 React Flow 单一运行时计划

Owner: packages/visualization 的 Core、React Flow 入口和构建脚本

Time: 2026-10-22

## 目标

让 React Flow 成为 visualization 的唯一运行时和交付入口。旧版 standalone HTML、FreeCanvas SVG 壳、旧模型和重复布局/路由实现从包内删除；原始实现只保留在已验证的 scratch 备份中。

## 已确认的保护边界

- 备份目录：scratch/visualization-legacy-html-backup-2026-10-21-0911/
- 备份清单：MANIFEST.json
- 备份包含原始 architecture-evolution.html、canvas-model.js、freecanvas.js、shell CSS/body 模板和构建脚本。
- 删除前重新校验 MANIFEST；删除后再次校验备份哈希不变。
- 不启动真实 bot，不访问网络，不使用 Playwright CLI wrapper。
- 仅使用 Codex 内置方式做页面验收；自动化验证继续使用本地 npm 脚本和 node:test。

## Wave A：冻结目标产物

1. 明确 React playground 是唯一交互交付物：packages/visualization/playground/、packages/visualization/src/react/、packages/visualization/src/core/。
2. 让 playground 使用明确的 track/stage 状态，画布、Inspector、选择、展开、拖拽、相机全部由 React Flow + Core CanvasModel 驱动。
3. 增加 React projection/store 的纯逻辑回归覆盖，保留 Core 25 项回归。

验收：React playground 使用 canonical adapter → Core engine → React Flow 单链路；无第二套图模型或布局入口。

## Wave B：删除 standalone 运行时

删除以下运行时入口和重复壳：

- src/render/freecanvas.js
- src/render/standalone-engine.ts
- src/render/standalone-engine.iife.js
- src/render-html.ts
- src/styles/shell.css
- src/styles/shell-body.html
- tools/build-html.mjs
- dist/architecture-evolution.html
- tests/render-html.test.ts

同步修改：

- src/index.ts 删除 renderHtml 导出。
- package.json 删除 standalone 构建链和 HTML 产物检查。
- tools/check-dist.mjs 只检查 Core、React 和 playground 需要的发布文件。
- README.md 删除 standalone/legacy compatibility 的使用说明，改为 React playground 和 React package export。

验收：源码和构建脚本不再引用 renderHtml、freecanvas、standalone-engine 或 architecture-evolution.html。

## Wave C：清理 legacy 目录

从 packages/visualization/legacy/ 删除已由备份覆盖且不再进入任何构建的旧原型、旧 renderer、旧 HTML、旧模型和旧校验文件。

保留策略：

- 生产包内不保留 legacy/。
- 原始文件只保留在 scratch 备份目录。
- 若某个历史图或研究材料仍有文档引用，先把引用迁移到 scratch/备份路径，再删除包内副本。

验收：packages/visualization/legacy/ 删除；全仓搜索不再出现包内 legacy 运行时引用；备份 MANIFEST 哈希完全不变。

## Wave D：收紧构建和发布面

1. build 只构建 Core、React declarations/JS。
2. build:web 构建唯一 playground。
3. 清理旧 dist 后重新生成，避免残留 standalone HTML。
4. 保留 ./、./stages、./react exports。
5. 更新 README、任务记录和产物检查脚本。

目标产物：

- dist/index.js
- dist/index.d.ts
- dist/react/index.js
- dist/react/index.d.ts
- dist/data/canonical-model.js
- playground/dist/index.html 及其 assets

## Wave E：验收与收口

顺序固定为：

1. 备份 MANIFEST 校验。
2. 删除 standalone/legacy 文件。
3. npm test
4. npm run typecheck
5. npm run typecheck:web
6. npm run build
7. npm run build:web
8. npm run check:dist
9. 主题选择器检查。
10. 使用 Codex 内置页面打开 playground 产物，检查三条路线和阶段切换、节点选择与 Inspector、聚合展开/收起、拖拽位置保持、相机缩放/平移、键盘和 aria 行为。
11. 最后重新校验备份 MANIFEST，并把删除清单、产物清单和验证结果追加到 current-task 记录。

## 完成判据

- React Flow 是唯一交互 renderer。
- 包内不存在 standalone HTML、FreeCanvas、旧 canvas model 或重复 legacy renderer。
- dist 不再生成 architecture-evolution.html。
- React/Core/build/test 全部通过。
- 原始旧版内容仍可从 scratch 备份恢复。
