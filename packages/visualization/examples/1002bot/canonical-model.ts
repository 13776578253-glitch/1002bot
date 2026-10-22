// Canonical data source for the visualization adapter.
// The adapter reads this canonical catalogue and graph builder directly.
// @ts-nocheck

'use strict';
const iconChevron='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const D='../docs/';
const TD='../.worktrees/TUI/docs/';
const s=(id,title,desc,rules,file,intro)=>({id,title,desc,rules,file,intro});
const group=(id,title,desc,children,options={})=>({id,title,desc,children,...options});
const stages={
 main:[
  {id:'m1',label:'M1.0',title:'最小运行基座',date:'2026.10.04',subtitle:'让一条世界事件经过模型与工具，留下完整的会话记录。',scope:'单 Runtime · 单 Session · FixtureWorld',status:'基线实现已完成',changes:['确立 Runtime、Agent、Provider、World 与存储的职责。','建立启停与代次隔离，按过程追加事件、调用和回执。'],verified:'基线实现及历史 Review 已记录；补充竞态修复另有验证记录。',doc:D+'2026-10-04-M1.0进度与架构图.md',n:1},
  {id:'m2',label:'M2.0',title:'接入持续的用户交互',date:'2026.10.05',subtitle:'用户可以连续输入，模型在容量内接续对话；一次回复结束后，Runtime 继续等待。',scope:'新增 Console · 用户输入 FIFO',status:'首批人工验收通过',changes:['增加独立 Console、输入队列和单次输入执行器。','ConversationAgent 组织多轮上下文，增加期限、容量与 unknown 收束。'],verified:'首批验收完成；真实 Provider 工具往返与终端交互已有记录。',doc:D+'2026-10-05-M2.0进度与架构图.md',n:2},
  {id:'m3',label:'M3.0',title:'三种来源，统一受理',date:'2026.10.08',subtitle:'用户输入、世界事件与心跳共用一条 FIFO，逐项执行并结清。',scope:'统一触发 · 固定输入边界',status:'限定首批验收通过',changes:['Event 独立执行路径并入 TriggerChannel，三个来源共用一个消费者。','新增 World 订阅和可控心跳；排队新事实留给后续处理。'],verified:'111 项自动测试及独立验收已记录。World 长期身份偏差由 M4 承接。',doc:D+'2026-10-08-M3.0进度与架构图.md',n:3},
  {id:'m4',label:'M4.0',title:'让世界事件持续投递',date:'2026.10.09',subtitle:'来源保留稳定身份，Runtime 分别确认受理、保存与结清，并在新实例启动前核对历史。',scope:'顺序投递 · 保存确认 · 启动审计',status:'独立验收通过',changes:['World 身份改用稳定顺序信封与连续前缀，独立于用户输入预算。','新增 waitSaved、启动预检和有界完整历史候选。'],verified:'144 项自动测试、完整类型检查与独立验收已记录。',doc:D+'2026-10-09-M4.0进度与架构图.md',n:4},
  {id:'m5',label:'M5.0',title:'意图跨越一次触发',date:'2026.10.11',subtitle:'Agent 保存待办意图，在到期心跳里认领一次新尝试，再明确完成或重排。',scope:'可选任务工具 · 心跳延续',status:'独立审查与实测通过',changes:['增加任务状态、内容修订、唤醒安排和一次认领。','任务工具与 World 工具分流，保留真实尝试和效果依据。'],verified:'204 项自动测试、独立审查及离线终端实测已记录。',doc:D+'2026-10-11-M5.0进度与架构图.md',n:5},
  {id:'m6',label:'M6.0',title:'明确让出，继续响应',date:'2026.10.12',subtitle:'只读或模型等待中的处理可由操作者明确让出；原操作晚到后独立归档，按需查询。',scope:'显式启用 · 单逻辑 run · FIFO',status:'自动验收通过',changes:['增加可信效果分类、显式让出控制与有限原操作登记。','迟到结果独立保存，普通历史保持隔离；停止检查实际资源退出。'],verified:'242 项自动测试及自动验收已记录；M6 真实环境验收待做。',doc:D+'2026-10-12-M6.0进度与架构图.md',n:6}
 ],
 qq:[
  {id:'qq41',label:'M4.1',title:'第一个生产 World：QQ',date:'2026.10.11',subtitle:'把固定授权会话的消息转成世界事实，用显式工具查询消息和发送文本。',scope:'单账号 · 单固定会话 · 磁盘记录',status:'真实环境两层验收通过',changes:['QQWorld 连接外部 OneBot 服务，拥有领域消息与本地身份。','捕获记录、顺序投递与显式发送分别确认。'],verified:'36 项 QQ 包测试；真实 SnowLuma 桥接与 Provider 两层验收已有记录。',doc:D+'2026-10-11-M4.1进度与架构图.md',n:4},
  {id:'qq51',label:'M5.1',title:'纯内存的多轮 QQ 对话',date:'2026.10.11',subtitle:'当前消息直接进入模型，后续追问和引用可读取之前的对话；重建整个装配后清空。',scope:'内存 Session + 内存 QQJournal',status:'人工验收通过 · 已收尾',changes:['Session 与 QQJournal 共同选择内存生命周期。','Provider 统一编码工具线名，保留已结清失败轮次的真实发送事实。'],verified:'219 项自动测试；2026.10.12 负责人确认人工验收通过。',doc:D+'2026-10-11-M5.1进度与架构图.md',n:5}
 ],
 tui:[
  {id:'tui21',label:'M2.1',title:'全屏交互的第一层',date:'2026.10.06',subtitle:'输出期间仍可编辑草稿，回看活动、查看详情，并在退出后恢复终端。',scope:'同进程原型 · ANSI / VT',status:'当时原型人工验收通过',changes:['行式 Console 增加全屏驱动、草稿、布局和本地活动状态。','新输出与草稿分开维护；受理成功后按草稿修订清理。'],verified:'原型自动化、Windows PTY 与负责人实际终端验收已记录。',doc:D+'2026-10-06-M2.1进度与架构图.md',n:2},
  {id:'tui31',label:'M3.1',title:'把前端从核心包拆出来',date:'2026.10.08',subtitle:'TUI 成为独立可选包，与 Runtime 共用轻量控制契约；组合根选择并装配两端。',scope:'独立包 · 同进程控制',status:'迁移与自动验证完成',changes:['提取 @1002bot/control-api，TUI 从公共入口消费能力。','验证核心、TUI、完整工作区与独立 tarball 的安装边界。'],verified:'114 项自动测试与独立包检查已记录；迁移后人工复验另列。',doc:D+'2026-10-08-M3.1进度与架构图.md',n:3},
  {id:'tui32',label:'M3.2',title:'接入原生组件与交互',date:'2026.10.10',subtitle:'OpenTUI React 负责终端组件，原生编辑与滚动保留正文、光标和实际阅读位置。',scope:'feat/TUI · OpenTUI React + Bun',status:'实现与自验完成',changes:['换用原生 Textarea 与 ScrollBox，调整输入、排头和按键。','保留单列活动、草稿修订、跟随与回看；模式先作为本地标签。'],verified:'后续输入及滚动修订已自验，物理终端交互复验待补。',doc:TD+'2026-10-08-M3.2进度与架构图.md',n:3},
  {id:'tui33',label:'M3.3',title:'每份状态，都有拥有者',date:'2026.10.10',subtitle:'统一应用入口，拆开会话控制、界面状态、活动资料与原生适配，让展开后的职责清晰可见。',scope:'feat/TUI / 7ac2fec · Core 基线 M3',status:'自验通过 · 独立复核待做',changes:['Application 协调动作与快照；Controller 负责请求和停止。','UiState 拥有逻辑阅读位置；ActivityStore 拥有资料；native 管实际位置。'],verified:'Node 114 项、原生 24 项及类型检查已有记录；独立审查与本版人工复验待做。',doc:TD+'2026-10-10-M3.3进度与架构图.md',n:3}
 ]
};
const names={main:'主线',qq:'QQ 接入线',tui:'TUI 交互线'};
let track='main',index=0,depth=0;
const opened=new Set(),rulesOpened=new Set();
const $=id=>document.getElementById(id);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const code=(path)=>'../'+path;
function lifecycle(){return s('lifecycle','生命周期与代次','管理开始、停止和旧回调',[
 'start / stop 管理 Runtime 的生命周期；一次模型或工具处理结束后继续等待。',
 '异步边界核对 generation、lease 与取消信号，旧代结果无法推进新代。',
 '停止等待已进入的必要写入；World 使用独立清理信号。'
 ],'src/runtime/runtime.ts',1)}
