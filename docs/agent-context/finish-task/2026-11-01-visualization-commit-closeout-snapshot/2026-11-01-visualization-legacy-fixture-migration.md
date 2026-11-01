# Visualization 旧数据集迁至测试夹具

Intent: `datasets/progress-reports/architecture.json` 的唯一剩余消费者是旧报告适配器的测试，迁到 `packages/visualization/tests/fixtures/legacy-reports.json` 以符合共享测试夹具位置；逐字节备份目录迁到仓库根 `.scratch/`，退出版本控制。同步更新五处测试读取路径、`datasets/progress-reports/README.md` 与包 README 的文件职责说明。项目数据集、适配器合同、Playground 加载路径不变。

Verification: 运行 `pnpm test` 与 `pnpm typecheck`；确认 `datasets/` 下不再包含旧数据集与备份目录，`src/` 无新增引用，`git status` 仅显示预期改动。

Result: 旧数据集迁至 `tests/fixtures/legacy-reports.json`，git 识别为改名；备份目录迁至 `.scratch/visualization-backups/2026-11-01-before-project-model/`，三个文件退出版本控制。五处测试读取路径、`datasets/progress-reports/README.md` 与包 README 的文件职责说明已更新，旧任务记录的结论已追加更正。备份目录内的 manifest.json 保留迁移时的原始路径与 SHA-256，作为历史记录。包测试 216/216 通过，`pnpm typecheck` 通过，包内无残留旧路径引用。

Open issues: none

Commit suggestion: test(visualization): move legacy report dataset into test fixtures
