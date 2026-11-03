Owner: `project.json`, `source/runtime.json`, `source/collaborators.json`, `source/contracts.json`, `stages/16d69bf0.json`, `stages/b7762c73.json`, `views/m1-runtime.json`, `views/m2-runtime.json`

# Runtime：M1 / M2

历史事实依据为 `docs/进度汇报/2026-10-04-M1.0进度与架构图.md` 与 `2026-10-05-M2.0进度与架构图.md`。报告已注明当前实现后来迁移到 M3；本项目表达报告当时的结构。原 `1002bot` M0 项目及其用户存储保留，注册表默认打开此切片。

M2 Console、InputChannel、InputRun、ConversationAgent 另附 `git:750bc45:<path>` 历史实现引用。该版本中 ConversationAgent 提供 Event 与 UserInput 两种请求入口，Runtime 的旧 Event 路径调用同一个注入 Agent。

## 文件与身份

- `source/runtime.json`：Event 调用方、Runtime、Console、InputChannel、InputRun 及它们的协作。
- `source/collaborators.json`：Agent、Provider、World、Session、具体实现、State 与组合根。
- `source/contracts.json`：共享契约，供组件和关系引用。
- `stages/`：M1 首次选择；M2 显式继承，增加输入链路并替换 Agent 实现。id 由 select/remove 内容生成。
- `views/`：每阶段完整展示定义、显隐条件、关系细化映射和人工坐标。

节点 ID 表示展示身份，componentId 指向事实身份。Stage 选择决定事实生效范围；View 的 parentId 表示展示包含。Agent、Provider、World、Session 展开为具体实现，其中实现关系使用 `implementation`，不是实例所有权。Runtime 对 InputChannel、InputRun 的拥有关系使用 `ownership`。

M1 视图有 11 个节点，M2 有 14 个。State、组合根和协议保留为来源事实，未加入当前执行视图。职责与函数不为展示而生成独立节点。

## 收展与关系

M1 Runtime 是一张可展开职责的卡片：生命周期、代次/租约、Event 循环、事实读写、停止屏障、trace 均属于 Runtime。展开不会生成 EventLoop、Barrier 等实体。

M2 Runtime 是包含 InputChannel 和 InputRun 的容器。两者可继续展开卡片内职责。旧 Event 仍直接进入 Runtime；Console 经 InputChannel FIFO 调度 InputRun。通道和执行器属于同一 Runtime 实例，不是独立进程。

`semantics=dependency` 表示总览语义依赖，使用虚线与“依赖”文字。`interaction` 表示实际组件交互。每条 View 关系的 sourceRelationIds 指向原始事实；refines 指向展开时被替换的总览关系。只有收起 Runtime 时显示 Session→Agent 的历史依赖；展开后，历史由 Session→Runtime/InputRun，再经调用参数交给 Agent。

InputRun 读取 Session 历史事实；ConversationAgent 选择完整成功轮次。InputRun 追加过程事实，InputChannel 提交最终记录。旧 Event 的协作边用 Event 前缀区分。相同端点的存储读写合为一条有明确双向标记的展示边，原始读取和追加事实分别保留。调用、事件输出和存储不会因端点相同而混成同一种事实。

稳定总览关系跨阶段沿用；M2 新输入细节关系标新增，ConversationAgent 标替换 TestAgent。沿用不加文字徽标。

## 几何与工作空间

所有节点初始坐标、收起尺寸、展开尺寸均在 View 中声明；子节点使用父容器局部坐标。M1 Runtime 的职责卡片在 M2 获得独立子实体时，继承原点并采用目标容器的声明尺寸作为扩容基准；同阶段恢复继续使用用户尺寸。新增 Console 作为顶层组件寻找 Runtime 外的空位，InputChannel 与 InputRun 只在 Runtime 已展开时显示。展开职责、拖动子卡片会在限额内贴合父链，回收多余边界；已有内容的世界位置和无关组件位置保持稳定。

使用 `runtime-evolution` 独立存储键。M1 布局经明确确认后才能进入 M2；使用右上角快照对话框的“所属阶段”切换。展开、位置和视口沿用现有 Workspace。新项目不读取或覆盖原 `1002bot` 工作空间。

默认 Legacy 路由；本切片用于核对真实结构与交互，不调整引擎权重、搜索预算或性能门禁。