function execution(n){return s('execution','触发执行',n===1?'Event 的模型与工具往返':n===2?'用户输入与旧 Event 分路执行':'统一 run 的模型与工具往返',[
 'Agent 构造请求，Provider 返回文本与工具调用，Runtime 依声明调用 World。',
 n===1?'模型轮数受 Session 声明与运行取消约束。':'每次处理受模型轮数、工具批量、请求/响应字节与调用期限约束。',
 n>=2?'World 效果无法确认时保留 unknown，关闭后续受理并收束停止。':'工具回执保留 callId 与 succeeded / failed / cancelled / unknown 分类。'
 ],n>=3?'src/runtime/trigger-run.ts':n===2?'docs/2026-10-05-M2.0进度与架构图.md':'docs/2026-10-04-M1.0进度与架构图.md',n>=3?3:n)}
function admission(n){return s('admission','受理与 FIFO',n===2?'UserInput 单活动处理':'UserInput · World Event · Heartbeat',[
 '输入验证通过后才占用身份和排队序号，受理时保存事实副本。',
 '先入队并发起接收追加，再交付 accepted；执行等待接收追加确认。',
 n>=3?'同一 Session 只运行一个逻辑 run；终态结算后继续下一项。':'World Event 仍保留独立的旧入口，两条执行路径通过忙状态互斥。'
 ],n>=3?'src/runtime/trigger-channel.ts':'docs/2026-10-05-M2.0进度与架构图.md',n>=3?3:2)}
function delivery(){return s('delivery','顺序投递与保存','稳定信封 · 三个进度水位',[
 'World 使用固定 stream / epoch 和连续 sequence；重投沿用原信封。',
 'admittedTail、receivedPrefix、settledPrefix 分别表示受理、接收保存与连续结清。',
 'waitSaved 等待接收追加确认。默认 positions 为 16；已结清连续位置释放。'
 ],'src/protocol/delivery.ts',4)}
