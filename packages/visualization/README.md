Owner: `packages/visualization/package.json`, `src/react/index.ts`, `src/react/VisualizationCanvas.tsx`, `src/react/model/workspace.ts`, `src/react/model/stage-transition.ts`, `src/react/model/stage-navigation.ts`, `src/react/model/placement.ts`, `src/react/model/frozen.ts`, `src/react/model/blackbox-routes.ts`, `src/react/model/edge-routes.ts`, `src/adapters/progress-reports/index.ts`, `src/core/project/types.ts`, `src/core/project/resolve.ts`, `src/adapters/project/index.ts`, `src/react/model/manual-layout.ts`, `src/react/model/project-workspace.ts`, `src/react/persistence/project-storage.ts`

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
pnpm check:snapshots
```

`build` 生成通用库的 JS、类型声明与样式；`build:web` 生成 `playground/dist/index.html` 和资源。开发服务器固定绑定 `127.0.0.1:5199`，端口占用时直接报错。`check:snapshots` 校验每个项目快照的文件名与 `id` 等于其 `select`/`remove` 的短哈希。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `src/core/schema` | Canonical Graph、完整快照、基线变化标记和输入校验 |
| `src/core/graph` | 稳定 ID 索引、父引用、GraphPatch 与阶段差异 |
| `src/core/projection` | 按展开状态投影节点、折叠端点和跨层关系 |
| `src/core/layout/geometry.ts` | 正交避障、矩形与路径运算 |
| `src/core/layout/node-port-allocator.ts` | 物理端口槽位、容量退化与事务分配 |
| `src/core/layout/input-fingerprint.ts` | 布线输入指纹、保护路径与跨组依赖 |
| `src/core/layout/legality.ts` | 统一硬合法性校验 |
| `src/core/layout/search-limits.ts` | A* 与拼接循环的搜索上限 |
| `src/react/model` | 初始位置、递归显隐、分组、吸附、四向有限扩缩、路由与标签 |
| `src/react/model/route-groups.ts` | 离线星形组求解、四种模式与跨组端口协调 |
| `src/react/model/label-candidates.ts` | 路径的多标签候选与分支偏好 |
| `src/react/model/route-quality.ts` | 组级统一质量度量与路径-标签评分 |
| `src/react/model/route-selection.ts` | 组解完整性与旧路由回退选择 |
| `src/react/canvas` | 受控交互状态与场景派生 |
| `src/react/model/workspace.ts` | 可序列化工作视图、草稿/已确认快照与有界事务历史 |
| `src/react/model/stage-transition.ts` | 阶段差异、原子安置流水线与结构化冲突 |
| `src/react/model/placement.ts` | 展开与增量安置共享的几何求解、确定性空隙填充与有限扩容 |
| `src/react/model/stage-navigation.ts`、`snapshot-inheritance.ts` | 父确认快照继承、来源修订与当前草稿三方合并 |
| `src/react/model/frozen.ts` | 单层冻结子图、只读展开与解冻 |
| `src/react/model/blackbox-routes.ts` | 隐藏内部路径、边界端口与刚性分段、外部连接可行性 |
| `src/react/model/edge-routes.ts` | Canonical Edge 路径持久化、owner 坐标与可见展示边应用 |
| `src/react/model/route-cache.ts` | 按端点、障碍和保留路径变化失效的精确路径与标签缓存 |
| `src/react/model/display-edges.ts` | 折叠展示边聚合及原始连接成员 |
| `src/react/components` | 节点、关系和控制组件 |
| `src/react/styles` | 画布作用域内的主题、节点、连线和控制样式 |
| `src/adapters/progress-reports` | 将可序列化的报告目录与阶段增量转换为完整基线；无 IO 或 UI 依赖 |
| `src/adapters/project` | Source 增量、View 语义与人工几何的纯适配 |
| `src/react/model/manual-layout.ts` | 人工坐标与边界检查，保持未操作节点和容器几何 |
| `src/react/model/project-workspace.ts`、`persistence/project-storage.ts` | 项目工作空间与画布合同桥接、独立确认检查点 |
| `datasets/projects.json` | 项目注册表；默认项目指向清单 |
| `datasets/projects/1002bot/project.json` | 当前项目清单，Source / Stages / Views / Workspace 资源 |
| `datasets/projects/1002bot/source/catalog.json` | 组件、关系与契约事实 |
| `datasets/projects/1002bot/stages/` | 快照选择，文件名为短哈希 |
| `tools/snapshot-id.ts` | 计算、校验与写回快照短哈希 id |
| `tests/fixtures/legacy-reports.json` | 旧 M1.0–M6.0 报告数据集，仅供旧报告适配器测试 |
| `tests/fixtures` | 基线与递归层级测试共用的样例输入 |
| `playground/src/baselines.ts` | 读取注册表、清单与 Source / Stages / Views / Workspace 资源 |
| `playground/src/main.tsx` | 公共画布、默认项目及项目存储桥接的装配入口 |

Core 不依赖 React；库源码不导入示例、数据集或 Playground。测试按模型单元、模块协作、输入合同和架构边界划分。

## 项目数据

当前站点从 `datasets/projects.json` 的默认项目加载首个快照的六块总览，使用人工编排模式。Source 保存累积事实与契约；Stages 选择每份快照出现的事实；Views 保存展示选择、总览／详情关系映射、容器端口和人工几何；Workspace 保存分快照用户草稿、确认快照及历史检查点。布局不会由展开、阶段切换或拖动自动重排。缺少位置、重叠和越界须显式处理。

项目适配器通过 `@1002bot/visualization/adapters/project` 导出，`resolveSourceStages` 负责把事实目录与阶段选择组装成适配器输入。旧报告适配器与 `tests/fixtures/legacy-reports.json` 保留用于旧数据；当前站点使用独立项目存储键。详细合同和迁移约定见 [数据说明](datasets/README.md)。

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

## 稳定工作视图

节点约束为 `free`、`fixed`、`locked`。固定节点允许手动移动，自动避让保持其位置；锁定节点保护直接移动、标题与归属编辑，仍允许查看及符合空间约束的展开。父级整体移动保留内部相对坐标。冻结操作一次固定全部可见自由节点，锁定状态保持不变。

报告模块折叠后，按可见端点、方向和关系类型聚合外部连线；点击数量标签查看原始关系及端点路径。定位仅展开所需祖先并聚焦目标。新增和替换保留文字及数量；空间不足时保持布局并提示相关约束。

`persistence` 为可选配置。Playground 通过 createProjectViewStorage 启用项目工作空间自动恢复与确认检查点；通用调用方可注入同步或异步 `CanvasViewStorage`：

```tsx
import { VisualizationCanvas, createLocalStorageViewStorage } from '@1002bot/visualization/react';

