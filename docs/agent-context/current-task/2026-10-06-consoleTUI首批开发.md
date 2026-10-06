# Console TUI 首批开发

Time: 2026-10-06

Request: 负责人已配置远程仓库，要求考虑创建新分支并开始开发 Console TUI。

Baseline: main 与本地 origin/main 均为 ada454f，工作区干净；远程为 https://github.com/13776578253-glitch/1002bot.git。已创建 feat/console-tui 分支，以当前提交开始，不配置新远程或推送。

Plan: 先交付可运行的同进程 TUI，独立入口沿用现有 ConsoleRuntime/InputChannel，提供状态、活动记录、固定编辑区、回看与详情，接入现有提交、取消、检查、启停和退出接口。Enter 换行，Ctrl+S 显式提交；粘贴只编辑，输出不改变草稿或光标。非 TTY 继续走行式 Console。

Selection: 首批比较 React/Ink、完整终端组件框架和薄终端驱动。当前 Node 直接运行 TypeScript，无 JSX/构建链；本批采用 ANSI 屏幕驱动和 Intl.Segmenter 编辑，以 string-width 处理显示列宽。该选择限定于首个原型；具体 Windows 终端和中文输入法兼容性以实测确认。

Impact: 新增 src/console/tui、离线启动样例、操作说明和验证；添加列宽依赖，保持现有行式 Console 与 Runtime 公共协议。草稿、活动展示和刷新有独立有限预算，不扩展 Runtime 执行队列，不引入后台连接或逐 token 输出。

Verification plan: 离线验证中文/组合字符编辑、多行与分块粘贴、控制字符显示、连续输出时草稿保持、回看跟随、拒绝保留、工具诊断、取消/启停与终端恢复；集成使用真实 Runtime/JSONL/FixtureWorld，只脚本化 Provider。按规范运行 pnpm test 和 pnpm run typecheck；用离线样例验证 PTY 启动和退出。实际中文输入法、窗口缩放和复制操作仍单独记录人工验收，不能由模拟输入替代。

Sources: [Console 计划](../plans/2026-10-06-console终端交互计划.md)、[原 Console 操作说明](../../使用说明/终端Console.md)。

## 实现与自验

Change: 已实现 text/editor/input/state/view/terminal 模块、pnpm dev:tui 离线入口和 pnpm probe:tui 按键/尺寸探针。Enter 换行、Ctrl+S 提交，标准 bracketed paste 按整批草稿处理；字素光标、多行、回看锚点、帮助/详情翻页和窄窗口展示均独立于 Runtime 执行。编辑容量 64 KiB，活动缓存 128 条/512 KiB，单字段约 16 KiB；重绘合并，输出背压期间等待 drain 后展示最新状态。

Interface: 仅使用 ConsoleRuntime/InputChannel 的公共接口；提交拒绝保留草稿，受理期间继续编辑不被回执清空，取消回执与终态分别显示。退出等待执行/写入收束并恢复原始输入模式及屏幕；Ctrl+D 等待可被 Ctrl+C 改为停止。非 TTY 沿用现有行式入口。未修改 Runtime、Agent、Provider 或 World 公共协议。

Tooling: 本机现有 node_modules 来自旧目录与 pnpm 12.9.1，当前 pnpm 10.30.3 不能直接复用其 store。已在允许的本地 store 重建依赖，保留原锁定 TypeScript/Node 类型版本，新增锁定 string-width 8.3.0，安装禁用生命周期脚本，没有改动全局配置。测试入口补充扫描 src，单元测试按规范与模块同目录，集成测试放 tests/integration。

PTY evidence: Windows PTY 实际运行离线样例，set answer 7 与 get answer 按受理顺序完成真实 FixtureWorld/JSONL 往返，读回 7，终态 persisted=true；草稿“草稿👩‍💻”及下一行在回看和帮助中保持。/quit 后原始模式与 alternate screen 退出，独立 Node 退出探针记录 code=0、raw=false、flowing=false，无 uncaughtExceptionMonitor 错误记录。样例日志位于系统临时目录；一次性退出探针位于 scratch，保持忽略。

Verification scope: 自动验证覆盖字素删除/纵向光标、UTF-8 与粘贴标记分块、粘贴控制字符、容量、输出控制字符、回看/淘汰/缩放锚点、诊断缺口、拒绝保留、真实工具回执、取消与生命周期、EOF 等待转停止、输入失败恢复和非 TTY 兼容。真实中文输入法候选确认、窗口缩放操作与鼠标复制仍待负责人实际终端验收；独立审查和 T3 混合来源展示未完成。

