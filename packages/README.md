Owner: `../pnpm-workspace.yaml`

# 独立包分类与架构目录

`packages/` 维护项目内部的独立工作区子包。核心逻辑与运行时保留在根包 `1002bot` 与 `src/`；外部扩展、前端应用、独立可视化和公共契约按职责边界下沉至各子包。

每个实际包必须具备独立的 `package.json`、`tsconfig.json`、构建脚本与测试；分类目录本身不声明依赖。

## 目录结构与包职责

| 分类 / 路径 | 包名 | 类型 | 职责说明 | 详情文档 |
| --- | --- | --- | --- | --- |
| `apps/tui` | `@1002bot/tui` | 可选前端应用 | 全屏终端交互界面（TUI），基于轻量控制契约与原始 TTY 终端驱动，不直接装配核心运行时 | [`apps/tui/README.md`](apps/tui/README.md) |
| `shared/control-api` | `@1002bot/control-api` | 共享契约 | 核心与前端/客户端共用的控制能力契约（`RuntimeControl`、输入回执、快照与生命周期类型），无外部运行依赖 | [`shared/control-api/README.md`](shared/control-api/README.md) |
| `extensions/world-qq` | `@1002bot/world-qq` | 外部世界扩展 | 基于 OneBot v11 正向 WebSocket 的 QQ World 实现，支持单会话绑定、保序投递、磁盘 JSONL 领域记录与纯内存记录模式 | [`extensions/world-qq/README.md`](extensions/world-qq/README.md) |
| `visualization` | `@1002bot/visualization` | 独立组件/应用 | 递归架构演化画布与基线比对前端，提供无状态 Core（图模型/投影/几何避障）、React 画布组件（`VisualizationCanvas`）与本地 Playground 站点 | [`visualization/README.md`](visualization/README.md) |

> `examples/*`（如 `examples/tui`、`examples/qq`）与 `tests/integration` 为装配样例与端到端跨包验证工作区，不作为运行依赖发布或从外部包直接引用。

## 依赖与边界规则

1. **分类目录规则**：`packages/apps/`、`packages/shared/` 与 `packages/extensions/` 仅为物理归类目录，严禁在分类目录层级创建 `package.json` 或声明依赖。
2. **包间解耦与契约优先**：
   - 前端应用（如 `apps/tui`）仅依赖 `@1002bot/control-api`，不导入核心私有实现或特定 World 驱动。
   - 共享契约（`shared/control-api`）保持零运行时依赖，产物为空模块，仅输出 TypeScript 类型声明。
   - 平台扩展（`extensions/world-qq`）以 `1002bot` 根包为 peer dependency，独立管理 `ws` 等网络依赖，核心基础检查不依赖 QQ 扩展。
   - 可视化库（`visualization`）的 Core 模块完全不依赖 React 与 UI 框架；库源码不引用 Playground 或业务示例数据。
3. **工作区依赖引用**：工作区内各包相互引用统一使用 `workspace:*`，构建与打包发布时由工具链转换为对应版本号。

## 常用操作与运行命令

从仓库根目录执行以下命令：

### 全局验证与构建

```sh
# 构建核心与已纳入常规链路的子包（control-api, core, tui, world-qq）
pnpm build:all

# 全仓类型检查
pnpm run typecheck

# 全仓自动化测试（含核心、集成与扩展包测试）
pnpm test
```

### 单包操作

```sh
# Visualization 启动开发服务（固定 127.0.0.1:5199）
pnpm dev
# 或通过包过滤器运行构建、检查与测试
pnpm --filter @1002bot/visualization dev
pnpm --filter @1002bot/visualization build
pnpm --filter @1002bot/visualization build:web
pnpm --filter @1002bot/visualization test

# TUI 独立验证与组合样例
pnpm --filter @1002bot/tui build
pnpm --filter @1002bot/tui typecheck
pnpm dev:tui
pnpm probe:tui

# QQ World 独立验证与样例
pnpm --filter @1002bot/world-qq build
pnpm --filter @1002bot/world-qq test
pnpm sample:qq

# Control API 构建与检查
pnpm --filter @1002bot/control-api build
pnpm --filter @1002bot/control-api typecheck
```

安装入口、离线缓存管理与历史包迁移说明参见 [包安装与迁移](../docs/使用说明/包安装与迁移.md)。
