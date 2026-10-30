# Visualization progress-report data

Scope: 将 docs/进度汇报 的十份 M1.0–M6.0 阶段报告映射为画布架构基线，保留阶段事实、递归职责、跨层调用及结构变更。

Design: 业务数据以独立 JSON 保存于 packages/visualization/datasets/progress-reports。通用报告适配器放在 src/adapters/progress-reports，接收可序列化实体目录和阶段增量，输出既有 VisualizationBaseline；不依赖文件系统、React 或固定业务 ID。Playground 组合根选择数据，库与适配器均不导入业务数据。实体保持稳定 ID，替换显式声明，继承内容与变更标记由适配器统一生成。路径为仓库相对路径，来源引用保留报告与实现文件。阶段同时保存 Core 与具体装配的边界，不把待实现项或关闭能力画成已启用链路。

Verification: 校验十份输入来源、完整快照及变化标记；覆盖新增、替换、移除、嵌套跨层投影与任意数据 ID；运行包级测试、类型检查、库与站点构建；原生浏览器验证真实阶段切换和递归展开；提交前运行仓库测试及类型检查。
