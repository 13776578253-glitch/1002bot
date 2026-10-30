Owner: `packages/visualization/src/adapters/progress-reports/types.ts`, `packages/visualization/datasets/progress-reports/architecture.json`

# 进度汇报架构数据

`architecture.json` 依据仓库 `docs/进度汇报` 的十份 M1.0–M6.0 报告整理。JSON 可整体复制到其他项目；路径为仓库相对引用，适配器不会读取这些路径。Markdown 语义由人工整理，报告修改后需同步相关实体和阶段并更新 `revision`。

## 数据结构

- `rootId`：所有阶段共同的根节点 ID。
- `revision`：输入版本；变更时更新以重建画布会话。
- `nodes`：节点目录，包含稳定 `id`、显式 `parentId`、类型、标题、摘要、顺序与 `sourceRefs`；`position` 可指定父局部坐标，顶层使用画布坐标。
- `links`：有向或双向关系目录；`source` / `target` 引用稳定节点 ID。
- `stages`：按报告日期排列的累计阶段。`nodes` / `links` 填目录键，作为本阶段新增或更新；`removeNodes` / `removeLinks` 填稳定 ID，显式移除。每阶段保存报告路径、日期和交付状态。
- `replacements`：明确记录新实体 ID、上一实体 ID 与替换说明。删除独立声明；目录键不同但稳定 ID 相同可更新元数据或父层级。

首阶段形成初始快照。后续阶段继承上一快照，变更标记统一生成：出现新 ID 为新增，保留 ID 为沿用，显式替换为替换。节点目录键允许 `runtime-m2` 等版本键；跨阶段身份始终由实体 `id` 决定。

阶段排列呈现仓库已交付能力的累计视图。M2.1 / M3.1 展开终端工程线，M4.1 / M5.1 展开 QQ 工程线；每阶段变化相对列表上一项。QQ Chat 的内存存储是装配选择，Core 任务能力和磁盘装配继续存在。M6 的响应能力由独立组合入口启用，QQ Chat 与 TUI 默认关闭。

`sourceRefs` 第一项链接引入或更新该实体的报告章节，后续项保留报告中的实现引用，包含历史路径。关系来源为引入或更新它的 `stages[].source`，替换原因在 `replacements` 中。

## 接入与迁移

```ts
import { adaptProgressReports, type ReportDataset } from '@1002bot/visualization/adapters/progress-reports';

const source: ReportDataset = await response.json();
const baselines = adaptProgressReports(source);
```

加载由组合根负责，适配器无文件系统、浏览器或 React 依赖。完整快照进入公共画布时使用现有输入校验。新数据源可实现自己的纯适配器，直接输出 `VisualizationBaseline[]`。

数据集不随通用库构建嵌入 `dist`；独立适配器随库发布。站点将 JSON 发布为独立静态资源，由 Playground 通过 URL 加载，业务数据不内联到应用 JS。`examples/baselines.ts` 仅供原交互回归使用。