Documentation: 新增 [全屏 TUI 操作说明](../../使用说明/全屏TUI.md)，更新 Console 计划及行式入口导航；既有验收结论不变。

Implementation sources: [Node Readline](https://nodejs.org/api/readline.html)、[xterm 控制序列](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)、[string-width](https://github.com/sindresorhus/string-width)。

Commit scope: 只暂存本批 Console 模块、脚本、依赖、单元/集成测试、操作说明、Console 计划和本记录。同期链路工作线对 M3 任务记录的追加保持未提交，不纳入本批。

Commit suggestion: feat(console): add same-process full-screen terminal prototype

## 提交前验证结果

Verification: pnpm test 全部通过，87/87（原基线 68 项加本批 19 项）；pnpm run typecheck 通过。Console 操作说明、计划和任务记录的本地链接检查通过；Runtime/协议/Agent/Provider/State 没有本批修改。当前任务目录 19 份记录，未达到自动归档阈值。人工终端验收与独立审查仍待完成，不用自验代替。

## 2026-10-06 测试分类与注释整理：实施前

Request: 负责人要求按参考图将模块测试归入 __tests__，按英文结构锚点与中文审查说明补全注释，说明内部复杂度后由负责人审查；不得提前实现主线功能或逻辑。

Plan: 将 TUI 的 editor/input/view 单元测试移动到 src/console/tui/__tests__/，修正相对导入；TUI 与 Runtime 的集成测试继续保留 tests/integration/tui.test.ts。同步规范的单元测试位置说明，补充接口单位、字段所有权、分块解码、受理回执与草稿版本、回看锚点、输出背压和退出恢复的必要注释。

Boundary: 本轮只整理测试位置、注释和阅读文档，保持现有生产代码可执行语义。没有新增输入调度、执行队列、World/Heartbeat 接入、Memory、持久化、恢复或后台连接。链路工作线的同期未提交记录保持原状。

Verification plan: 变更前保存生产源码的 TypeScript token 序列，变更后排除注释/空白核对一致；运行 pnpm test、pnpm run typecheck，核对迁移测试的发现路径与文档链接。只提交本轮明确路径，完成后交负责人审查。

## 2026-10-06 恢复整理与 M2.1 汇报：实施前

Request: 负责人撤销原型提交并暂停后，要求继续补全注释、解释复杂度与主线边界，另按阶段汇报规范整理 M2.1。后续补充沿当前主线基线递增小版本。

Current state: HEAD 为 ada454f，原型代码仍在工作区，三个模块测试已移动到 __tests__；撤销的 3dfb0b0 不再作为当前已提交版本。保留工作区供负责人审查，本輪不重建被撤销的提交。

Plan: 补充现有 Console 模块接口单位、字段所有权与关键异步顺序注释；只核对生产代码 token，不新增逻辑。主线基线为已验收 M2，M3 仍为候选讨论，新增 2026-10-06-M2.1进度与架构图.md，独立呈现 Console 增量、复杂度、验证和剩余范围，并将补充编号规则记入阶段汇报规范。

Verification: 重新运行测试与类型检查，核对生产代码 token 不变、主线目录无修改；图形使用本地 Mermaid 离线渲染并实际查看。本轮不提交或推送，独立审查与负责人验收继续待完成。

## 2026-10-06 M2.1 注释与汇报整理结果

Change: 已补充 6 个 TUI 模块与 2 个样例/探针的接口单位、字段所有权和关键分支注释。三个模块单元测试保留于 __tests__，跨 Runtime 集成测试保留原分类。新增 [M2.1 进度与架构图](../../2026-10-06-M2.1进度与架构图.md)，阶段汇报规范明确以当前主线实现基线递增独立补充编号；M2 原页仅新增导航链接。

Complexity: terminal.ts 的回执/编辑/诊断/重绘/退出交错是主要审查入口；input.ts 处理跨块字符与粘贴边界；editor/text/view/state 处理字素、列宽、有限保留和回看锚点。submitting、诊断消费位置、显示缓存和重绘等待均为本地界面机制，不构成新的执行调度、Memory 或持久化机制。

Verification result: pnpm test 通过 87/87，pnpm run typecheck 通过。采用 TypeScript 解析后的去注释 AST 比较，8 份生产模块/样例全部与整理前一致；直接 scanner 在模板字符串中无法可靠区分注释，因此改用语法树比较，没有据此修改生产逻辑。主线 Runtime/Protocol/Agent/Provider/State 与 HEAD 无差异。

Report QA: 本地 Mermaid 渲染 5 张图，最大 SVG 宽度 681 px，800 px 阅读容器内逐图查看，文字、箭头、前后结构和时序未见遮挡或裁切。报告、基线导航、阅读指南和阶段规范本地链接检查通过。图形和 AST 校验产物位于 scratch/m2.1-diagram-preview、scratch/tui-comment-token-results.json，继续忽略。

Outcome: 已提供复杂度与主线边界说明及独立 M2.1 补充报告，等待负责人审查。当前主线已验收基线保持 M2，M3 仍待决策；没有新增主线功能。保留现有工作区，不重建被撤销的提交，不推送；同期 M3 任务记录不修改。

## 2026-10-06 M2.1 汇报结构修订：实施前

Request: 负责人指出专项内容不符合要求，改为待添加；尚未完成的整体结构、验证记录、范围边界只呈现本 Console 工作线。M2.1 尚未完成，在“修改后”处按当前代码细粒度补充内部逻辑解释，后续先讨论样式，再逻辑优化，最后界面功能。

Plan: 保留入口前后对照图，在修改后就地展开 6 个 TUI 模块、方法调用和关键数据。移除专项正文，保留待添加。后三节去掉主线全局状态条目，明确本线未完成结构与待审查/验收项。Console 计划追加本阶段继续推进的三步方向，不提前新增执行逻辑或界面功能。

Correction: 上次报告的专项使用了复杂度/范围说明代替已确定的专项主题，后三节混入了主线全局状态。本次按负责人要求纠正；文档修订和原型自验均不表示 M2.1 已完成。

Verification plan: 重新离线渲染并查看修改后的图，逐条核对模块关系和本地文档链接；定向运行现有 19 项 TUI 测试，仅报告本线证据。本轮不修改生产源码，不提交或推送，原测试和主线历史结论保留。

## 2026-10-06 M2.1 汇报结构修订结果

Change: 已在“修改后（M2.1）”处补充 6 个真实模块的关键调用/返回图，并就地说明输入、编辑、提交、命令、诊断、回看、绘制及退出的方法与数据关系。terminal.ts 不直接导入 text.ts，图按当前源码表达共享文本工具调用；未按参考图复制不一致的连线。细粒度说明保留，后续抽象待本地逻辑优化讨论。

Report correction: 专项报告已清空原正文并标记待添加。尚未完成的整体结构仅列本线样式、职责整理和功能取舍；验证仅列本 TUI 的证据，范围边界只写当前界面与公共能力适配。页首和计划明确 M2.1 进行中，尚未完成，文档修订不替代实现、审查或验收。

Next direction: 按负责人顺序在 M2.1 内继续：先等待/执行/失败/回看四类场景样式，再评估 terminal.ts 的本地职责、命令反馈与重绘路径，最后讨论默认信息、诊断展开和快捷操作等界面功能。本轮只拟定方向，没有实施样式、重构或功能扩展。

Verification result: 使用 scratch/validate-tui-scope.mjs 定向运行现有 13 项模块单元与 6 项 TUI 集成测试，19/19 全通过，不联网。修改后的 6 张 Mermaid 图均本地渲染，新增模块图约 499×619 px，在 800 px 容器中实际查看；初版并行箭头标签重叠已纠正，最终标签无遮挡或裁切。专项待添加、后三节本线范围和本地文档链接已核对。

Outcome: 本轮报告修订完成，M2.1 继续进行；源码未修改，保留工作区供负责人审查，不提交或推送。主线状态与其他工作线记录未改写。

## 2026-10-06 前端目标与探索隔离讨论

Owner direction: 负责人倾向 OpenTUI 作为选型目标，熟悉 React；TUI 将长期保留，属于通用基座的前端之一。期望覆盖特定 World 交互/监控、输出、配置设置和 Agent 总运行监控，未来可出现 Web、Desktop 或移动端。项目需要稳定的公共控制接口。负责人询问是否使用 worktree 隔离探索及对主线 Agent 的影响，尚未指示创建。

Current evidence: 当前仅有 D:/Desktop/code/bot/1002bot 一个工作树，HEAD/main/origin/main 的本地引用均为 ada454f；TUI 与报告改动未提交，另有主线任务记录未提交。新 worktree 不会自动复制这些文件。本机 Node 为 v24.14.0，PATH 未发现 Bun；本轮未安装运行时或框架。

Proposal: 以 OpenTUI + React 适配作为优先验证目标，将终端基础设施交给框架，产品侧拥有信息组织和交互状态。通用基础放在控制能力与回执/快照/事件语义上，框架类型不进入核心控制契约。当前 ConsoleRuntime/InputChannel 只覆盖已有输入与生命周期；World/配置/完整监控能力由需求与主线公共契约分别确认，不因页面目标提前实现核心逻辑。

Worktree proposal: 建议独立探索工作树，保留当前未提交原型供审查，从已提交基线开始框架验证。独立目录、依赖和构建不要求停止主线聊天或运行进程；仍需避免共用终端、端口、Session 文件、配置写入及全局运行环境修改。接口变更和合并需要协调。当前记录只有目标与建议，没有创建 worktree、迁移现有改动或更改主线代码。

Official references: [OpenTUI React](https://opentui.com/docs/bindings/react/)、[运行支持](https://opentui.com/docs/getting-started/runtime-support/)、[Git worktree](https://git-scm.com/docs/git-worktree)。官方当前 Node 路径要求 26.4+ 与 experimental FFI，React 适配要求 React 19.2+；Bun 路径是隔离验证的候选，Windows 与 React 的具体组合仍需实际验证。

## 2026-10-06 M2.1 人工验收与基线提交：实施前

Request: 负责人确认目前 M2.1 人工验收通过，要求更新文档，将本轮提交推送 Git 远端并让 main 同步基线；依赖拆分留到下一轮讨论。此授权更新此前保留工作区、不提交或推送的决定，历史撤销记录保留。

Plan: 更新报告、操作说明和 Console 计划的当前验收状态，将样式、逻辑与界面功能取舍归入后续规划；记录长期前端目标与 OpenTUI 倾向，不落实新的框架、接口或依赖拆分。按阶段汇报规范移除已验收本批的未完成结构章节，专项继续待添加。长期 Console 计划尚未整体完成，不归档。

Git scope: 提交现有 TUI 模块、样例/探针、测试分类、测试发现脚本、依赖及对应文档。同期 M3 任务记录保持工作区原状，不纳入提交；scratch 探索与验证产物继续忽略。远端最新 main 与 feat/console-tui 必须通过正常快进方式同步，不强制推送。

Verification plan: 提交前执行 pnpm test 与 pnpm run typecheck，检查文档状态/链接、暂存路径和主线源码差异；推送后核对本地与远端两条分支引用，确认同期 M3 记录未改动。人工验收结论仅来自负责人确认，不补造逐项终端环境或独立审查记录。

Commit suggestion: feat(console): establish accepted M2.1 terminal baseline

## 2026-10-06 M2.1 验收文档与提交前验证结果

Change: M2.1 报告、全屏 TUI 操作说明与 Console 计划已记录负责人人工验收通过。报告专项保持待添加，后续样式/逻辑/功能规划移至范围边界与计划，记录长期通用前端目标、OpenTUI 倾向及下一轮依赖拆分讨论。源码和依赖未在本次验收状态修订中改变。

Verification result: pnpm test 87/87 通过，其中本 TUI 的模块单元测试 13 项、集成测试 6 项；pnpm run typecheck 通过。9 份相关文档的 42 个本地链接有效。主线 Runtime/Protocol/Agent/Provider/State 与 HEAD 无差异，图形未修改，沿用此前离线渲染检查结果。

Git preflight: 已 fetch origin，main 与 origin/main 均为 ada454f，当前 feat/console-tui 从该基线开始，本轮可正常快进同步。同期 M3 任务记录 SHA256 为 8C4F01DBAC6357048BE9B1749863FCDCA8C108163D553A31EC1D8D8026493755，提交与切换分支后核对不变。按明确路径暂存本轮增量，推送分支后将 main 快进至同一提交；发布结果以 Git 引用为准。

Open issues: 后续框架、依赖拆分、控制接口和探索隔离尚待讨论；独立审查及修复复核未单列结论。负责人人工验收仅记录本批确认，未推定其他终端环境已验证。长期 Console 计划继续保留，后续独立补充按已实现主线基线递增编号。
