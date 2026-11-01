Owner: `packages/visualization/datasets/projects/1002bot/project.json`, `src/core/project/types.ts`, `src/core/project/resolve.ts`, `src/adapters/project/index.ts`, `src/react/model/project-workspace.ts`, `src/react/persistence/project-storage.ts`

# 项目架构数据

本项目由 `datasets/projects.json` 注册，清单路径相对注册表解析。当前加载首个快照：采用 M1 报告的六块简化总览，Event 调用方、Runtime、Agent、Provider、World、Session，共五条展示关系。原始关系保留 Session 的追加与读取两项事实。State、组合根和公共契约保留在事实目录中。

旧 M1.0–M6.0 数据集已迁至 `tests/fixtures/legacy-reports.json`，仅由旧报告适配器的测试读取，当前站点不加载。迁移前的逐字节副本保存在仓库根 `.scratch/visualization-backups/2026-11-01-before-project-model/`，不纳入版本控制。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `project.json` | 项目身份、版本和资源路径；路径相对本目录 |
| `source/catalog.json` | 组件、原始关系、契约及来源引用，无阶段和无坐标 |
| `stages/02b980d3.json` | 快照元数据与选择的事实 id；首个快照无 previousId |
| `views/overview.json` | 总览选择、层级、人工坐标、尺寸、端口与关系映射 |
| `workspace/initial.json` | 首次打开的工作视图种子；用户后续编辑独立保存 |

快照 `id` 为 `select` 与 `remove` 的 SHA-256 前 8 位；生成、校验与新建流程见 [数据集说明](../../README.md#快照-id)。`label` 与 `title` 是用户可改的显示名，文件名、视图的 `stageId` 与工作空间键使用 `id`。

`resolveSourceStages(catalogs, stages)` 把事实目录与快照选择组装为现有 `ProjectSourceStage` 合同；`adaptProject` 再生成基线。新增事实先写入 `source/catalog.json`，再由快照文件的 `select` 引用；移除用 `remove`。后续快照必须显式声明 `previousId`，且只能选择目录中已有的 id。未知 id、重复选择、同时选择与移除都会在加载时抛错。

新增卡片仍需 View 提供人工 `frame`；容器还需 `expandedSize`，内部坐标相对父容器。Views 每份快照提供一份完整展示定义。

展示关系 `sourceRelationIds` 指向原始关系。`refines` 指向被细化的总览关系；`visibility.expanded/collapsed` 明确切换条件，细节与其总览必须互斥。容器端口保存在 View 节点的 `ports` 中。未声明端口的展示边仍使用现有正交路由。

## 加载与持久化

`adaptProject(project)` 为无 IO 的纯适配器，输出现有 VisualizationBaseline 合同，并标记 `layout.kind=manual`。加载方负责解析注册表、清单、事实目录、阶段、视图和工作空间。Vite 将 JSON 发布为独立资源，业务事实不内联到应用脚本。

人工模式使用明确坐标：初始化不补网格；展开切换到保存或声明的尺寸；拖动只移动选中根；阶段新增使用目标 View 中的位置。重叠、越界或受保护路径冲突返回提示或保持原布局，不触发邻居重排和容器自动扩容。连线仍可自动路由或由用户固定／锁定。

项目工作空间使用独立项目 ID 和键。每阶段包含 overrides、containerStates、draft、confirmed 和 checkpoints，另保存视口及来源继承基准。draft 为当前内容权威；overrides 与 containerStates 是由内容派生并核验的一致性索引。确认快照和每个检查点保留各自独立的覆盖与容器状态。点击确认阶段生成检查点；自动保存只更新草稿。检查点目前由持久化合同保存，未增加历史列表或恢复按钮。

旧 `visualization:progress-reports:workspace` 不参与新项目读写。当前键为调用方提供的 `visualization:project:1002bot:workspace:v1`。不同项目误用同一键会报错并保留原记录。

本轮仅编排首个快照。后续快照将在此基线上逐项补充；旧阶段数据不自动导入新项目。
