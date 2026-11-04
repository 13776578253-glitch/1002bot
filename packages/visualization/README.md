Owner: `packages/visualization/package.json`, `src/react/index.ts`, `src/react/VisualizationCanvas.tsx`, `src/react/model/workspace.ts`, `src/react/model/stage-transition.ts`, `src/react/model/stage-navigation.ts`, `src/react/model/placement.ts`, `src/react/model/frozen.ts`, `src/react/model/blackbox-routes.ts`, `src/react/model/edge-routes.ts`, `src/adapters/progress-reports/index.ts`, `src/core/project/types.ts`, `src/core/project/resolve.ts`, `src/adapters/project/index.ts`, `src/react/model/manual-layout.ts`, `src/react/model/layout-intent.ts`, `src/react/model/snapshot-inheritance.ts`, `src/react/canvas/use-workspace-session.ts`, `src/react/model/project-workspace.ts`, `src/react/persistence/project-storage.ts`, `src/react/model/view-projection.ts`, `src/react/model/normalize-card-layout.ts`, `src/react/model/label-layout.ts`, `src/react/model/label-pins.ts`, `src/react/model/label-snapshots.ts`

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
| `src/react/model/group-route-cache.ts` | 组级增量缓存、路径保留与邻居失效 |
| `src/react/model/routing-status.ts` | 组解回退原因与提示文案 |
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
| `src/react/model/manual-layout.ts` | 人工坐标、局部父链扩缩与边界检查，保持无关节点位置 |
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

当前站点从 `datasets/projects.json` 加载默认项目 `runtime-evolution`，提供 M1/M2 Runtime 及协作者切片；原 `1002bot` M0 项目保留。两者均使用人工编排模式。Source 保存累积事实与契约；Stages 选择每份快照出现的事实；Views 保存展示选择、总览／详情关系映射、容器端口和人工几何；Workspace 保存分快照用户草稿、确认快照及历史检查点。新增节点先寻找空位，再尝试有限扩容；展开和拖动只贴合受影响父链，不推动其他组件。容器四向扩缩通过局部坐标补偿保持已有内容位置。

项目适配器通过 `@1002bot/visualization/adapters/project` 导出，`resolveSourceStages` 负责把事实目录与阶段选择组装成适配器输入。旧报告适配器与 `tests/fixtures/legacy-reports.json` 保留用于旧数据；当前站点使用独立项目存储键。详细合同和迁移约定见 [数据说明](datasets/README.md)。

## Runtime 切片

[Runtime 数据说明](datasets/projects/runtime-evolution/README.md)记录两阶段的真实实体、职责区块、关系语义与来源。M1 Runtime 展开为职责卡片；M2 增加 InputChannel/InputRun 并保留旧 Event 入口。组件的 details 是卡片内职责，不创建子实体。具有独立实现边界的对象使用嵌套节点；Agent 实现通过 previousId 标记替换。

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

节点可选 `data.layoutEdits` 记录版本为 1 的布局编辑意图：`position` 使用父容器稳定内容原点的相对锚点，`sizes.collapsed/expanded` 分别保存尺寸偏好。`origin=user` 由实际拖动、键盘移动、尺寸调整或重新分组写入；自动坐标补偿和测量不写人工意图。父级移动携带后代，父级自动扩缩保持已有内容锚点。尺寸偏好作为容器最小边界，内容增长仍受扩容限额约束。

旧记录在工作副本中转换为 `origin=legacy`，表示来源未知；双方都改变的未知几何优先保留当前阶段草稿。旧尺寸偏好采用实际保存的 frame，扩容预算字段不作为最小尺寸。原确认快照及检查点不就地迁移。项目存储首次保存带编辑意图的草稿前，将原始 JSON 保留到原键加 `:before-layout-intent-v1` 的一次性备份键。

位置与约束按阶段和视图保存；切换直接恢复各自快照，不同步其他视图的展开状态。优先恢复已保存视口，首次打开未保存视口的视图时适应画布。拖动结束、标题提交及其他布局操作后保存，视口在移动结束时保存。

