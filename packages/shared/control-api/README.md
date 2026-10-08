Owner: `src/index.ts` 的 `RuntimeControl`、输入回执与公开诊断类型

# 公共控制契约

核心与前端共用输入、回执、快照、公开诊断和生命周期能力类型。该包没有终端框架或核心实现依赖，运行输出为空模块。

`RuntimeControl` 沿用已有 `inputs`、`status`、`start()` 与 `stop()`。核心协议入口兼容导出原类型；前端使用包入口，不读取核心内部路径。类型契约不表示已经实现网络传输或完整 World/配置监控。

构建：`pnpm --filter @1002bot/control-api build`。类型检查：`pnpm --filter @1002bot/control-api typecheck`。
