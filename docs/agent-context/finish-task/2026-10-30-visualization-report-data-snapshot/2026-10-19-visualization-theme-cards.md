# Visualization React 主题样式

Time: 2026-10-19

目标：为 `packages/visualization` 定义 React Flow 叶子卡片、聚合容器、正交边、标签和展开按钮的纯 CSS 主题，并提供可直接打开的静态预览页。

实现：在 `src/themes/default.css` 集中定义网格、表面、文字、状态与连线变量，并为 core `NodeDeltaKind` 的每个状态提供修饰类；`planned` 作为独立虚线视觉状态。预览页手工组合三类卡片、聚合容器、状态样本和带标签 SVG 折线。

影响：只新增主题 CSS、主题 README 和 playground 文件，不修改 `src/react/` 组件逻辑。页面直接引用 CSS 相对路径。

验证：读取 CSS 核对变量、选择器和括号平衡；用本地静态服务器与浏览器无头渲染检查类名效果和页面引用；运行包内现有测试与类型检查。

Open issues: none

Commit suggestion: feat(visualization): add React Flow theme styles

## 实施与自查

Change: 新增 `src/themes/default.css`，定义画布网格、卡片、状态、聚合容器、正交边、标签胶囊和圆钮样式；新增主题 README、静态预览页和零依赖 CSS 自检脚本。CSS 用根类 `av-theme`，节点状态用 `av-delta-*`，设计态用 `av-planned`；组件可在状态根提供 `data-status-label` 并留空 `.av-card-status` 读取约定文案。

Verification: `tools/check-theme.mjs` 通过，花括号平衡且 23 个必需选择器存在；静态预览包含 3 张卡片、2 段正交 SVG 路径、`depends on` 标签和正确的 CSS 相对链接。包内 Node 测试 9/13 通过，4 个 adapter 基础快照校验失败，原因是既有 fixture 的边端点未解析；TypeScript 检查因工作区未安装 `@xyflow/react` 与 `zustand` 失败。`pnpm test` 的 workspace 依赖状态检查因沙箱无法创建 pnpm store 符号链接而退出。浏览器可视化截图受 Windows 沙箱无法启动 Edge 及内嵌浏览器拒绝本地协议影响，未生成截图。

Open issues: React 组件依赖与 adapter fixture 需在对应工作线补齐后复跑全量检查。

Commit suggestion: feat(visualization): add React Flow theme styles
