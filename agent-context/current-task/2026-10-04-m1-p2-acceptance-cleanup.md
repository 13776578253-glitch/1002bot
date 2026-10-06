# M1 验收收尾与文档归档记录

Time: 2026-10-04

Change: 在 M1 已通过的基线上补充一个真实 World 返回 `unknown` 的集成测试；新增稳定架构图；将已完成任务记录复制到 `agent-context/finish-task/`，将已完成计划复制到 `agent-context/history/plans/`，并在原文件追加归档指针。

Impact: `ToolOutcome.unknown` 将通过 Runtime、Session 和 `callId` 配对得到可重复验证；文档按活动计划、当前任务、完成记录、历史计划和稳定架构分开存放，原始记录仍保留以满足 append-only 要求。

Verification: 修改后运行 `pnpm exec tsc --noEmit`、`pnpm test` 和 `pnpm run sample`；检查架构图中的实际路径、当前 M1 状态和规划边界与代码一致；逐份核对归档副本与原记录内容相同。

Open issues: Provider 错误码细分和多组件清理钩子属于后续里程碑，不在本次 M1 收尾中扩展。

Commit suggestion: docs(m1): close acceptance gaps and organize records

Update: 已新增 `tests/integration/m1-vertical.test.ts` 的 `unknown` ToolOutcome 集成测试，验证 World 回执以原始 `callId` 写入 JSONL；已新增 `docs/1002bot-当前进度与架构图.md`；已完成当前任务记录和计划的分类归档。

Verification: `pnpm test` 通过 10 项测试，`pnpm exec tsc --noEmit` 通过，`pnpm run sample` 输出 `status=stopped`、`value=1`、`entries=7`；5 组原件与归档副本的 SHA-256 均一致。