每阶段当前页面会话保留100步撤销/重做。一次拖动包含祖先扩缩和邻居避让；冻结、分组、标题提交和展开各占一步。阶段重新继承同时撤销布局和继承基准。快捷键为 Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z（另支持 Ctrl+Y），输入框使用原生编辑历史。

## 三份阶段视图

同一 Canonical Graph 在每个阶段保存三份独立工作视图：

- `Overview View`：架构节点全部收起。
- `Structure View`：首次展开一层真实组件，之后独立保存用户选择的展开集合。
- `Full View`：所有真实组件和职责末端全部展开。

视图选择器显示当前阶段及各视图确认状态。布局、节点约束、人工路径、冻结账本、视口、草稿、确认快照、继承基准和页面内撤销历史均按阶段与视图隔离。收展编辑在 Structure View 中进行；Overview 与 Full 的投影范围固定，隐藏收展按钮，双击不改变展开状态。已有快照切换直接恢复，无逐节点收展或父链贴合。

首次创建独立视图时，`view-projection.ts` 计算子至父的布局和尺寸。后续阶段分别以父阶段的同名确认快照应用语义增量和三方合并；三个候选均合法才一次写入目标阶段。冲突面板标明所属视图，失败时所有目标视图保持原状。历史确认和检查点保留，更新后的草稿通过 `requiresConfirmation` 等待重新确认。新增元素当前使用既有增量安置器；AI 安置服务尚未接入。

Canvas v2 增加 `viewMode` 与 `views[mode][stageId]`；项目 Workspace v1 增加 `activeView` 与 `stages[stageId].views[mode]`。旧 `baselines` 和阶段字段保留为活动视图兼容别名。旧单视图仅迁入 Structure，首次写回前保留原 JSON 到 `<key>:before-three-views-v1`。缺少其他视图的旧后续阶段从首阶段建立确认链，原有草稿与确认保留，并在页面提示。

## 阶段增量与冻结子图

Legacy 和 Group 只负责路径与线段几何；最终恢复路径统一交给 `label-layout.ts`，点列和端口保持不变。标签中心沿线放置，侧放时胶囊与所属线段的间距最多为 2 个世界坐标单位。节点、标题栏、边框及其他标签碰撞会排除候选；无合法位置直接隐藏，Hover 和选中不恢复非法位置。长文本缩略到 140px 预算，完整文字保留在线路 Tooltip 和连接面板。选中时弱化无关标签，聚焦和视口变化不求解线路。

路径变化时先按上次锚点与线段几何投影，保留仍然合法的位置。新候选评分至少改善 20 分才切换；线段数组下标不承担身份。自动位置按阶段、视图缓存，带语义身份、路径和策略指纹；失效缓存丢弃后重新求解，不参与人工编辑的三方合并或撤销比较。快照从同一已提交的节点、路径和标签帧捕获，拖动结束先完成父框贴合再保存。

连接面板支持固定当前标签与恢复自动位置。`labelPins` 按显示边、可见端点、完整 Canonical 成员及其真实端口指纹匹配，参与确认、撤销和阶段继承；真实端口变化会失效旧固定约束。固定位置冲突或远离所属线路时保留约束并隐藏显示。路径锁定与标签固定独立，历史路径附带的标签仅作为兼容缓存。历史工作区缺省为空，存储版本保持兼容。

工作视图 v2 把草稿和已确认快照分开保存。自动保存只更新草稿；工具栏的确认按钮写入 `confirmedAt` 与当前内容副本，后续阶段以该副本为基础。切换阶段前，来源阶段的三份视图都须有当前版本的确认快照。

首次进入目标阶段时，只对来源差异求解：共同叶节点沿用已确认世界坐标，容器保留 `worldPosition - fitOffset` 内容锚点。替换实体按 `previousId` 继承旧布局，归属改变的替换实体重新安置。新增节点优先填补空隙，再四向有限扩容。人工模式保留容器展开状态，隐藏新增节点继续使用声明的局部坐标；可见新增节点避开其他容器的完整范围。人工扩缩每轴余量为自然尺寸的 100% 且不超过 800px；自动阶段安置每轴预算为自然尺寸加 800px。成功后不抬高自然基准，已合法生成的既有尺寸可保持。

