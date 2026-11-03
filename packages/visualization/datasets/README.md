Owner: `datasets/projects.json`, `playground/src/baselines.ts`, `src/core/project/types.ts`, `src/core/project/resolve.ts`

# 数据集

`projects.json` 是项目注册表：`defaultProjectId` 指定当前加载的项目，`projects[].manifest` 指向项目清单。清单路径相对注册表文件解析；项目内的 `source`、`stages`、`views`、`workspace` 路径相对清单文件解析。

```text
datasets/
├── projects.json
└── projects/
    └── <project-id>/
        ├── project.json
        ├── source/
        ├── stages/
        ├── views/
        └── workspace/
```

每个项目的目录职责：

- `source/`：累积的实体事实（组件、关系、契约），不含阶段、不含坐标。
- `stages/`：快照选择。文件名为短哈希；首个快照不写 `previousId`，后续快照显式声明并列出新增或移除的实体 id。`label` 与 `title` 是用户可改的显示名。
- `views/`：展示定义，每份快照可有多份。
- `workspace/`：可选的首次打开种子；用户编辑保存在浏览器，不写回仓库。

`resolveSourceStages` 把事实目录与阶段选择组装为 `ProjectSourceStage`，`adaptProject` 再生成基线。注册表、事实目录、阶段与视图只读；用户在画布中的修改属于工作空间。

当前登记 `1002bot`（原 M0）与 `runtime-evolution`（M1/M2 Runtime 切片），默认打开后者。后续项目在注册表登记清单即可加载；项目选择界面尚未实现。切片结构与来源见 [Runtime 数据说明](projects/runtime-evolution/README.md)。

## 快照 id

快照 `id` 是其 `select` 与 `remove` 的 SHA-256 前 8 位。`label` 与 `title` 是用户可改的显示名；文件名、视图的 `stageId`、工作空间键与 revision 使用 `id`。数组顺序属于选择内容，调整顺序会改变 `id`。

```sh
# 打印 id
node --experimental-strip-types tools/snapshot-id.ts datasets/projects/1002bot/stages/02b980d3.json

# 校验所有项目的文件名与 id
pnpm check:snapshots

# 写入 id 并按 id 重命名文件
node --experimental-strip-types tools/snapshot-id.ts --write <stage.json>
```

新建快照：

1. 复制上一份快照文件，修改 `select`/`remove`，填写 `label`/`title`；非首个快照写 `previousId`。
2. 运行 `--write`，文件重命名为 `<id>.json`。
3. 在 `project.json` 的 `stages` 登记路径，在 `views/` 增加或更新视图并把 `stageId` 设为新 id。
4. 更新 `workspace/initial.json`（或让它按新快照重新生成），源数据变化时同步提升 `project.revision`。
5. 运行 `pnpm check:snapshots` 与 `pnpm test`。

## 阶段工作视图

同一阶段的 Canonical Graph 共享实体和关系，工作空间按 `stages[stageId].views.overview/structure/full` 分别保存布局、展开集合、人工路径、冻结状态、草稿、确认快照和历史检查点。项目的 View JSON 继续提供初始语义与几何；三个工作视图由画布首次生成，此后的修改保存到浏览器。后续阶段从父阶段的同名确认快照继承；三份候选全部合法后一次保存。旧工作区迁入 structure，首次写回前备份原文。