function heartbeat(n){return s('heartbeat','心跳受理策略','未结清 tick 去重 · 可选任务策略',[
 '心跳显式启用；默认周期 30 秒、有效期 5 秒。',
 '已有未结算心跳时跳过新 tick；其他来源忙且队列有位时仍可入队。',
 n>=5?'任务策略选择一个到期且未消费的安排；无到期任务且无自定义策略时零模型调用。':'Agent 可以返回无动作决定，结清心跳后 Runtime 继续等待。'
 ],'src/protocol/trigger.ts',3)}
function task(){return s('task','跨触发任务','意图 · 安排 · 一次认领',[
 '任务状态为 active / waiting / completed / cancelled，更新携带期望 revision。',
 'scheduleRevision 与内容修订分开；认领保存后，原安排已消费。重试须明确重排。',
 '任务变更追加确认后才发布投影。工具成功与 run 成功分别记录，任务由 Agent 明确完成。',
 '默认活跃任务 64 项 / 128 KiB；完整尝试证据按预算显式查询。'
 ],'src/runtime/task-coordinator.ts',5)}
function operations(){return s('operations','原操作登记','逻辑结清与实际退出分开',[
 '进入 Provider 或 World 实际调用前登记，原 Promise 退出与必要记录确认后释放。',
 '默认在途上限 3 个；主动让出最多留下 2 个未退出调用。',
 '撤权及迟到结果使用原身份独立归档；原操作晚到不重新开启旧 run。'
 ],'src/runtime/operation-registry.ts',6)}
function yieldControl(){return s('yield','明确让出控制','可信操作者指定活动目标',[
 'responses.yield 同时校验 runId 与 generation，普通新消息继续按 FIFO 排队。',
 '工具效果由可信实现声明为 none / external；省略时保守按可能产生外部效果处理。',
 'requested 表示控制信号已发出；必要回执和 run 终态确认后，才执行 FIFO 后项。',
 'M6 显式启用。QQ 装配与共享 control-api 尚未接入这个控制口。'
 ],'src/protocol/responsiveness.ts',6)}
