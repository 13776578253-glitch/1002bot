Owner: `src/index.ts`、`src/world.ts`、`src/driver.ts`、`src/journal.ts`、`src/normalize.ts`、`src/config.ts`

# QQ World

`@1002bot/world-qq` 实现 M4 `World`，连接外部部署的 OneBot v11 正向合并 WS。一个实例绑定一个 QQ 账号、一个群聊或私聊，以及一个 Session/stream/epoch。

```ts
import { QQWorld } from '@1002bot/world-qq';
const world = new QQWorld({
  endpoint: 'ws://127.0.0.1:3001/', accessToken: process.env.QQ_WS_TOKEN!,
  journalPath: '/deployment/qq-world.jsonl',
  binding: { worldId: 'qq', sessionId: 'qq-session', streamId: 'messages', epoch: 'first',
    accountId: 10001, conversation: { kind: 'group', id: 20001 } },
});
// composeRuntime 使用 worldStreams: [world.stream]；eventBytes 与 world.limits.eventBytes 对齐。
```

构造不打开资源。`start` 打开并核对领域记录，确认 `get_login_info.user_id` 后处理早到消息；`subscribeDeliveries` 同步返回退订函数。`stop` 撤销投递口，关闭 socket、响应等待、重连与扫描，等待已进入的追加完成。清理超时报告 `cleanup_timeout`，后台清理仍继续，新启动等待旧清理完成。

## 事件与查询

`qq.message` payload 保存 `accountId`、`conversation`、有符号 32 位 `messageId`、Unix 秒 `nativeTime`、`senderId`、文本及有界 `mentions/references/unsupported`、`metadataTruncated`、本地 `observedAt`。不保存附件地址或原生对象；CQ 文本保持文本。自身消息、`message_sent`、其他账号和会话在编号前过滤。必须配置桥接的 `messageFormat: array`。

`qq.get_message({message_id, fresh?})` 只接受已捕获或确认发送的本会话消息。缺省返回 `source: local_snapshot, fresh: false` 与原观察时间。`fresh: true` 调用 `get_msg`，要求回应完整证明账号、会话、原消息时间、发送者与内容；否则返回 `unproven_message`，调用者可明确请求本地快照。`fresh: true` 表示本次观察桥接返回的记录，SnowLuma `get_msg` 自身可能来自消息库，不证明 QQ 端内容实时刷新。确认发送记录没有原生时间，因此只提供本地快照。

## 显式发送

`qq.send_text({text})` 只发送纯文本段到固定配置目标，拒绝额外收件人参数，限制 UTF-8 字节数。保存独立 UUID 意图后才发送；`callId` 仅配对 Runtime 回执，UUID 同时是本次原生 echo。成功要求对应响应 `ok/0`、合法有符号 32 位消息号、无本地键冲突及确认记录追加完成。

发送可能提交后的超时、取消、断线、async、不完整成功和确认写失败均保持 `unknown`。首版没有针对已部署版本证明“发送未执行”的错误码白名单，所有提交后的失败响应也保守归为 unknown。unknown 停止来源并终止连接；Runtime 负责取消后续执行。意图和结果不会自动重发、恢复或变成自身 ordered 触发。成功仅代表 OneBot 同步确认。

## 领域记录

JSONL 首行 `binding/schema=1` 固定全部来源与平台绑定。`received` 保存原生键、快照和原信封；`saved` 保存连续 Session 接收前缀；`intent/result` 保存出站操作；`diagnostic` 保存可写入的停止原因。原生键为账号/会话类型/目标/原消息号。sequence 从 1 连续增加；并发回调串行捕获，重连保持原身份。同键不同事实停止来源。

Journal 的身份操作队列串行完成原生键查询、分配与确认发布，追加队列负责单条记录写入。捕获及发送意图须留出 reserveBytes，结果与诊断可使用剩余容量；容量拒绝后仍可尝试诊断追加，物理写入失败则冻结追加并保留尾部供诊断。