保存阶段同时记录生成它的父确认内容、目标来源图和生成基准。父确认与来源均未改变时直接恢复当前草稿；发生变化时重建传入内容，与当前草稿三方合并。人工编辑意图与约束先合并，再根据展开状态重算容器包围盒与扩容结果。互斥的人工修改、受保护对象移动和删除已编辑对象产生冲突。自动投影路径是可失效的几何缓存，人工路径及冻结账本独立保留。来源修订保留原确认内容，并通过 `confirmedRevision` 标识确认时版本；重新确认后才能作为新版本的后续阶段基础。旧目标缺少继承基准时提供显式、可撤销的重新继承操作。

阶段切换是原子事务：`Prepare → Diff → Place → Route → Validate → Commit`。校验失败时不修改源阶段、不写目标快照、不切换基线，只显示只读候选预览和结构化冲突。成功后目标阶段记一步撤销事务。

冻结组为单层，禁止嵌套和成员重叠。冻结时容器固定、全部后代锁定，按 Canonical ID 捕获所有内部连接，包括折叠隐藏的连接。内部点列与标签使用 owner 相对坐标；跨边界连接保留刚性内部段及真实边界端口，外部段单独求解。端口直接落在边框时，内部段可以只有一个坐标点。

整体拖动只改变组原点，内部坐标不变。折叠状态也预检隐藏端口的可行性，展开按已保存尺寸恢复。折叠后的路由将内部障碍压缩为完整保护框，点列仍保留在账本中。解冻恢复原约束与人工路径，并保留其他冻结组的边界保护；收展、拖动和解冻均可撤销。成员或锁定连接的来源删除、更改归属产生冲突。

路径状态为 `auto`、`pinned`、`locked`。`auto` 由算法自由计算；`pinned` 优先保留，失效时可局部重算；`locked` 逐点保留并阻止自动修改。路径按 Canonical Edge ID 保存，折叠聚合展示边不继承独立路径；展开且端点指纹匹配后恢复。标签的人工固定位置由独立的 `labelPins` 保存。

工作视图保存投影路径与障碍版本提示，恢复时直接复用仍可行的路径。改变节点、端口或障碍时只失效受影响几何；冻结时保留已经建立的交叉，后续改变障碍位置须重新校验。选择和视口导航不触发寻路。性能记录同时包含约束预检、自动路由及冻结外部段计算。

`CanvasWorkspaceView` 当前为 v2。v1 记录读取时自动迁移为草稿，原节点视图保留，路径和冻结组为空；确认必须由用户显式操作。

## 数据接口

每个 `VisualizationBaseline` 包含：

- `id`：基线选择标识，数组内唯一。
- `stage`：完整 `StageSnapshot`，其中 `graph` 使用稳定 node/edge ID、显式 `parentId` 与 canonical 端点。
- `previousStageId`：可选阶段父级；缺省时按数组前一项推导。
- `nodeChanges`、`edgeChanges`：按实体 ID 提供 `ChangeMark`，覆盖所有非根节点及关系。`replaced` 标记可带 `previousId`，增量布局据此继承旧实体位置。
- `positions`：可选初始坐标。根层节点是画布坐标；子节点是父容器局部坐标。默认模式缺省时使用有序网格。
- `layout`：人工模式指定 kind=manual 和每个节点的完整位置及尺寸，容器还指定 expandedSize。结构框的用户保存几何优先于初始值；普通收起卡片和详情卡片使用统一规格。
- `stage.presentation`：展示关系的展开条件、原始关系映射和细化关系。总览和细节按条件互斥。

`ChangeMark.kind` 为 `baseline`、`inherited`、`added` 或 `replaced`，`label` 是相应文字，`note` 可记录替换前后关系。界面仅显示新增、替换注释，分别使用绿色、琥珀色；其余关系保留名称。

接入数据先调用 `assertValidBaselines` 校验。React 组件也在输入边界执行校验，拒绝重复基线 ID、无效图、缺失标记或非法坐标。需要增量更新时，使用 Core `applyGraphPatch` 生成新的完整快照，再组装基线输入。

