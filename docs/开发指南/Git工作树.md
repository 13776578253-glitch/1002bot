Owner: `scripts/worktree.mjs`、`.gitignore`、`package.json` 的 `wt:new` / `wt:status`

# Git 工作树

本项目保留 main 主线与 feat/TUI 前端分支。主目录使用 main，TUI 使用项目内 .worktrees/TUI 的普通 Git worktree。创建方式参考 Incept/scripts/worktree.mjs 的登记与基线检查，未复制其数据库、端口或环境文件逻辑。

在干净的主目录 main 上执行：

```powershell
pnpm wt:new TUI --branch feat/TUI --base main
pnpm wt:status
```

工具只从明确的已提交基线创建，不复制主目录未提交文件。它拒绝目录碰撞、非法路径、未知基线、未提交主目录和未经声明的既有分支；既有分支必须与指定基线一致。目录与本地登记都由 gitignore 排除。

进入 .worktrees/TUI 后执行 `pnpm install:all`、`pnpm test`、`pnpm typecheck`。工作树拥有独立文件、依赖与构建产物；TUI 编辑和提交使用此目录。每次开工先核对 pwd、git branch --show-current、git worktree list。

.worktree-local/worktree.json 记录路径、分支与基线 SHA，rules.md 提供本地隔离提示。登记不代替 Git 的真实状态；wt:status 读取实际检出、未提交数量和与 main 的提交差异。

Git 引用、hooks、远端以及明确共用的端口/会话文件不受目录隔离保护。管理分支和推送需要对应的负责人任务。本工具不自动删除工作树或分支；回收时先验证改动已提交、历史已包含且不需要的忽略文件已另存，再执行明确的 Git 管理操作。