磁盘保留全 epoch 原始记录，没有内存消息索引；去重、查询及补投以有界分块扫描读取。RAM 只保存有界早到/待捕获输入及当前扫描/投递项。`accepted` 不推进 World 保存前缀；`waitSaved` 完成并核对 `receivedPrefix` 后追加 `saved`。队列满、窗口满、缺口和丢失确认重投原信封。`settledPrefix` 的窗口释放由 Runtime 管理。

文件锁禁止同一记录被多个活动进程使用。退出后仅在原 PID 明确不存在时清理陈旧锁；权限不明或 PID 被复用时要求人工核实。破损/不完整尾部、绑定变化和非法前缀阻断启动，保留原文件供人工处理。日志追加没有 fsync/断电保证；上游推送在本地追加完成前或断线期间丢失不承诺找回。

## 内存记录模式

`QQWorld` 同时接受 `QQMemoryConfig`：传入 `storage: 'memory'`，省略 `journalPath`。该模式沿用绑定、原生身份、连续序号、保存前缀、发送意图及确认记录，记录仅存在于此 World 实例，不创建文件或锁。`inspect().storage` 返回 `memory` 或 `file`。

```ts
const world = new QQWorld({
  endpoint: 'ws://127.0.0.1:3001/', accessToken: process.env.QQ_WS_TOKEN!,
  storage: 'memory',
  binding: { worldId: 'qq', sessionId: 'qq-chat', streamId: 'messages', epoch: 'chat-1',
    accountId: 10001, conversation: { kind: 'group', id: 20001 } },
});
```

同一实例 stop/start 保留内存记录；新实例清空。配套 Session 必须选择同一生命周期，纯内存聊天可使用样例的 `composeQQChat`。只重建其中一端会造成来源进度不一致。记录仍受 `journalBytes`、`reserveBytes` 与单条容量限制，不自动淘汰身份或未确认操作；达到容量后停止捕获或拒绝追加。内存模式按确认记录顺序扫描 JSON 副本，没有跨进程恢复保证。

## 默认边界

| 参数 | 默认值 | 到达边界的行为 |
| --- | --- | --- |
| bufferEntries / bufferBytes | 256 项 / 16 MiB UTF-8 序列化输入 | 停止新捕获、断开、留下诊断 |
| journalBytes / reserveBytes | 256 MiB / 4 MiB | 预留空间供确认与停止；新捕获/意图受低水位约束，总空间耗尽阻断追加 |
| frameBytes / eventBytes | 1 MiB / 64 KiB | 帧超限断开；事件超限在编号前拒绝 |
| textBytes / metadataEntries | 8 KiB / 32 项 | 出站拒绝；入站非文本元数据截断并标记 |
| connectMs / startMs | 5000 / 30000 ms | 握手失败按重连节奏重试；启动总期限失败清理 |
| apiMs / pendingActions | 7000 ms / 16 项 | 响应等待超时；并发工具拒绝新调用 |
| retryMs / reconnectMs / idleMs | 250 / 1000 / 90000 ms | 入站重投、连接重试、无帧/Ping/Pong断开 |
| cleanupMs | 3000 ms | 终止等待并报告，底层清理继续 |

默认值由 `DEFAULT_QQ_LIMITS` 导出，`limits` 可覆盖。装配的 Runtime `toolMs` 大于 `apiMs`，`cleanupDeadlineMs` 大于 `cleanupMs`。接收缓冲按原始输入序列化字节计量，不是整个进程的堆上限。磁盘扫描成本随记录增长；单会话首版需按部署规模监测。

运行：根 `pnpm install:all`、`pnpm test`、`pnpm run typecheck`、`pnpm sample:qq`。包内 `test` 包含本地 WS 集成与真实退出测试；`scripts/measure.ts <输出路径>` 测量扫描、捕获和清理。操作与人工验收见 [QQ 样例](../../../examples/qq/README.md)。