const persistence = {
  key: 'architecture-workspace',
  storage: createLocalStorageViewStorage(localStorage),
};

<VisualizationCanvas baselines={baselines} persistence={persistence} />;
```

`CanvasWorkspaceView` v2 保存当前阶段、各阶段草稿与已确认快照、节点布局/展开/约束、手动分组与标题、冻结组、路径、覆盖层占位、容器扩容基准和视口；函数、选择状态、路由缓存与撤销栈不保存。源版本变化时按稳定 ID 合并：新节点自由，删除实体和空组移除，报告归属取当前源，合法手动归属保留。恢复冲突或存储错误会显示状态和重试入口，读取失败期间不覆盖原记录。

位置与约束按阶段保存；切换时共同节点继续同步当前展开状态。展开和切换不自动缩放全图，恢复各阶段已保存视口；适应画布由按钮触发。拖动结束、标题提交及其他布局操作后保存，视口在移动结束时保存。

每阶段当前页面会话保留100步撤销/重做。一次拖动包含祖先扩缩和邻居避让；冻结、分组、标题提交和展开各占一步。快捷键为 Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z（另支持 Ctrl+Y），输入框使用原生编辑历史。

## 阶段增量与冻结子图

工作视图 v2 把草稿和已确认快照分开保存。自动保存只更新草稿；工具栏的确认按钮写入 `confirmedAt` 与当前内容副本，后续阶段以该副本为基础。切换阶段时若来源阶段没有确认快照，画布拒绝进入下一阶段。

首次进入目标阶段时，只对来源差异求解：共同叶节点沿用已确认世界坐标，容器保留 `worldPosition - fitOffset` 内容锚点。替换实体按 `previousId` 继承旧布局，归属改变的替换实体重新安置。新增节点优先填补空隙，必要时只展开所需祖先并四向有限扩容。阶段增量每轴预算为自然尺寸加 800px，成功后不抬高自然基准；手动拖动保留原比例上限，已合法生成的既有尺寸可保持。

保存阶段同时记录生成它的父确认内容、目标来源图和生成基准。父确认与来源均未改变时直接恢复当前草稿；发生变化时重建传入内容，与当前草稿三方合并。独立编辑合并，同项不同修改、受保护对象移动和删除已编辑对象产生冲突。自动投影路径是可失效的几何缓存，人工路径及冻结账本独立保留。旧目标缺少继承基准时提供显式、可撤销的重新继承操作。

阶段切换是原子事务：`Prepare → Diff → Place → Route → Validate → Commit`。校验失败时不修改源阶段、不写目标快照、不切换基线，只显示只读候选预览和结构化冲突。成功后目标阶段记一步撤销事务。

冻结组为单层，禁止嵌套和成员重叠。冻结时容器固定、全部后代锁定，按 Canonical ID 捕获所有内部连接，包括折叠隐藏的连接。内部点列与标签使用 owner 相对坐标；跨边界连接保留刚性内部段及真实边界端口，外部段单独求解。端口直接落在边框时，内部段可以只有一个坐标点。

整体拖动只改变组原点，内部坐标不变。折叠状态也预检隐藏端口的可行性，展开按已保存尺寸恢复。折叠后的路由将内部障碍压缩为完整保护框，点列仍保留在账本中。解冻恢复原约束与人工路径，并保留其他冻结组的边界保护；收展、拖动和解冻均可撤销。成员或锁定连接的来源删除、更改归属产生冲突。

路径状态为 `auto`、`pinned`、`locked`。`auto` 由算法自由计算；`pinned` 优先保留，失效时可局部重算；`locked` 逐点保留并阻止自动修改。路径按 Canonical Edge ID 保存，折叠聚合展示边不继承独立路径；展开且端点指纹匹配后恢复。锁定路径的标签位置一并保存。

工作视图保存投影路径与障碍版本提示，恢复时直接复用仍可行的路径。改变节点、端口或障碍时只失效受影响几何；冻结时保留已经建立的交叉，后续改变障碍位置须重新校验。选择和视口导航不触发寻路。性能记录同时包含约束预检、自动路由及冻结外部段计算。

`CanvasWorkspaceView` 当前为 v2。v1 记录读取时自动迁移为草稿，原节点视图保留，路径和冻结组为空；确认必须由用户显式操作。

## 数据接口

每个 `VisualizationBaseline` 包含：

- `id`：基线选择标识，数组内唯一。
- `stage`：完整 `StageSnapshot`，其中 `graph` 使用稳定 node/edge ID、显式 `parentId` 与 canonical 端点。
- `previousStageId`：可选阶段父级；缺省时按数组前一项推导。
- `nodeChanges`、`edgeChanges`：按实体 ID 提供 `ChangeMark`，覆盖所有非根节点及关系。`replaced` 标记可带 `previousId`，增量布局据此继承旧实体位置。
- `positions`：可选初始坐标。根层节点是画布坐标；子节点是父容器局部坐标。默认模式缺省时使用有序网格。
- `layout`：人工模式指定 kind=manual 和每个节点的完整位置及尺寸，容器还指定 expandedSize。用户保存几何优先于这些初始值。
- `stage.presentation`：展示关系的展开条件、原始关系映射和细化关系。总览和细节按条件互斥。

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

## Port policy

The authored overview uses `portPolicy: { "direction": "top-down" }`. Views without a direction preference use geometric endpoint direction. Candidate routing and snapshot compatibility are described in [the route model](src/react/model/README.md).

## Routing engine switch

The default remains the incremental candidate router. `?routing=group` enables the experimental offline group solver; omitting the parameter or using `?routing=legacy` keeps the old path. The group engine only takes over when the solution covers every expected edge and there are no stored pinned/locked paths, frozen groups, aggregated display edges or preview state. While dragging, the old cache keeps the low-cost path; on release the group solver runs again. Any incomplete or illegal group transaction falls back to the last legal legacy routes, so no edge disappears. Labels with `space-exhausted` are not rendered.
