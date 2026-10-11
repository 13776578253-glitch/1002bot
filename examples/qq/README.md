Owner: `compose.ts`、`offline.ts`、`manual.ts`、`probe.ts`、`config.example.json`、`compose.snowluma.example.yaml`

# QQ 装配与验收

从仓库根运行 `pnpm install:all`、`pnpm sample:qq`。离线样例使用真实回环 WS、World 文件、Session 与 Runtime，脚本模型依次查询、发送、续轮；断言一次发送及成功持久终态。不会连接真实服务。

## 外部桥接配置

World 不启动或管理 QQ/SnowLuma。部署方参考 [SnowLuma Docker 框架](https://github.com/SnowLuma/SnowLuma.Docker.Framework)，使用 [Compose 示例](compose.snowluma.example.yaml)，先将 `SNOWLUMA_IMAGE` 设置为已核实的 `motricseven7/snowluma:<tag>@sha256:<digest>`。不使用漂移的 latest。实际已安装版本、digest、账号与动作返回类型填写 [验收模板](acceptance.example.json)；本仓库没有声称验证某个部署版本。

Windows Docker Desktop 使用 WSL2 后端；按照 [Docker 官方 Windows 要求](https://docs.docker.com/desktop/setup/install/windows-install/) 核实 WSL/虚拟化与资源。容器需要 `SYS_PTRACE`、`seccomp=unconfined`、1 GiB 共享内存和示例中的 nofile 参数。部署方阅读并接受 SnowLuma 条款后设置 EULA/privacy 环境变量。保留三个持久卷与默认禁用 GPU 的 QQ flags。升级不删除卷；`docker compose down -v` 会删除设备身份、登录态与配置。

noVNC `http://127.0.0.1:6081` 用于人工扫码；WebUI `http://127.0.0.1:5099` 用于配置。首次初始化的管理密码仅写入容器日志一次，由部署方自行获取，不写入仓库或验证记录。扫码前账号级 WS 可能未就绪，World 在启动期限内按固定节奏重试。

选择账号级 `/app/data/config/onebot_<uin>.json` 中目标 `networks.wsServers` 项，核实合并端点的 `path`、`role: Universal` 和 `accessToken`。HTTP 与 WS token 独立；将 WS token 放入 `QQ_WS_TOKEN`，握手使用 Bearer 头，URL 不携带 token。账号 snapshot 配置优先于全局默认；环境 WS 端口覆盖可能不回写文件。必须关闭 `statusCommand.enabled`，避免 `#sl` 绕过 Runtime 发言；设置 `messageFormat: array`、`reportSelfMessage: false`。World 同时过滤自身推送。

宿主 World 使用 `ws://127.0.0.1:3001/`；同 Compose 网络内使用 `ws://snowluma:3001/`，无需发布 WS 宿主端口。桌面、WebUI 和 WS 的宿主端口均绑定回环。容器内 `/app/data` 消息库属于桥接；宿主 World 的 journal/Session 是独立记录，不能互相替代。

协议依据：[正向 WS](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)、[响应分类](https://github.com/botuniverse/onebot-11/blob/master/communication/http.md)、[消息事件](https://github.com/botuniverse/onebot-11/blob/master/event/message.md)。SnowLuma 的有符号哈希消息号有碰撞可能；`get_msg` 可能读取消息库。缺失账号/时间等归属证据的回应不会标记为新鲜观察。

## 手动协议验收

复制示例配置到部署私有文件，填写固定账号/会话、稳定 Session/stream/epoch，以及绝对 journal/session 路径。

```powershell
$env:QQ_CONFIG = 'D:/deployment/qq/config.json'
$env:QQ_WS_TOKEN = '<target wsServers token>'
pnpm --filter @1002bot/qq-example probe
```

probe 只查询登录/版本信息并等待一条授权入站，再查询其 `get_msg`。记录字段形状、账号与版本，不输出 token。可选设置 `QQ_PROBE_SEND_TEXT` 后再次运行，明确发送一次固定目标文本并记录原生返回；unknown 不重发。人工观察消息是否收取，与返回证据分别记录。probe 不写 Runtime Session，不能代替闭环验收。

## 手动 Runtime 验收

```powershell
pnpm --filter @1002bot/qq-example bridge
```

在授权会话发送文本，脚本模型先查本地快照，再发固定验收文本。检查 World 意图/确认与原生消息号、Session 的工具回执和持久终态；人为断开桥接后恢复，检查原入站去重与序号不变。Ctrl+C 仅清理 World 自有资源。未知发送先核对平台与领域操作记录，不更换 epoch、清空文件或手动重放。

第二层用实际 Provider；填部署 endpoint/model/key：

```powershell
$env:MODEL_BASE_URL = '<responses-compatible endpoint>'
$env:MODEL_ID = '<deployment model id>'
$env:MODEL_API_KEY = '<private key>'
pnpm --filter @1002bot/qq-example provider
```

真实输入必须触发模型显式工具，续轮保存对应回执，QQ 人工确认收取，Session 保存终态。Provider 最终文本仅为本地输出。未知效果、预检阻断、容量及清理期限分别留脱敏证据。两层验收使用独立且明确绑定的 Session/World 文件，不能用之前的 Provider 单独测试或离线样例代替。

## 诊断

| 代码/原因 | 处置 |
| --- | --- |
| connection_unavailable | 核实登录状态、合并端点、WS token 与账号，启动总期限内自动重连 |
| native_identity_conflict | 保存原映射，检查消息号复用/碰撞；停止新增编号 |
| event_capacity | 原事实编号前拒绝，调整明确容量或消息范围 |
| capture_capacity / capture_failed | 停止新捕获并断开；检查缓冲、磁盘与领域记录 |
| unproven_message | 远端证据不足；明确选择已标记的本地快照 |
| unknown_send / confirmation_failed | 不重发，按 operationId 核对外部效果与 Session |
| cleanup_timeout | 等待底层清理，核实本进程自有 socket/锁；不终止外部 QQ |
| binding conflict / incomplete tail / Session diagnosis | 保留记录，处理绑定或历史一致性；不自动修写/清空 |

自动验证、容量实测与交付状态见 [阶段报告](../../docs/2026-10-11-M4.1进度与架构图.md)。