function coreGroups(n){
 const runtimeChildren=[lifecycle()];
 if(n>=2)runtimeChildren.push(admission(n));runtimeChildren.push(execution(n));
 if(n>=4)runtimeChildren.push(delivery());
 if(n>=3)runtimeChildren.push(heartbeat(n));
 if(n>=5)runtimeChildren.push(task());
 if(n>=6)runtimeChildren.push(yieldControl(),operations());
 const agent=group('agent','Agent',n>=2?'ConversationAgent · 指令、历史与续轮':'TestAgent · 测试请求构造与续轮',[
  s('context','上下文选择','完整轮次与当前运行',n>=2?['当前输入已进入执行事实，构造请求时只交付一次。','完整历史轮次整体裁剪；当前运行保留，按 Provider 实际序列化字节计量。',n>=3?'排队 B 的接收记录留在归档，A 的续轮保持固定输入边界。':'选取容量内成功历史；旧 Event 仍沿兼容路径。']:['测试 Agent 从事件及回执构造下一次模型请求。','生产 ConversationAgent 在 M2 引入。'],n>=2?'src/agent/conversation-agent.ts':'tests/fixtures/test-agent.ts',n>=2?2:1)
 ],{intro:n>=2?2:1});
 const provider=group('provider','Provider','转换模型协议，收回调用等待资源',[
  s('transport','模型协议与传输','Scripted / Responses 兼容', ['Provider 负责序列化、HTTP 与响应转换；平台工具执行由 World 承担。',n>=2?'measureRequest 测量实际请求体字节，容量包含工具声明和原生项。':'自动化使用脚本 Provider，真实请求通过手动入口验证。','原生 output 保留顺序并以 callId 配对回包。'],'src/providers/openai-responses-provider.ts',1)
 ],{intro:1});
 const world=group('world','World / FixtureWorld','拥有环境事实、工具与效果判断',[
  s('worldtools','工具声明与回执','查询 · 写入 · 结构化结果',['Core 校验参数结构，World 校验领域语义并执行工具。','回执保留原 toolName、callId 与状态；未知外部效果保留 unknown。',n>=6?'可信 effects 随本次声明固定；模型参数无法修改它。':'FixtureWorld 用于离线验证，生产 World 沿独立工作线接入。'],'src/protocol/index.ts',1)
 ],{intro:1});
 const storeChildren=[s('jsonl','JSONL Session','串行追加执行事实',['事件、请求、响应、调用和回执随运行过程追加。','appendFile 完成后确认可读；停止等待已进入的追加。','Session 文件持续增长，普通追加不提供 fsync 保证。'],'src/state/jsonl-session.ts',1),s('state','MemoryState','独立的实例内键值状态',['State 与 Session 契约分开。','当前装配中的 MemoryState 尚未形成长期 Memory 更新与提取流程。'],'src/state/memory-state.ts',1)];
 if(n>=4)storeChildren.push(s('audit','启动预检与历史窗口','先诊断，再启动 World',['扫描确认历史，重建来源前缀与近期完整运行组。','unknown、未结清、损坏或工具配对缺失阻断启动，保留原因。','默认候选 32 个完整组 / 16 MiB；显式旧历史读取另受预算约束。'],'src/runtime/session-preflight.ts',4));
 if(n>=5)storeChildren.push(s('projection','任务确认投影','从同一 Session 重建',['task_changed / task_claimed 与执行事实进入同一归档。','投影发布晚于追加确认；新实例重建状态和安排消费事实。'],'src/state/task-projection.ts',5));
 if(n>=6)storeChildren.push(s('late','迟到证据','独立保存，明确查询',['operation_detached / operation_late 使用 origin 关联原调用。','普通历史和任务投影过滤独立记录；Agent 经证据工具显式查询。','单条迟到记录与默认查询预算各 32 KiB。'],'src/agent/operation-tools.ts',6));
 return {runtime:group('runtime','Runtime',n===1?'生命周期 · 事件执行 · 写入屏障':n===2?'生命周期 · 用户输入队列 · 执行':n<5?'统一受理 · 单次执行 · 确认提交':n===5?'统一执行 + 跨触发任务':'统一执行 + 任务 + 受控响应',runtimeChildren,{tone:'blue',intro:1,changed:n>1}),collaborators:[agent,provider,world],store:group('store','会话与状态',n>=4?'Session 事实归档 · 有界投影 · 独立 State':'Session 追加事实 · State 实例内状态',storeChildren,{tone:'green',intro:1,changed:n>=4})};
}
function mainDiagram(stage){
 const n=stage.n,c=coreGroups(n),input=[];
 if(n>=2)input.push(s('console','Console 用户输入','文本与本地命令',['Console 只编辑、提交和展示公开诊断。','受理、队列、模型请求与工具执行继续归 Runtime。'],'src/console/terminal.ts',2));
 input.push(s('events','World 事件',n>=4?'稳定顺序信封':n>=3?'订阅主动推送':'调用 handleEvent', [n>=4?'来源在投递前固定 stream / epoch / sequence，保留未保存项。':n>=3?'Runtime 启动 World 后装配 sink；停止撤销订阅和旧代投递权。':'FixtureWorld 产生结构化 Event，由调用方交给 Runtime。'],'src/protocol/index.ts',1));
 if(n>=3)input.push(s('heartbeat-source','周期时钟','产生可控周期 tick',['由装配显式启用；Runtime 启动时订阅，停止时退订。','默认周期 30 秒、有效期 5 秒。'],'src/protocol/trigger.ts',3));
 return [{nodes:[group('ingress','触发来源',n===1?'FixtureWorld → 结构化 Event':n===2?'Console 用户输入 / World Event':'用户输入 / 世界事件 / 周期心跳',input,{intro:1,layout:'column'})],link:n===2?'输入通道 / 旧 Event 入口':'提交触发'}, {nodes:[c.runtime],link:'请求构造 / 模型协议 / 领域执行'}, {nodes:c.collaborators,link:'过程追加与终态确认'}, {nodes:[c.store]}];
}
function qqDiagram(stage){
 const memory=stage.id==='qq51';
 return [
 {nodes:[group('bridge','外部 QQ 桥接','SnowLuma · OneBot v11 · 部署方维护',[s('connection','账号与连接','固定账号 / 固定会话',['认证握手后核对 get_login_info；自身消息和非授权会话在编号前过滤。','连接重建与响应等待由 Driver 管理；上游断线补齐不在首批契约内。'],'packages/extensions/world-qq/src/driver.ts','M4.1')],{intro:'M4.1'})],link:'入站消息 / 原生工具确认'},
 {nodes:[group('qqworld','QQ World',memory?'领域记录选择纯内存，共享原有工具边界':'捕获消息、分配来源身份、显式查询与发送',[
 s('normalization','消息捕获与过滤','文本 + 有界元数据',['固定一个账号与一个群聊或私聊；过滤自身与其他目标。','保存文本、mentions / references / unsupported 和原生身份；事件容量有限。'],'packages/extensions/world-qq/src/normalize.ts','M4.1'),
 s('journal',memory?'内存 QQJournal':'领域 JSONL 日志',memory?'与 Session 共同选择生命周期':'原生身份 / received / saved / intent / result',[memory?'记录仅保留于当前 World 实例；stop/start 保留，新实例清空。':'Journal 串行记录原生键、稳定序号和发送意图；文件锁约束单个活动写入者。','waitSaved 确认接收保存后推进本地 saved 前缀；重投沿用原信封。','容量耗尽明确拒绝或停止，身份与未确认操作保持。'],'packages/extensions/world-qq/src/journal.ts',memory?'M5.1':'M4.1'),
 s('qqtools','查询与显式发送','qq.get_message / qq.send_text',['查询范围为本固定会话的已捕获或确认发送消息。','fresh 查询要求充分证明消息归属；当前部署桥接缺字段时返回 unproven_message。','发送先记录意图，再请求桥接并保存确认；提交后效果不明保留 unknown。'],'packages/extensions/world-qq/src/world.ts','M4.1')
 ],{tone:'blue',intro:'M4.1',changed:memory})],link:'稳定来源信封 / World 工具'},
 {nodes:[group('qqcore','Core Runtime',memory?'M5 基线 · FIFO / 完整对话 / 显式发送':'M4 基线 · 顺序投递 / 结清 / unknown 收束',[
 s('qqassembly','组合根','装配决定能力启用',[memory?'composeQQChat 同时启用内存 QQJournal 与 MemorySessionStore。':'composeQQ 使用领域记录与 JSONL Session，绑定同一来源身份。','任务、心跳和 M6 responsiveness 在当前 QQ chat 装配中未启用。','模型最终 assistant 文本保留在本地，QQ 回复通过 qq.send_text 显式发送。'],'examples/qq/compose.ts',memory?'M5.1':'M4.1'),
 s('qqconversation','对话与 Provider',memory?'当前消息、追问、引用与线名映射':'模型调用固定会话工具', [memory?'Agent 与 Runtime 同时保留完整已结清失败历史，使真实发送事实进入后续判断。':'当前阶段通过模型显式查询消息与发送文本。',memory?'Responses 工具名采用请求内双射，合法原名优先，冲突别名使用摘要。':'Responses 点号工具名的装配侧适配由后续 M5.1 统一进入 Provider。'],'src/providers/responses-tool-names.ts',memory?'M5.1':'M4.1')
 ],{intro:memory?'M5.1':'M4.1',tone:'green'})],link:'同一装配的记录寿命'},
 {nodes:[group('qqstore',memory?'两端纯内存':'两份职责不同的记录',memory?'Session + QQJournal · 新装配共同清空':'Session 记录执行事实；QQJournal 记录平台与投递事实',[
 s('qqlifetime','重启与容量',memory?'stop/start 与新实例分别定义':'来源身份与 Session 绑定保持', [memory?'同一装配 stop/start 保留历史；重建装配时两端一起清空。':'来源和 Session 重新打开后先核对绑定与确认历史。',memory?'内存记录仍有数量与字节容量，达到边界明确报告。':'未知发送与损坏记录保留诊断，启动不会自动重发动作。'],'src/state/memory-session.ts',memory?'M5.1':'M4.1')
 ],{tone:'green',intro:memory?'M5.1':'M4.1'})]}
 ];
}
function tuiDiagram(stage){
 const native=stage.id==='tui32'||stage.id==='tui33',modern=stage.id==='tui33',split=stage.id!=='tui21';
 const children=modern?[
 s('application','Application','统一入口与快照',['submitDraft / dispatchUi / getSnapshot / subscribe 连接受控动作。','一次资料与界面协调完成后发布快照，编辑和稳定 frame 不产生新业务快照。'],'.worktrees/TUI/packages/apps/tui/src/application/application.ts','M3.3'),
 s('controller','Controller','请求、受理与停止屏障',['维护本端 pending / submitting / closing 和唯一 Runtime 订阅。','accepted 后比较草稿修订再清理；在途新编辑保持。','EOF 等待可转为 Ctrl+C 立即停止，复用同一个停止 Promise。'],'.worktrees/TUI/packages/apps/tui/src/application/controller.ts','M3.3'),
 s('uistate','UiState','逻辑焦点、页面与阅读',['拥有 main / help / details 页面及选择、跟随、未读和逻辑锚点。','default / edit / test 为本地模式标签，权限规则尚待定义。'],'.worktrees/TUI/packages/apps/tui/src/model/ui-state.ts','M3.3'),
 s('activity','ActivityStore','有限资料与展示投影',['按公共 seq 排重，保留 gap；窗口为 128 条 / 512 KiB。','资料投影与页面焦点分开；淘汰后明确缺失，已发布快照保持稳定。'],'.worktrees/TUI/packages/apps/tui/src/model/activity-store.ts','M3.3'),
 s('native','Native 适配','原生缓冲与实际滚动',['Textarea 拥有正文、光标和选区；ScrollBox 拥有实际 scrollTop。','逻辑锚点等待布局完成后恢复；原生滚轮后读取实际位置。'],'.worktrees/TUI/packages/apps/tui/src/native/use-reading-viewport.ts','M3.3'),
 s('views','View / Interaction','组件、快捷键与命令路由',['视图消费快照与属性；命令分类不执行 Runtime 业务。','Enter 提交，Shift+Enter / Ctrl+J 换行；Tab 切换输入与活动焦点。'],'.worktrees/TUI/packages/apps/tui/src/view/app.tsx','M3.3')
 ]:[
 s('editor',native?'原生编辑':'草稿与修订',native?'Textarea 保存正文与光标':'字素编辑、粘贴与版本',[native?'原生编辑缓冲保存正文；显示一至两行，长正文在同一缓冲内滚动。':'正文、光标与修订独立于后台输出。','受理拒绝保留草稿；受理成功且修订一致才清理。'],native?'.worktrees/TUI/docs/2026-10-08-M3.2进度与架构图.md':'docs/2026-10-06-M2.1进度与架构图.md',native?'M3.2':'M2.1'),
 s('reading','活动与回看','关联摘要、详情和阅读位置',['新输出更新活动；回看暂停自动跟随并显示未读。','详情展示保留的完整身份与错误，淘汰时明确缺失。'],native?'.worktrees/TUI/docs/2026-10-08-M3.2进度与架构图.md':'packages/apps/tui/src/state.ts',native?'M3.2':'M2.1'),
 s('terminal','宿主与终端恢复',native?'Bun / OpenTUI React':'ANSI / VT / 流与信号',['退出先收束公共生命周期及写入，再释放终端资源。','非 TTY 使用调用方显式提供的行式回退。'],native?'.worktrees/TUI/docs/2026-10-08-M3.2进度与架构图.md':'packages/apps/tui/src/terminal.ts',native?'M3.2':'M2.1')
 ];
 return [
 {nodes:[group('operator','操作者','编辑正文、查看活动、发出明确控制',[s('interaction','输入与导航',native?'Enter 提交 · Ctrl+J 换行':'Enter 换行 · Ctrl+S 提交',['帮助与详情返回时保留草稿和可恢复的阅读位置。','正文提交、查看详情与取消执行采用各自明确入口。'],native?'.worktrees/TUI/docs/使用说明/全屏TUI.md':'docs/使用说明/全屏TUI.md',stage.label)],{intro:stage.label})],link:'键位 / 正文 / 阅读动作'},
 {nodes:[group('tuiapp',modern?'TUI 应用':native?'OpenTUI React 界面':'全屏 TUI',modern?'应用协调 · 会话资料 · 原生适配 · 组件视图':native?'原生输入、活动与终端恢复':'编辑、活动、布局与驱动',children,{tone:'blue',intro:stage.label,changed:true})],link:'公共调用 / 公开事件与快照'},
 {nodes:[group('contract',split?'@1002bot/control-api':'ConsoleRuntime',split?'轻量公共契约，前端和核心分别消费':'同进程控制形状',[
 s('publicapi','公开控制能力','submit / cancel / inspect / subscribe',['RuntimeControl 提供 inputs、status、start / stop。','公共诊断包含来源身份、结果与 seq / gap；本端 pending 只统计本端。','共享接口尚未暴露 M6 responses.yield 与任务概览。'],'packages/shared/control-api/src/index.ts',split?'M3.1':'M2.1')
 ],{intro:split?'M3.1':'M2.1'})],link:'同进程注入，由组合根选择'},
 {nodes:[group('tuicore','Runtime 执行基座',stage.id==='tui21'?'沿用 M2 · 受理、执行、存储与生命周期':'沿用 M3 · 三源调度、执行与存储',[
 s('coreboundary','执行所有权','队列、模型、工具与事实继续归 Core',['TUI 消费公共能力并维护本地界面；业务调度和效果判断保持原有所有权。',native?'当前 feat/TUI 未合入 M4–M6，先核定兼容目标，再验证同步。':'包隔离继续保持核心可独立安装。'],'src/control/index.ts',stage.id==='tui21'?'M2.0':'M3.0')
 ],{tone:'green',intro:stage.id==='tui21'?'M2.0':'M3.0'})]}
 ];
}
function getLanes(stage){return track==='main'?mainDiagram(stage):track==='qq'?qqDiagram(stage):tuiDiagram(stage)}

