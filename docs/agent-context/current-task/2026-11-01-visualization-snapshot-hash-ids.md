# Snapshot hash ids

Intent: Stop naming project snapshots as M0/M1. A snapshot id is the first eight hex characters of SHA-256 over its `select` and `remove` blocks (`02b980d3` for the current snapshot). File names, the view `stageId`, workspace keys and revision strings use that id; `label` and `title` remain user-editable display names. Update the manifest, view id/file, workspace seed, initial baseline selection, tests and READMEs. Legacy report stages keep their historical ids.

Verification: package tests and typecheck; the dev server resolves `stages/02b980d3.json` and `views/overview.json`; the project-data test reads the snapshot id from the stage file instead of asserting a literal.

Result: 快照 id 为 `02b980d3`。`stages/M0.json` → `stages/02b980d3.json`，`views/M0.json` → `views/overview.json`；视图 `id` 改为 `overview`，`label`/`title` 改为 `最小运行基座`；项目 revision 改为 `project-v1`；工作空间种子、`initialBaselineId`、测试与 README 同步。旧报告数据集的 M1.0–M6.0 保持原样。

Verification: package tests 220/220; package typecheck passed; the dev server resolves `stages/02b980d3.json` and `views/overview.json`.

Update: 新增 `tools/snapshot-id.ts`：打印 id、`--check`、`--check --all`、`--write`（写回 id 并按 id 重命名）。新增 `pnpm check:snapshots` 与架构测试 `tests/architecture/snapshot-ids.test.ts`，校验每个项目快照的文件名与 `id`。用法写入 `datasets/README.md`，包 README 的命令列表与模块表同步。

Verification: `pnpm check:snapshots` 通过；`--write` 在 `.scratch` 副本上完成重命名；包测试 221/221；包类型检查通过。