每次替换源数据应更新 `stage.graph.revision`。基线 ID 或 revision 变化会重建画布会话；相同 revision 下的父组件重渲染保留当前会话。卡片移动、分组和标题修改归属当前阶段的当前视图；切换保留各自几何、分组和展开集合。

真实数据适配器后续只负责生成上述合同，不在渲染组件内解析业务文件或绑定业务节点 ID。

## 交互基线

双击或点击展开按钮原位递归展开，跨层连线绑定可见端点。支持拖动、平移、缩放、直接关联链路高亮、Shift 框选、Ctrl/Cmd+G 分组、标题编辑和解散。

节点收起卡片统一为 240×80，两项以内的详情卡片统一为 462×192，其余详情卡片为 462×280；内部职责使用 210×80 信息卡、8px 间距，分别采用 1×2 或固定 2×2 分页。翻页只修改组件内部状态。人工拖动过程中，框内移动保持父框；越界时按需扩容。拖动结束和内容尺寸变化后自动贴合内容，收缩右侧与底部空白，保持父框原点及人工设置的最小尺寸。每轴额外空间最多为自然尺寸的 100% 且不超过 800 px，两侧共享总余量；连续拖动不抬高上限。近对齐时按 6 屏幕像素阈值吸附，连线和标签避开卡片及标题。

## 0.2 基线迁移

正式接口为 `VisualizationCanvas` 和 `VisualizationCanvasProps`，旧 `EvolutionCanvas`、store、scene/layout-provider 接口已移除。样式改为显式导入 `./styles.css`。唯一页面是 `/`；旧 HTML 入口、主题预览、生成数据工具与旧业务 adapter 已移除。

后续开发以 `src/` 的公共组件和合同为基础，新增业务适配器放在库外或独立 examples 中。

## Port policy

The original M0 overview uses `portPolicy: { "direction": "top-down" }`; the Runtime slice uses geometric direction (`auto`). Views without a direction preference use geometric endpoint direction. Candidate routing and snapshot compatibility are described in [the route model](src/react/model/README.md).

## Routing engine switch

The default remains the incremental candidate router. `?routing=group` enables the experimental offline group solver; omitting the parameter or using `?routing=legacy` keeps the old path. The group engine only takes over when the solution covers every expected edge and there are no stored pinned/locked paths, frozen groups, aggregated display edges or preview state. Any incomplete or illegal group transaction falls back to the last legal legacy routes, so no edge disappears.

The group solver keeps a group-level cache. Unchanged groups reuse their route objects; only dirty groups and groups sharing a node with a dirty group re-solve. Their previous paths remain reserved. The group engine stays active through drag and release; there is no release-time full solve. A complete group solution skips the legacy cache entirely, so group-mode `data-route-geometry-ms`, `data-route-routing-ms` and `data-route-label-ms` remain 0 and `data-route-ms` is the group time. Visible-route references update after React commits. When the group engine becomes ineligible, the committed group paths seed the legacy cache once so the engine switch preserves the current routes, including a cold legacy cache. Snapshots are captured from the visible node/route render, not solved again. The final label pass omits invalid capsules during hover and selection. Full text remains available through the path tooltip and connection panel. When group mode is requested but cannot take over, a bottom notice explains why; drag and preview fallbacks stay silent.

The playground exposes `?lab=routing`: a 36-node routing lab with 1,584 physical handles and a deliberately hidden label for hover/performance checks.

### Default engine policy (P5)

Legacy remains the default. Group promotion requires all of the following: 50/100/200-edge cold and local-update P95 at or below 16 ms; zero visible-label node/label overlaps and tight path attachment; labels may hide when no legal placement exists; crossings no worse than Legacy on fixed layouts; and passing rollback/failure-injection tests. The P5 benchmark currently fails these gates at 50+ edges for local latency, cross-group labels and crossings, so Group stays opt-in with `?routing=group`; Legacy remains available with `?routing=legacy`. See the P5 report for measurements and the decision.

统一卡片规格首次保存前，将完整原工作区备份到 <key>:before-uniform-cards-v1。尺寸迁移保留原确认和检查点，更新的工作副本需要重新确认；冻结或锁定几何发生冲突时显示原因。
