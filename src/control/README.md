Owner: `index.ts` 的公共控制导出、`../runtime/compose.ts` 的 `composeRuntime`

# 核心公共控制入口

`1002bot/control` 导出既有 Runtime 装配函数与共享控制类型。调用方装配依赖后，将符合 `RuntimeControl` 的对象交给前端；这里没有新增执行层或前端依赖。

核心完整包入口 `1002bot` 另导出已有 Agent、Provider、Session、State 与协议。内部行式 Console 消费相同控制契约，保留在 `src/console` 用于测试。

composeRuntime 的 worldStreams、deliveryLimits、historyLimits 配置顺序来源与运行视图。来源投递和只读 Session 检查由核心接口提供，公共前端控制输出只增加可选 delivery 身份；使用及兼容边界见 [M4 迁移说明](../../docs/使用说明/M4顺序投递与迁移.md)。
