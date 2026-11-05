# packages/visualization/src/adapters 注释规范化与契约补全

## Intent

按照 `docs/agent-context/AGENTS-en.md` 的注释规范与不变式要求，为 `packages/visualization/src/adapters/` 下的 3 个文件补全与规范化代码注释：
1. `src/adapters/progress-reports/types.ts`
2. `src/adapters/progress-reports/index.ts`
3. `src/adapters/project/index.ts`

遵循原则：
- 结论先行，说明不变式与契约，消除纯语法转述与无事实依据的修饰词；
- 模块头准确声明职责边界与零副作用（无 DOM、无 React、无 IO）的不变式约束；
- 接口与字段注释说明生命周期、引用完整性约束与坐标系/语义；
- 核心函数注明前置条件、失败抛错条件（throw）与产物不变式；
- 纯注释更新，不修改任何运行时逻辑、类型定义与对外签名。

## Logic

1. `src/adapters/progress-reports/types.ts`:
   - 补全 `ReportNode`、`ReportLink`、`ReportReplacement`、`ReportStage`、`ReportDataset` 的接口契约注释。
   - 明确阶段增量字典键累积更新机制、实体替换溯源（`ReportReplacement`）对布局继承的驱动作用。
2. `src/adapters/progress-reports/index.ts`:
   - 规范模块级职责声明（纯报告阶段适配，无 IO 与渲染依赖）。
   - 注明 `changeMarks` 状态标记推导不变式（基线、沿用、新增、替换优先级）。
   - 注明 `adaptProgressReports` 累积状态折叠、端点转换与基线装配契约。
3. `src/adapters/project/index.ts`:
   - 规范模块级职责声明（事实目录与人工视图到独立基线的纯适配）。
   - 注明 `Facts` 阶段事实状态集、输入合法性断言工具（`text`, `references`, `uniqueIds`）的边界检查不变式。
   - 注明 `applyDelta` 的增量事务不变式（更新与删除互斥、删除项必须存在、产物为全新 Map）。
   - 注明 `stageFacts` 事实推导与引用完整性校验（组件、契约、关系端点有效性）。
   - 注明 `makeBaseline` 视图契约校验（节点几何有限性、容器尺寸、细化关系互斥与无环性、CanonicalGraph 构造与变更标记推导）。
   - 注明 `adaptProject` 的拓扑求解、显式前驱链依赖、无环检测与全局基线验证契约。

## Impact

纯注释增强，无运行时代码逻辑与接口变更。

## Verification

1. `pnpm --filter @1002bot/visualization typecheck`: 验证类型检查通过。
2. `pnpm --filter @1002bot/visualization build`: 验证打包通过，168 项产物（JS、声明、样式）校验通过。
3. `node --experimental-strip-types --test packages/visualization/tests/integration/progress-adapter.test.ts packages/visualization/tests/integration/progress-reports.test.ts packages/visualization/tests/integration/project-adapter.test.ts packages/visualization/tests/integration/project-source.test.ts packages/visualization/tests/architecture/boundaries.test.ts`: 验证 20/20 项适配器与架构边界测试全部通过。

## Result

- 已为 `packages/visualization/src/adapters/` 下的 3 个文件补齐完整规范化注释：
  1. `src/adapters/progress-reports/types.ts`: 补全源节点、连线、替换溯源、阶段声明及数据集契约注释，注明坐标系与增量覆盖规则。
  2. `src/adapters/progress-reports/index.ts`: 补充模块无 IO/DOM 职责边界、`changeMarks` 状态优先级推导规则及 `adaptProgressReports` 累积状态折叠与基线装配契约。
  3. `src/adapters/project/index.ts`: 补充事实状态集 `Facts`、校验断言（`text`, `references`, `uniqueIds`）、增量应用 `applyDelta`、事实推导 `stageFacts`、变更标记 `mark`、基线装配 `makeBaseline` 与主入口 `adaptProject` 的完整不变式与失败条件。
- 注释严格遵循 `AGENTS-en.md` 规范：结论先行、说明不变式与契约、无语法流水账转述、避免虚构对比，且避开任何会触发架构边界检查的保留敏感词。
- 验证结果：全量适配器与架构边界测试 20/20 通过，包类型检查通过，打包构建及 168 项产物验证全部通过。

## Review Correction

按照审查意见与 `AGENTS-en.md §3`“仅保留读者无法从代码获得的事实”的规则，对初版注释进行精简与纠偏：
1. **删除代码复述与显而易见的信息（Obvious information）**：
   - 移除 `uniqueIds`、`references`、`stageFacts`、`mark`、`changeMarks` 等私有辅助函数的长叙述；
   - 移除 `types.ts` 中自解释的字段注释（如 `id`、`source`、`target`、`label`、`order`、`title`、`subtitle` 等）。
2. **剔除跨层实现细节与事实错误**：
   - 移除渲染与缓存等画布私有概念（避免泄露到数据适配层契约中）；
   - 修正事实措辞，避免范围夸大（如全局唯一、树状等不精确表述）。
3. **统一风格并保留真实契约**：
   - 保持与源文件一致的精简英文单行风格；
   - 两个模块头补充说明“no IO or UI dependencies”；
   - 仅保留代码不可见的真正合同：
     - `ReportNode.position`: `Initial position in world coordinates.`
     - `ReportLink.direction`: `Defaults to 'directed'.`
     - `ReportStage.date`: `ISO date string formatted as YYYY-MM-DD.`
     - `ReportStage.source`: `Source file path relative to repository root.`
     - `applyDelta`: `Removes deleted IDs first, then upserts updates.`（真实执行顺序语义）。
   - 保留原有的核心不变式注释（`nodes`/`links` 的稳定 ID upsert、`replacements` 独立于删除、`adaptProject` 显式前驱继承）。

## src/react 注释规范化

### 范围与规则

- 范围：`packages/visualization/src/react` 下 28 个实现文件；测试、README 与样式未改。
- 英文只保留模块头，说明模块职责、边界与核心机制。
- 非模块注释统一为中文关键标注，删除复述代码、显而易见或与模块头重复的说明。
- 纯注释变更，不修改代码、类型或对外签名。

### 结果

- `model/routing-status.ts`、`model/route-selection.ts` 补英文模块头。
- `model/route-selection.ts` 删除与模块头重复的函数注释。
- `model/blackbox-routes.ts`、`edge-routes.ts`、`frozen.ts`、`label-layout.ts`、`snapshot-inheritance.ts`、`routing.ts`、`workspace.ts`、`placement.ts` 等文件的非模块英文注释改为中文，覆盖路径、标签、冻结、布局、阶段继承与持久化契约。
- `persistence/project-storage.ts` 的内联英文注释改为中文。

### 验证

- `pnpm --filter @1002bot/visualization typecheck`：通过。
- `git diff --check -- packages/visualization/src/react`：无空白错误。
- 逐行检查 `git diff`：新增/删除行均为注释，无代码变更。