// Canonical stage data; each node owns its local children and edges.
function toTree(node) {
  return { ...node, details: node.rules ?? node.details ?? [], children: (node.children ?? []).map(toTree), edges: node.edges ?? [] };
}
function block(id, title, desc, children, edges = [], options = {}) {
  return { id, title, desc, children, edges, details: [], ...options };
}
function fact(id, title, desc, details, file, options = {}) {
  return { id, title, desc, details, file, children: [], edges: [], ...options };
}
function processingTree(node, n) {
  const context = block('context', '本次上下文', '固定本次事实，组装可见候选', [
    fact('history', '取得历史候选', n >= 4 ? '有界完整运行组' : 'Session 历史', ['Runtime 提供历史候选；Agent 按语义和实际请求容量选择。'], 'src/runtime/trigger-run.ts'),
    fact('current', '写入当前事实', n >= 3 ? '输入 / Event / Heartbeat' : n === 2 ? '用户输入 / Event' : 'Event', [n >= 3 ? '当前事实只交付一次；排队接收归档与本次执行事实分别处理。' : '当前输入或事件随执行过程追加。'], 'src/runtime/trigger-run.ts'),
    fact('authority', '本次权限', n >= 2 ? 'run / generation / signal' : 'generation / lease / signal', ['取消和代次变化撤销新的普通提交；已进入的必要追加仍等待确认。'], 'src/runtime/trigger-run.ts')
  ]);
  const model = block('model', '模型判断', 'Runtime 协调 Agent 与 Provider', [
    fact('agent-request', '请求 Agent', '构造初始或续轮请求', ['Agent 返回 ProviderRequest，拥有指令和上下文选择。'], 'src/agent/conversation-agent.ts', { reference: true }),
    block('provider-request', '调用 Provider', '计量、提交和等待模型', [
      fact('measure', '检查请求容量', '实际序列化字节', [n >= 2 ? '计量包含消息、工具声明与原生重放项；超出硬上限明确失败。' : 'M1 保留 Provider 契约；实际请求容量门禁在 M2 建立。'], 'src/protocol/input.ts'),
      fact('request-record', '追加请求事实', 'provider_request', ['请求事实通过 Runtime 的追加边界保存。'], 'src/runtime/trigger-run.ts'),
      fact('complete', '等待 complete', '响应 / 错误 / 取消', ['Provider 负责传输，Runtime 管理调用期限和本次执行权。'], 'src/providers/openai-responses-provider.ts', { reference: true })
    ].filter(child => n >= 2 || child.id !== 'measure'), [{ from: 'measure', to: 'request-record', label: '检查通过' }, { from: 'request-record', to: 'complete', label: '实际调用' }].filter(edge => n >= 2 || edge.from !== 'measure')),
    fact('response', '接收模型结果', '文本与工具调用', ['响应记录保留工具 callId 及不透明原生项，后续工具按声明分派。'], 'src/runtime/trigger-run.ts')
  ], [{ from: 'agent-request', to: 'provider-request/' + (n >= 2 ? 'measure' : 'request-record'), label: '交付请求' }, { from: 'provider-request/complete', to: 'response', label: '返回响应' }]);
  const tools = block('tools', '工具分派与续轮', '声明、所有权与回执配对', [
    fact('registry', '声明与参数检查', n >= 5 ? '固定 Agent / World 所有权' : '已声明 World 工具', ['Core 检查结构；World 检查领域参数。M5 起同时分派 Agent 任务工具。'], 'src/runtime/tool-registry.ts'),
    fact('world-call', '调用所属工具', '工具拥有者返回结果', ['World 拥有外部效果；Agent 工具通过当前权限口提交任务状态。'], 'src/runtime/trigger-run.ts', { reference: true }),
    fact('receipt', '确认回执', '原 callId / toolName / 状态', [n >= 2 ? '效果无法确认时保留 unknown 并关闭受理；成功回执与取消按取得时点收束。' : 'M1 保存回执分类，通用 unknown 停止在 M2 建立。'], 'src/runtime/trigger-run.ts'),
    fact('continuation', '交回 Agent 判断', '继续一轮或结束本次', ['模型响应和工具回执通过 nextRequest 交给 Agent；续轮仍属于当前 run。'], 'src/protocol/index.ts')
  ], [{ from: 'registry', to: 'world-call', label: '校验后分派' }, { from: 'world-call', to: 'receipt', label: '原调用回执' }, { from: 'receipt', to: 'continuation', label: '保存后续轮' }]);
  return { ...toTree(node), children: [context, model, tools], edges: [{ from: 'context/current', to: 'model/agent-request', label: '当前上下文' }, { from: 'model/response', to: 'tools/registry', label: '需要工具时' }], details: node.rules };
}
function runtimeTree(runtime, store, n) {
  const original = runtime.children;
  const lifecycleNode = original.find(node => node.id === 'lifecycle');
  const executionNode = original.find(node => node.id === 'execution');
  const children = [toTree(lifecycleNode)];
  const admissionNodes = original.filter(node => ['admission', 'delivery', 'heartbeat'].includes(node.id)).map(toTree);
  if (admissionNodes.length) children.push(block('ingress-control', '接入与调度', n >= 3 ? '多来源汇入共享队列' : '用户输入路径', admissionNodes,
    n >= 4 ? [{ from: 'delivery', to: 'admission', label: '顺序校验后受理' }, { from: 'heartbeat', to: 'admission', label: '合法 tick' }]
      : n >= 3 ? [{ from: 'heartbeat', to: 'admission', label: '合法 tick' }] : [], { tone: 'blue' }));
  children.push(processingTree(executionNode, n));
  const confirmed = store.children.filter(node => ['audit', 'projection', 'late'].includes(node.id)).map(toTree);
  if (n >= 4) confirmed.unshift(fact('history-window', '历史窗口', '从确认事实派生完整候选', ['默认最多 32 个完整运行组 / 16 MiB；投影由 Runtime 管理，底层事实由 Session 保存。'], 'src/state/history-window.ts'));
  if (confirmed.length) children.push(block('confirmed-views', '确认视图与查询', 'Runtime 管理的会话投影', confirmed, [], { tone: 'green' }));
  const taskNode = original.find(node => node.id === 'task');
  if (taskNode) children.push(block('task-control', '跨触发任务', '可选意图提交与安排消费', [toTree(taskNode), fact('task-visibility', '确认后可见', '单一追加边界', ['Agent 提交内容变更；Runtime 核对权限、修订和容量，确认后更新任务投影。'], 'src/runtime/task-coordinator.ts')], [{ from: 'task', to: 'task-visibility', label: '提交并确认' }]));
  const controls = original.filter(node => ['yield', 'operations'].includes(node.id)).map(toTree);
  if (controls.length) children.push(block('response-control', '受控响应', '显式让出、原操作及迟到确认', controls, [{ from: 'yield', to: 'operations', label: '撤权与登记' }], { tone: 'blue' }));
  const edges = [];
  if (admissionNodes.length) edges.push({ from: 'ingress-control/admission', to: 'execution/context/current', label: '出队后执行' });
  if (confirmed.length) edges.push({ from: 'execution/tools/receipt', to: 'confirmed-views/history-window', label: '保存后推进视图' });
  return { ...toTree(runtime), desc: '生命周期、受理、执行与确认投影', children, edges, details: [] };
}
function rawBuildGraph(stage) {
  const lanes = getLanes(stage);
  if (track === 'main') {
    const [source] = lanes[0].nodes, [runtime] = lanes[1].nodes, collaborators = lanes[2].nodes, [store] = lanes[3].nodes;
    const nodes = [toTree(source), runtimeTree(runtime, store, stage.n), block('collaborators', '判断与领域协作', 'Agent / Provider / World', collaborators.map(toTree), [], { intro: 1 }),
      { ...toTree(store), title: 'Session / State 存储', desc: '保存会话事实与独立键值状态', children: store.children.filter(node => ['jsonl', 'state'].includes(node.id)).map(toTree) }];
    if (stage.n === 6) nodes.push(block('memory-design', '长期 Memory', '设计目标 · 尚待确定读写契约', [fact('memory-lifecycle', '持续更新与读取', '提取、提交、可见性与恢复', ['长期 Memory 的更新来源、写入时点、可见性及存储介质仍待设计。', 'MemoryState、任务投影与 Session 历史分别记录。'], 'scratch/Off-topic discussion/持续运行Agent设计约束.md')], [], { planned: true }));
    const n = stage.n, execute = 'runtime/execution', receive = 'runtime/ingress-control/admission';
    const edges = [
      { from: 'ingress/events', to: n >= 4 ? 'runtime/ingress-control/delivery' : n >= 3 ? receive : execute + '/context/current', label: n >= 4 ? '顺序信封' : n >= 3 ? '提交事件' : 'handleEvent' },
      { from: execute + '/model/agent-request', to: 'collaborators/agent/context', label: '构造请求', twoWay: true },
      { from: execute + '/model/provider-request/complete', to: 'collaborators/provider/transport', label: '模型调用', twoWay: true },
      { from: execute + '/tools/world-call', to: 'collaborators/world/worldtools', label: '领域工具', twoWay: true },
      ...['context/current','model/provider-request/request-record','tools/receipt'].map(part => ({from: execute + '/' + part, to:'store/jsonl',label:'追加事实'})),
      { from: 'store/jsonl', to: execute + '/context/history', label: '读取历史', layout: false }
    ];
    if (n >= 2) edges.push({ from: 'ingress/console', to: receive, label: '提交输入' });
    if (n >= 3) edges.push({ from: 'ingress/heartbeat-source', to: 'runtime/ingress-control/heartbeat', label: '周期 tick' });
    return block('system', '系统协作', '按接口连接，按范围展开', nodes, edges, {layoutEdges:[{from:'ingress',to:'runtime'},{from:'runtime',to:'collaborators'},{from:'runtime',to:'store'}]});
  }
  const nodes = lanes.flatMap(lane => lane.nodes.map(toTree));
  const layoutEdges=lanes.slice(0,-1).map((lane,i)=>({from:lane.nodes[0].id,to:lanes[i+1].nodes[0].id}));
  const edges = track === 'qq' ? [
    {from:'bridge/connection',to:'qqworld/normalization',label:'入站消息'},
    {from:'qqworld/normalization',to:'qqworld/journal',label:'捕获与编号'},
    {from:'qqworld/journal',to:'qqcore/qqconversation',label:'稳定信封'},
    {from:'qqcore/qqconversation',to:'qqworld/qqtools',label:'显式工具',twoWay:true},
    {from:'qqworld/qqtools',to:'bridge/connection',label:'桥接调用',twoWay:true},
    {from:'qqcore/qqassembly',to:'qqstore/qqlifetime',label:'装配记录寿命'}
  ] : [
    {from:'operator/interaction',to:'tuiapp/'+(stage.id==='tui33'?'views':'editor'),label:'输入与界面动作'},
    {from:'tuiapp/'+(stage.id==='tui33'?'controller':'editor'),to:'contract/publicapi',label:'提交与控制',twoWay:true},
    {from:'contract/publicapi',to:'tuicore/coreboundary',label:'公开控制 / 诊断',twoWay:true}
  ];
  return block('system',track==='qq'?'QQ 接入与执行':'交互与运行协作','局部可继续展开',nodes,edges,{layoutEdges});
}

const stageTitles = {
  main: ['最小运行基座','用户交互与输入调度','统一触发调度','World 顺序投递','跨触发任务与心跳延续','受控响应与迟到归档'],
  qq: ['QQ World 与磁盘记录','QQ 对话与内存记录'],
  tui: ['全屏交互与草稿状态','独立包与公共控制契约','原生编辑与滚动交互','应用协调与状态所有权']
};
for (const [route, titles] of Object.entries(stageTitles)) stages[route].forEach((stage, i) => { stage.title = titles[i]; });
function buildGraph(stage) {
  const result = rawBuildGraph(stage);
  const stable = { 'qqworld/journal':'QQJournal', qqstore:'Session / QQJournal 记录', tuiapp:'TUI 应用', contract:'公共控制契约', 'tuiapp/editor':'草稿编辑' };
  function walk(node, path, planned = false) {
    if (planned) node.planned = true;
    if (stable[path]) node.title = stable[path];
    for (const child of node.children ?? []) walk(child, path ? path + '/' + child.id : child.id, node.planned);
  }
  walk(result, '');
  return result;
}

export function setTrack(value) { track = value; }
export { stages, buildGraph };
