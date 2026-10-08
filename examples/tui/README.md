Owner: `sample.ts`、`package.json`

# 离线 TUI 组合样例

本开发包通过公开包入口装配核心与 TUI，使用真实 FixtureWorld、JSONL 和脚本 Provider。内部 runTerminal 只作为显式非 TTY 回退。测试夹具和行式入口属于仓库开发资源，不进入 TUI 发布产物。

在仓库根执行 `pnpm install:all`、`pnpm dev:tui`。核心单独安装不包含此包。
