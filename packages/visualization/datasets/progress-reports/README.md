Owner: `packages/visualization/src/core/project/types.ts`, `src/adapters/project/index.ts`, `src/react/model/project-workspace.ts`, `src/react/persistence/project-storage.ts`

# 项目架构数据

当前站点从 `project.json` 加载 M0。M0 采用 M1 报告的六块简化总览：Event 调用方、Runtime、Agent、Provider、World、Session，共五条展示关系。原始关系保留 Session 的追加与读取两项事实。State、组合根和公共契约保留在 Source 中。

`architecture.json` 为保留的旧 M1.0–M6.0 数据集，旧报告适配器继续支持读取。当前站点不再加载它。迁移前逐字节备份在 `backups/2026-11-01-before-project-model/`，SHA-256 记录在该目录的 manifest.json。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `project.json` | 项目身份、版本和资源路径 |
| `source/stages/M0.json` | 组件、原始关系、契约及报告来源，无坐标 |
| `views/M0.json` | 总览选择、层级、人工坐标、尺寸、端口与关系映射 |
| `workspace/initial.json` | 首次打开的工作视图种子；用户后续编辑独立保存 |

后续 Source 阶段使用显式 previousId 和 upsert/remove 增量。Views 每阶段提供一份完整展示定义；新增事实不自动变成卡片，新增卡片必须提供人工 frame。容器还需 expandedSize，内部坐标相对父容器。

展示关系 sourceRelationIds 指向原始关系。refines 指向被细化的总览关系；visibility.expanded/collapsed 明确切换条件，细节与其总览必须互斥。容器端口保存在 View 节点的 ports 中。未声明端口的展示边仍使用现有正交路由。

## 加载与持久化

`adaptProject(project)` 为无 IO 的纯适配器，输出现有 VisualizationBaseline 合同，并标记 layout.kind=manual。加载方负责解析 manifest、读取分离文件和装配工作空间。Vite 将 JSON 发布为独立资源，业务事实不内联到应用脚本。

人工模式使用明确坐标：初始化不补网格；展开切换到保存或声明的尺寸；拖动只移动选中根；阶段新增使用目标 View 中的位置。重叠、越界或受保护路径冲突返回提示或保持原布局，不触发邻居重排和容器自动扩容。连线仍可自动路由或由用户固定／锁定。

项目工作空间使用独立项目 ID 和键。每阶段包含 overrides、containerStates、draft、confirmed 和 checkpoints，另保存视口及来源继承基准。draft 为当前内容权威；overrides 与 containerStates 是由内容派生并核验的一致性索引。确认快照和每个检查点保留各自独立的覆盖与容器状态。点击确认阶段生成检查点；自动保存只更新草稿。检查点目前由持久化合同保存，未增加历史列表或恢复按钮。

旧 `visualization:progress-reports:workspace` 不参与新项目读写。当前键为调用方提供的 `visualization:project:runtime-architecture:workspace:v1`。不同项目误用同一键会报错并保留原记录。

本轮仅编排 M0。M1 及后续细节将在此基线上逐项补充；旧阶段数据不自动导入新项目。
