Owner: `packages/visualization/package.json`, `src/react/VisualizationCanvas.tsx`, `src/adapters/progress-reports/index.ts`

# Visualization

唯一基线是递归自由画布。站点入口为 [http://127.0.0.1:5199/](http://127.0.0.1:5199/)。

## 运行与验证

仓库根目录执行 `pnpm dev`。包目录支持：

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm build:web
pnpm check:dist
```

`build` 生成通用库的 JS、类型声明与样式；`build:web` 生成 `playground/dist/index.html` 和资源。开发服务器固定绑定 `127.0.0.1:5199`，端口占用时直接报错。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `src/core/schema` | Canonical Graph、完整快照、基线变化标记和输入校验 |
| `src/core/graph` | 稳定 ID 索引、父引用及 GraphPatch |
| `src/core/projection` | 按展开状态投影节点、折叠端点和跨层关系 |
| `src/core/layout/geometry.ts` | 正交避障、矩形与路径运算 |
| `src/react/model` | 初始位置、递归显隐、分组、吸附、四向有限扩缩、路由与标签 |
| `src/react/canvas` | 受控交互状态与场景派生 |
| `src/react/components` | 节点、关系和控制组件 |
| `src/react/styles` | 画布作用域内的主题、节点、连线和控制样式 |
| `src/adapters/progress-reports` | 将可序列化的报告目录与阶段增量转换为完整基线；无 IO 或 UI 依赖 |
| `datasets/progress-reports/architecture.json` | 依据进度汇报整理的 M1.0–M6.0 架构事实与来源 |
| `examples/baselines.ts` | 独立 M1/M2 样例输入 |
| `playground/src/baselines.ts` | 通过 URL 加载独立 JSON 资源，调用报告适配器 |
| `playground/src/main.tsx` | 公共画布与报告基线的装配入口 |

Core 不依赖 React；库源码不导入示例、数据集或 Playground。测试按模型单元、模块协作、输入合同和架构边界划分。

## 进度汇报数据

当前站点消费 `datasets/progress-reports/architecture.json`，覆盖进度目录的十份阶段报告。每个节点保留报告与实现文件的仓库相对引用。数据是按报告整理的历史架构，阶段状态保存在 `stage.status`。

报告适配器通过 `@1002bot/visualization/adapters/progress-reports` 独立导出，接收 `ReportDataset`，返回 `VisualizationBaseline[]`。调用方负责文件、HTTP 或其他加载方式；适配器只处理实体目录、累计阶段和变化标记。数据维护与迁移约定见 [数据说明](datasets/progress-reports/README.md)。

## React 接入

```tsx
import { VisualizationCanvas } from '@1002bot/visualization/react';
import type { VisualizationBaseline } from '@1002bot/visualization';
import '@1002bot/visualization/styles.css';

export function Architecture({ baselines }: { baselines: readonly VisualizationBaseline[] }) {
  return <div style={{ width: '100%', height: '100vh' }}>
    <VisualizationCanvas baselines={baselines} initialBaselineId={baselines[0]!.id} />
  </div>;
}
```

组件填充父容器。`baselines` 至少一项，按数组顺序展示；未指定 `initialBaselineId` 时默认选择最后一项。`initialTheme` 可设为 `dark` 或 `light`，默认读取本地主题偏好。

## 数据接口

每个 `VisualizationBaseline` 包含：

- `id`：基线选择标识，数组内唯一。
- `stage`：完整 `StageSnapshot`，其中 `graph` 使用稳定 node/edge ID、显式 `parentId` 与 canonical 端点。
- `nodeChanges`、`edgeChanges`：按实体 ID 提供 `ChangeMark`，覆盖所有非根节点及关系。
- `positions`：可选初始坐标。根层节点是画布坐标；子节点是父容器局部坐标。缺省使用有序网格，节点输入顺序不影响父子组织。

`ChangeMark.kind` 为 `baseline`、`inherited`、`added` 或 `replaced`，`label` 是相应文字，`note` 可记录替换前后关系。界面仅显示新增、替换注释，分别使用绿色、琥珀色；其余关系保留名称。

接入数据先调用 `assertValidBaselines` 校验。React 组件也在输入边界执行校验，拒绝重复基线 ID、无效图、缺失标记或非法坐标。需要增量更新时，使用 Core `applyGraphPatch` 生成新的完整快照，再组装基线输入。

每次替换源数据应更新 `stage.graph.revision`。基线 ID 或 revision 变化会重建画布会话；相同 revision 下的父组件重渲染保留当前会话。卡片移动、分组和标题修改仅存于组件会话；切换基线保留各自位置和分组，共有节点同步当前展开状态。

真实数据适配器后续只负责生成上述合同，不在渲染组件内解析业务文件或绑定业务节点 ID。

## 交互基线

双击或点击展开按钮原位递归展开，跨层连线绑定可见端点。支持拖动、平移、缩放、直接关联链路高亮、Shift 框选、Ctrl/Cmd+G 分组、标题编辑和解散。

内部卡片可向四周撑开父链，回拖收缩。每轴额外空间最多为自然尺寸的 100% 且不超过 800 px，两侧共享总余量；连续拖动不抬高上限。近对齐时按 6 屏幕像素阈值吸附，连线和标签避开卡片及标题。

## 0.2 基线迁移

正式接口为 `VisualizationCanvas` 和 `VisualizationCanvasProps`，旧 `EvolutionCanvas`、store、scene/layout-provider 接口已移除。样式改为显式导入 `./styles.css`。唯一页面是 `/`；旧 HTML 入口、主题预览、生成数据工具与旧业务 adapter 已移除。

后续开发以 `src/` 的公共组件和合同为基础，新增业务适配器放在库外或独立 examples 中。
