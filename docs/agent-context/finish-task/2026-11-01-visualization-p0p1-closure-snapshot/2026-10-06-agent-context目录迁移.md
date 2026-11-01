# agent-context 目录迁移

Time: 2026-10-06

Request: VS Code 将 agent-context 移到 docs/agent-context 时报告 EPERM。负责人确认按截图目标迁移，并同步规范入口和当前文档链接；另要求核实 GitHub 绑定及推送权限。

Baseline: 本地 main 分支初始提交为 750bc45，迁移前工作区干净，agent-context 共 30 个文件，目标目录不存在。源目录与 docs 没有显式拒绝 ACL；只读打开 DELETE 权限的目录句柄成功，当前探针未发现阻止该权限打开的占用。该结果不能追溯截图发生时的具体锁定进程。

Plan: 先记录文件散列，再在项目目录内移动整个 agent-context，逐文件确认移动未改变内容。按负责人授权同步 Markdown 链接和项目内路径引用，保留历史记录正文与结论；原始版本继续保留在 Git 初始提交。根 AGENTS.md 指向新规范位置，管理记录仍按 agent-context 规则组织。

Impact: 文档目录与入口迁移，不修改业务代码或本机 ACL，不结束编辑器进程。scratch 中受影响的活动文档链接随位置调整，仍按既有忽略规则保留在本地。

Verification plan: 核对移动前后文件散列、扫描本地链接并区分原有缺失与迁移引入的缺失，检查旧目录引用、Git 重命名与忽略规则。按提交规范运行 pnpm test 与 pnpm run typecheck，再创建本地迁移提交。

GitHub: GitHub 插件确认账号 13776578253-glitch 已连接。当前返回的可访问仓库为 Omni-WorkFlow-Agent-M，其 permissions.push=true；本地未配置 origin，未验证本地 Git HTTPS/SSH 认证，未执行推送。账号连接与具体仓库可写权限分别确认。

Commit suggestion: docs: move agent context into docs and update references

## 迁移与验证结果

Change: 已通过 PowerShell Move-Item 完成目录迁移，未复现 VS Code 的 EPERM。迁移时校验 31 个文件散列一致。已同步根 AGENTS.md、规范入口、活动计划与 Markdown 导航链接；规范中明确管理记录适用自身历史规则，已有路径描述按旧前缀映射到新位置。

History verification: 对照初始提交核对 22 份当前任务、完成任务与历史计划，除授权同步的 Markdown 链接外，原正文和结论一致。新路径迁移说明在本记录追加，原版本保留于 750bc45。

Verification: 扫描 51 份 Markdown，正式文档与管理记录没有缺失的本地链接，没有新增缺失链接；剩余 18 条缺失均属于原有 scratch 草稿。修复规范入口原有的阶段汇报链接。源码、测试、脚本、包配置与忽略规则未改变；迁移记录可跟踪，临时探针仍被忽略。pnpm test 通过 68/68，pnpm run typecheck 通过。

Commit format: 本次改变仓库文档布局，按规范使用 docs!: move agent context into docs and update references，并在 BREAKING CHANGE 中说明旧前缀迁移为 docs/agent-context/。

GitHub boundary: 本轮只有只读账号与仓库权限检查，没有创建远程仓库、配置 origin 或推送；本机 Git 认证是否可直接推送仍未验证。


## 2026-10-08 记录快照归档

Archive: 本记录截至此次标记前的完整内容已复制核验至 [归档快照](../finish-task/2026-10-08-M4规划启动快照/2026-10-06-agent-context目录迁移.md)，SHA-256 见该目录 manifest.json。原文保留，既有归档不覆盖；正文中的任务状态、待办与验收范围保持，后续更新仍可向本文件追加。
