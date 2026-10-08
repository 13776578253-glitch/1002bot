Owner: `src/index.ts` 的 `runTui`、`src/terminal.ts` 的 `TuiOptions`、`package.json`

# 全屏 TUI 包

`@1002bot/tui` 是可选前端，运行依赖只有轻量控制契约与 string-width。调用方装配并启动核心，再将符合 RuntimeControl 的对象传给 runTui；本包不装配 World、Provider 或存储。

包入口：`import { runTui } from '@1002bot/tui'`。全屏要求支持原始模式的 TTY；重定向时可显式传入 `fallback`，否则启动拒绝并保留核心生命周期由调用方控制。项目离线样例注入内部行式 Console，正式包不引用该测试入口。

源码独立命令：`pnpm --filter @1002bot/tui build`、`typecheck`、`test`、`probe`。构建前先构建契约包。探针也可在安装产物中运行 `pnpm exec bot-tui-probe`。

根目录 `pnpm dev:tui` 使用可选组合样例；安装与旧路径迁移见 [包安装说明](../../../docs/使用说明/包安装与迁移.md)。当前仍使用既有终端驱动，OpenTUI 替换另行推进。
