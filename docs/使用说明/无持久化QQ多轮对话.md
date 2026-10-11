Owner: `examples/qq/compose.ts`, `examples/qq/manual.ts`, `examples/qq/chat-offline.ts`, `src/state/memory-session.ts`, `packages/extensions/world-qq/src/config.ts`, `packages/extensions/world-qq/src/journal.ts`

# 无持久化 QQ 多轮消息对话

本入口在固定授权会话中运行进程内多轮对话。入站仅消息；回复经过显式 qq.send_text 和同步协议确认；连续追问及本会话消息引用可利用有界历史与本地快照。默认无任务工具、心跳和抢占。

## 离线试用

从仓库根执行 `pnpm build:all`，然后运行 `pnpm --filter @1002bot/qq-example chat:offline`。本地 WS/HTTP 承载实际 World 与 Agent，模型行为脚本化。依次输入：

```text
blue
repeat
/ref -1 查询第一条回复
/diagnose
/restart
repeat
/quit
```

前三轮分别产生“收到：blue”“此前：收到：blue”“引用：收到：blue”。重建后的 repeat 返回“此前：无历史”。`/history` 查看本实例确认记录；自动样例命令为 `pnpm --filter @1002bot/qq-example chat:offline --sample`。

## 接入实际环境

先按 [QQ 部署与验收说明](../../examples/qq/README.md) 核实外部桥接。复制 [配置示例](../../examples/qq/chat.config.example.json) 至部署私有文件，填写固定账号与群聊/私聊目标、Session/stream/epoch。配置不需要 journalPath/sessionPath。

```powershell
$env:QQ_CONFIG = 'D:/deployment/qq/chat.json'
$env:QQ_WS_TOKEN = '<目标 WS token>'
$env:MODEL_BASE_URL = '<Responses endpoint>'
$env:MODEL_ID = '<部署模型 ID>'
$env:MODEL_API_KEY = '<私有 key>'
pnpm --filter @1002bot/qq-example chat
```

配置文件与外部桥接数据仍由部署方管理。本模式不写 Runtime Session、QQ 领域日志或锁；真实收发需在授权会话检查，自动验证只覆盖本地协议环境。

## 生命周期与确认

同一装配实例 stop/start 保留内存事实；新实例或进程重启时 Session、消息快照、发送记录与来源序号共同清空。需要干净会话时应重建整个装配。不要复用其中一个旧存储端与另一个新端组合。

Agent 的 SessionDecl.persistent 为 false。RunResult.persisted、waitSaved 等既有字段表示所选 Session 的追加已确认；内存模式的确认不能跨进程保留。unknown 发送仍停止后续处理，不能据此自动重发。fresh 查询继续要求完整远端归属证据，本批默认本地快照。

## 容量与历史

| 边界 | 默认容量及行为 |
| --- | --- |
| 内存 Session | 合计 256 MiB、单条 16 MiB，计入 JSON 行终止符；超限拒绝并使后续读写失败 |
| QQ 领域记录 | 256 MiB，预留 4 MiB 供确认/诊断；超限停止捕获或拒绝追加 |
| 历史窗口 | 32 个完整已结清组、16 MiB，完整组裁剪 |
| 模型请求 | 64 KiB 硬上限，16 KiB 续轮软余量；保留 Provider 原生项并按完整历史组裁剪 |

QQ 装配显式允许完整失败/取消历史候选，保留“已发送、后续模型失败”的事实。裁剪后无法保证所有早期对话始终在模型上下文中；尚在本实例领域记录的消息可通过明确引用回查。配置容量不是进程堆大小或 token 数。

程序入口是 `composeQQChat(config, provider, { sessionLimits?, inputLimits? })`；QQ 记录容量使用 config.limits。旧 composeQQ(config, sessionPath, provider) 的磁盘模式继续可用。接口和验证证据见 [M5.1 报告](../2026-10-11-M5.1进度与架构图.md)。
