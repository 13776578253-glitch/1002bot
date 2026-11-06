# visualization/react/model 深度架构审查与轻量级二级目录聚合规划

## 一、概述与核心结论

针对 `packages/visualization/src/react/model` 目录（40 个 TypeScript 源文件，共 6,302 行），通过 AST 依赖图解析、421 个自动化测试全覆盖验证以及运行时调用链路追踪，核心审查结论如下：

1. **核心问题并非单纯文件行数，而是状态多源改写与拓扑有环**：存在 4 条真实运行时值循环依赖，导致模块加载对初始化顺序敏感；画布几何与布局意图在运行时、持久化、缓存与快照之间存在多份异构表示。
2. **多代实现并存与技术债累积**：标签系统“三代同堂”；路由双引擎各自演化且存在逐行 100% 复制的代码拷贝；休眠未启用的 `UserGraphOverlay` 长期侵入核心快照与三向合并类型。
3. **架构红线与落地约束**：[tests/architecture/boundaries.test.ts:16](file:///d:/Desktop/code/bot/1002bot/packages/visualization/tests/architecture/boundaries.test.ts#L16) 明确断言禁止在 `src/` 下引入 `legacy/` 路径，因此**绝对不能建立 `labels/legacy/` 目录**。在原生 ES 模块机制下，重构必须遵循“**先就地提取纯函数切断循环依赖，再进行二级目录物理归位**”的安全时序。

---

## 二、前次探索（DeepSeek）复核与关键纠偏

| 审查维度 | DeepSeek 报告结论 | 实际代码实测证据 | 纠偏与修正见解 |
| :--- | :--- | :--- | :--- |
| **架构测试红线（关键误区）** | 建议建立 `src/react/model/labels/legacy/` 存放旧标签代码 | `tests/architecture/boundaries.test.ts:16` 明确断言：`assert.doesNotMatch(text, /(?:from\s*\|import\s*)['"][^'"]*(?:examples\|datasets\|playground\|proposal\|legacy)[\/]/)` | **致命红线**：`src/` 下任何包含 `legacy/` 路径的 import 会直接导致 CI 架构测试红条！不能建立 `legacy/` 目录，兼容代码应命名为 `compat-*.ts` 或直接在测试中收拢。 |
| **实施时序逻辑缺陷** | 建议“Phase 0 先纯移动文件、保留循环依赖；Phase 1 再断环” | 在原生 ES 模块机制（Node `--experimental-strip-types` / Vite）下，跨目录循环依赖极易引发 TDZ（暂时性死区），如 `CARD_SIZE` 在未初始化时跨目录引用即抛出 `ReferenceError`。 | **实施顺序必须修正**：严禁出现“跨目录循环依赖”的中间状态，必须“先原地提取关键纯函数断环（或在移动时原子化断环），再完成目录归位”。 |
| **代码规模统计微幅滞后** | “40 个实现文件，约 5.8k 行；15 个文件 > 150 行，7 个文件 > 270 行” | 全目录 40 个 `.ts` 文件，**共 6,302 行**（不含测试与 README）；**17 个文件 > 150 行，9 个文件 > 270 行**。 | 代码在近期演进中已增长近 500 行，`route-groups.ts` 现为 490 行，`label-layout.ts` 现为 457 行。 |
| **死代码识别偏差** | 声称 `removeLabelPin` 是“测试专用” | `removeLabelPin`（`label-pins.ts:33`）仅被测试引用，但同文件的 `removeLabelPinForEdge`（`label-pins.ts:37`）在 `use-canvas-controller.ts:424` 被生产代码直接调用。 | 区分“函数级未使用”与“模块级废弃”，切不可将 `label-pins.ts` 整体视为废弃代码。全库彻底 0 调用的死函数为：`edgeHandles`（`hierarchy.ts:134`）、`emptyOverlay`（`overlay.ts:24`）、`labelCandidatesForRoute`（`label-candidates.ts:29`）。 |
| **聚合方案的“轻量”本质** | 提议将 40 个文件拆散重命名为 45+ 个全新文件名（如 `geometry.ts`、`route-state.ts` 等） | 本目录承载了 18 个测试、4 个 Canvas Hook、7 个 UI 组件和公共导出。 | 彻底重命名并过度碎化会破坏 Git 历史追溯（Blame）并造成大范围震荡。轻量级聚合应保持既有核心文件名稳定，仅做归类建组与必要断环抽取。 |

---

## 三、具体复杂度位置与代码证据

代码规模排名前 10 的文件合计 3,465 行，占整个 model 代码量的 55%：

```
1. route-groups.ts          490 行 (组路由求解器/事务仲裁)
2. label-layout.ts           457 行 (第 3 代标签放置/空间索引/1步级联)
3. placement.ts              395 行 (新增节点安置/双层重试修复/浮动偏置)
4. blackbox-routes.ts        373 行 (冻结子图框生成/边界端口/21处.find)
5. grouping.ts               353 行 (XYFlow节点基类/坐标转换/兄弟避让/20处.find)
6. group-route-cache.ts      344 行 (组级增量缓存/脏标记管理)
7. snapshot-inheritance.ts   331 行 (三向合并/局部坐标补偿/拓扑防环)
8. workspace.ts              293 行 (视图持久化快照/撤销栈/节点恢复)
9. stage-transition.ts       291 行 (阶段切换编排/冲突检测)
10. edge-routes.ts           265 行 (规范路径账本/冻结边界接入)
```

### 1. route-groups.ts（490 行）
- **`planMode`（L242-L325，84 行）**：协调 4 种分组布线模式（`fork`、`trunk`、`mixed`、`lanes`）。包含目标边界几何排序、车道分配比例计算、主干合并以及端口分配失败时的即时回滚。
- **`solveRouteGroups`（L327-L465，139 行）**：维护物理端口事务状态（`allocator.begin()` / `commit()` / `rollback()`），执行固定边 Physical Slot 锁定，独立时间片分配，以及多模式打分优选。在 L444 被迫对已剥离的标签字段填充哑数据：`labelRequired: false, labelCandidates: [], labelState: 'normal'`。

### 2. label-layout.ts（457 行）
- **`LabelLayoutCache.update`（L319-L450，132 行）**：
  - 对障碍物与连线集合进行全量 JSON 签名哈希计算（L323–L330）。
  - 构建 `SpatialIndex` 空间几何索引。
  - **1 步级联重分配算法**（L412–L436）：当候选标签被已有标签占据时，寻找单一未固定阻挡标签并为其寻找替代槽位，产生级联位置调整。
  - 不可变 Fork/Adopt 机制（L304–L317），避免 React 并发渲染时被丢弃的渲染帧污染主缓存。

### 3. placement.ts（395 行）
- **`placeAddedNodes`（L224-L318，95 行）**：
  - **双层修复重试循环**（L244 与 L272）：`for (let repairAuto = 0; repairAuto < 2 && !fitted; repairAuto++)`，配合 6 个方向浮动偏置（`{x:0, y:0}`, `{x:-0.5, y:0}`, `{x:-1, y:0}` 等）。
  - **静默破坏式降级**：在第二轮重试时（L288、L292），算法将 `reservedPaths` 强行置空，**直接丢弃已保留的路径避让保护**以强行换取节点安置成功，极端场景下可能导致路径穿心。

### 4. blackbox-routes.ts（373 行）
- **`captureFrozenSubgraph`（L245-L323，79 行）**：冻结子图框生成，内含 21 处 `.find()` 线性遍历，内外边分类与物理框架物化。
- **`resolveFrozenBoundaryRoute`（L123-L202，80 行）**：边界端口跨越计算、出端口方向延展（L175–L181）、正交路径回退与连接器穿透校验。

### 5. snapshot-inheritance.ts（331 行）
- **`mergeNodes`（L194-L258，65 行）**：Base、Local、Incoming 三向合并。在同一个循环体内同时处理世界坐标系换算、父容器偏移补偿（`localShift` / `incomingShift`）、用户显式意图覆盖、固定节点冲突检测以及拓扑排序无环检查。

### 6. 启发式二分与迭代回退热点
- `constraints.ts:168-179`：容器扩容超限时执行 **20 步二分查找最大安全位移比例**。
- `manual-layout.ts:128-133`：人工移动冲突时同样执行 **18 步二分插值回退**。
- `normalize-card-layout.ts:61-93`：执行最多 `Math.max(24, input.length * 8)` 轮迭代。每轮迭代重新计算容器贴合、全图投影以及成对碰撞检测与 16px 推动位移。

### 7. 循环中的高频 `.find()` 线性扫描
整个模型层存在大量在遍历中反复通过 ID 进行全数组线性扫描的代码：
- `blackbox-routes.ts`：**21 处** `.find(`
- `grouping.ts`：**20 处** `.find(`
- `edge-routes.ts`：**12 处** `.find(`
- `constraints.ts`：**11 处** `.find(`
- `stage-transition.ts`：**10 处** `.find(`

---

## 四、核心逻辑与运行时链路

`src/react/model/` 由 React Hook 驱动，作为纯函数计算库与弱状态渲染缓存容器运行：

1. **视图初始化与基线准备** (`use-workspace-session.ts:90`)：
   `baselines` $\rightarrow$ `baselineForView(item, mode)` $\rightarrow$ `baselineNodes(baseline)` $\rightarrow$ `CanvasNode[]`。
2. **工作区恢复与卡片规格归一化** (`use-workspace-session.ts:111-120`)：
   `savedNodes` $\rightarrow$ `restoreNodeViews`（坐标系逆变换、展开态同步、补全数据） $\rightarrow$ `restoreFrozenGroups` $\rightarrow$ `normalizeCardLayout`（卡片尺寸迁移检测，冲突则回退原几何） $\rightarrow$ `validateStoredRoutes`。
3. **场景渲染与边投影计算** (`use-canvas-scene.ts` / `use-canvas-controller.ts`)：
   `CanvasNode[]` + `StageSnapshot` $\rightarrow$ `hierarchyProjection`（计算 `projectGraph`） $\rightarrow$ `aggregateProjectedEdges`（折叠聚合边 `DisplayEdge[]`）。
4. **路由求解引擎仲裁** (`use-canvas-scene.ts:67-101`)：
   - **准入判定**：`engine === 'group' && !readOnly && !storedRoutes.length && !frozenGroups.length && !displayEdges.some(e => e.aggregated)`。
   - **分支 A（Group 接管）**：`GroupRouteCache.update` $\rightarrow$ `solveRouteGroups` $\rightarrow$ `planMode` $\rightarrow$ `allocateEdgePortsAtomic` $\rightarrow$ 完整成功解 (`groupComplete === true`) 接管本次渲染。
   - **分支 B（Legacy 回退）**：准入不满足或组解不完整时，以 `lastVisibleRoutes` 播种降级，`DiagramRouteCache.update` $\rightarrow$ `createDiagramGeometry` $\rightarrow$ `routeDiagramGeometry` $\rightarrow$ `applyStoredRoutes`。
   - **仲裁输出**：`selectCanvasRoutes` 保证输出稳定的 `routes` 与引擎标识。
5. **标签独立求解管线** (`use-canvas-scene.ts:103-115`)：
   `routes` + `displayEdges` $\rightarrow$ `labelCache.fork()` $\rightarrow$ `LabelLayoutCache.update` $\rightarrow$ `segmentsOf` $\rightarrow$ `projectAttachment` $\rightarrow$ `generateCandidates` $\rightarrow$ 1 步级联重分配 $\rightarrow$ `adopt` 提交草稿 $\rightarrow$ 覆盖输出 `snapshotLabels`。
6. **快照捕获与持久化同步** (`use-canvas-controller.ts:43-44, 203`)：
   提交更新 $\rightarrow$ `captureNodeViews` / `captureDisplayRoutes` / `captureLabelledRoutes` $\rightarrow$ `CanvasWorkspaceView` $\rightarrow$ `LocalStorage` / `ProjectStorage`。

---

## 五、耦合与边界模糊问题实证

### 1. 4 条真实运行时循环依赖（有向环分析）

```
【环 1】(2 节点环)
grouping.ts (L5: import { fitMovedContainers } from './spacing.ts')
    ↑ ↓
spacing.ts (L2: import { CARD_SIZE, restoreSiblings, separateSiblings, structureHeaderHeight } from './grouping.ts')
           (L5: export { MIN_EDGE_GAP } from './grouping.ts')

【环 2】(2 节点环)
hierarchy.ts (L4: import { solveHierarchyExpansion } from './placement.ts')
    ↑ ↓
placement.ts (L6: import { hierarchyProjection, nodeIsVisible } from './hierarchy.ts')

【环 3】(3 节点环)
hierarchy.ts (L4: import { solveHierarchyExpansion } from './placement.ts')
    ↑                                                            ↓
frozen.ts (L4: import { toggleHierarchy } from './hierarchy.ts') ← placement.ts (L7: import { toggleFrozenExpansion } from './frozen.ts')

【环 4】(2 节点环)
edge-routes.ts (L11: import { boundaryWorldPoints, resolveFrozenBoundaryRoute } from './blackbox-routes.ts')
    ↑ ↓
blackbox-routes.ts (L8: import { endpointFingerprint, routeSnapshotForEdge, storedRouteAttached, worldRoutePoints, reservedLockedRoutes } from './edge-routes.ts')
```

### 2. 领域模型与持久化/渲染的边界不清

1. **渲染事件回调污染领域节点**：
   `CanvasNode`（`grouping.ts:10-33`）继承自 `@xyflow/react` 的 `Node`，在 `node.data` 中挂载了 `onToggle`、`onRename`、`onRenameCommit` 回调，迫使 `captureNodeViews` 逐字段剥离函数，`restoreNodeViews` 又需与基线混编组装。
2. **持久化合同倒置寄生于 model 目录**：
   `CanvasViewStorage` 存储接口定义在 `workspace.ts:164` 中；`project-workspace.ts` 负责具体的项目存储序列化形状转换；外部 `persistence/` 模块反向依赖 `model/workspace.ts`。
3. **UI/产品展示常量混在模型层**：
   卡片标准尺寸 `CARD_SIZE`、职责卡尺寸 `RESPONSIBILITY_CARD_SIZE`、标题栏高度 `structureHeaderHeight`、吸附距离 `SNAP_SCREEN_DISTANCE` 等强前端渲染参数，全部与核心图几何模型同处一室。

### 3. 同一状态的多份异构表示

| 状态维度 | 运行时表示 | 持久化/快照表示 | 派生/缓存表示 | 潜在漂移风险 |
| :--- | :--- | :--- | :--- | :--- |
| **节点几何** | `CanvasNode` (`position`, `width`, `height`, `style`) | `CanvasNodeView` (`position`, `width`, `height`, `data.fitOffset`, `data.expansionSizes`) | `baseline.positions` | 展开收起时 `style` 与 `data.contentWidth` 出现双重记录 |
| **分组归属** | `CanvasNode.parentId` | `CanvasNodeView.parentId` | `data.groupOrigins` (原属恢复账本) | 解组或跨层移动时若未同步两份账本将导致孤儿节点 |
| **连线路径** | `CachedRoute` (含 `feasible`, `points`, `sourceHandle`, `targetHandle`) | `EdgeRouteSnapshot` (`space`, `points`, `state`, `frozenBoundaries`) | `DisplayRouteSnapshot` (含 UI 渲染专用标签与控制柄) | 路由计算完成后在多份快照间进行字段复制与擦除 |
| **标签位置** | `LabelLayoutResult` (`placement`, `score`, `state`) | `EdgeLabelPin` (人工固定点) | `DisplayRouteSnapshot` 标签字段 / `CachedRoute.label` (哑字段) | 历史代码仍向 `CachedRoute.label` 写入 `{width:0, height:0}` 占位 |
| **冻结子图** | `CanvasNode.data.frozen: true` | `FrozenGroupSnapshot` (`worldBounds`, `protectedFrame`, `boundaryPorts`) | `frozenFrames` 尺寸字典 | 节点自身标记与外部 Ledger 存在一致性校验开销 |

---

## 六、“补丁加补丁”式非模块化更新实证

### 1. 标签系统的“三代同堂”
- **第 1 代（遗留算法）**：`labels.ts:59` `placeEdgeLabel`。单路径避让启发式计算，生产已完全不用，仅供单元测试引用。
- **第 2 代（未落地过渡算法）**：`label-candidates.ts:29` `labelCandidatesForRoute`（**全库彻底 0 引用**）与 `label-coordinator.ts:22` `coordinateLabels`（仅供测试引用）。
- **第 3 代（现役算法）**：`label-layout.ts:319` `LabelLayoutCache`。支持空间索引、不可变草稿 Fork/Adopt、1 步级联重分配。
- **技术债表征**：三代候选常量冲突（第一代余量 8px/12px，第二代 `CLEARANCE = 8`, `BEND_CLEARANCE = 12`，第三代 `LABEL_CLEARANCE = 8`, `BEND_CLEARANCE = 12`, `SWITCH_IMPROVEMENT = 20`）。旧代码未被删除，反而在路由层留下了 `labelFallback`、`labelCandidates: []` 等大量僵尸字段。

### 2. 路由双引擎与几何逻辑代码拷贝
- **完全相同的线段重叠算法**：
  `routing.ts:129-137` 的 `overlapLength` 与 `route-quality.ts:79-87` 的 `overlap` 存在**逐行 100% 复制的代码拷贝**。
- **出入端口选择规则三处重复**：
  `hierarchy.ts:134-141`（`edgeHandles`，全库 0 引用）、`routing.ts:119-127`（`preferredHandles`）与 `route-groups.ts:142-146`（`sideOf`）三处完全基于相同的 `Math.abs(dx) > Math.abs(dy) * 1.15` 几何宽高比阈值判断。
- **双缓存并行演化**：
  `DiagramRouteCache`（`route-cache.ts:50`）与 `GroupRouteCache`（`group-route-cache.ts:121`）各自维护一套脏标记集、几何签名、时间统计与合并逻辑。

### 3. 休眠未启用特性侵入核心状态（`UserGraphOverlay`）
`overlay.ts:1-2` 源码明确标注：
> `Unenabled: no controller or UI currently creates an overlay; persistence compatibility only.`

但 `UserGraphOverlay` 却渗透进了 `CanvasBaselineContent` 快照类型、`comparableCanvasIntent` 意图比较、`mergeStageContent` 阶段三向合并、`project-workspace.ts:7` 项目存储转换以及 `workspace-schema.ts:13` 校验中。无实际 UI 产生该数据，却让每个快照合并与校验分支平添一层防御性逻辑。

---

## 七、轻量级二级目录聚合规划方案

### 1. 架构原则
1. **严格遵从 CI 架构红线**：严禁创建名为 `legacy/` 的任何目录（遵从 `boundaries.test.ts:16` 约束），旧版兼容文件平级命名为 `compat-*.ts`。
2. **保持文件名与符号稳定**：反对过度碎化与重命名，保留 40 个核心文件的身份，仅在断环必须之处提取最小纯函数。
3. **分层单向依赖原则**：
   $$\text{kernel} \longleftarrow \text{layout} \longleftarrow \text{routing} \longleftarrow \text{labels} \longleftarrow \text{freeze} \longleftarrow \text{stages} \longleftarrow \text{workspace}$$

### 2. 规划目标目录结构（1 Kernel + 6 Functional Domains）

```
src/react/model/
├── kernel/                  # 基础图元、尺寸与空间常量（纯领域模型，零依赖同层其他目录）
│   ├── types.ts             # CanvasNode, LayoutMode, CARD_SIZE, detailCardSize, worldPosition
│   ├── spatial-index.ts     # SpatialIndex (纯几何空间索引)
│   ├── guides.ts            # 对齐辅助线计算
│   └── change.ts            # 变更标记 ChangeMark 展示规则
│
├── layout/                  # 容器嵌套、层级树展开、节点安置与拖拽约束
│   ├── visibility.ts        # 【断环新建】提取 hierarchyProjection, nodeIsVisible
│   ├── hierarchy.ts         # baselineNodes, createHierarchyNodes, toggleHierarchy, syncHierarchyExpansion
│   ├── placement.ts         # placeAddedNodes, placeAuthoredAdditions, solveHierarchyExpansion
│   ├── constraints.ts       # constrainNodeMoves (吸附对齐/碰撞检测/20步二分回退)
│   ├── manual-layout.ts     # moveAlignedAuthoredNodes, fitAuthoredLayout, manualGeometryConflict
│   ├── spacing.ts           # fitMovedContainers, containerInset, containerGrowthCeiling
│   ├── grouping.ts          # groupSelection, ungroup, selectionRoots, normalizeMarqueeSelection
│   ├── siblings.ts          # 【断环新建】提取 separateSiblings, restoreSiblings
│   ├── layout-intent.ts     # NodeLayoutEdits, parentContentPosition, preferredEditedSize
│   └── normalize-card-layout.ts # 卡片规格迁移与碰撞推动算法
│
├── routing/                 # 正交布线几何计算、双引擎求解与质量度量
│   ├── routing.ts           # createDiagramGeometry, routeDiagramGeometry, pathIsClear, overlapLength
│   ├── route-cache.ts       # DiagramRouteCache (Legacy 缓存引擎)
│   ├── route-groups.ts      # solveRouteGroups, planMode, allocateEdgePortsAtomic (Group 离线求解器)
│   ├── group-route-cache.ts # GroupRouteCache (Group 增量缓存引擎)
│   ├── route-selection.ts   # selectCanvasRoutes (引擎仲裁)
│   ├── route-quality.ts     # 路径综合质量评分 (复用 overlap)
│   ├── routing-status.ts    # 降级原因判定 deriveRoutingFallbackNotice
│   ├── display-edges.ts     # aggregateProjectedEdges, DisplayEdge 聚合边计算
│   ├── display-route-snapshots.ts # DisplayRouteSnapshot 操作辅助
│   ├── edge-routes.ts       # retainedCanonicalRoutes, applyStoredRoutes, endpointFingerprint
│   └── cross-group-quality.ts # 跨组交叉质量诊断 (测试与 benchmark 专用)
│
├── labels/                  # 标签测量、定位布局与引脚持久化
│   ├── label-layout.ts      # LabelLayoutCache (第 3 代生产级标签放置引擎)
│   ├── labels.ts            # measureLabel, labelIsVisible, fallbackLabel (基础度量)
│   ├── label-pins.ts        # labelPinForEdge, pinLabelForEdge, removeLabelPinForEdge
│   ├── label-snapshots.ts   # captureLabelledRoutes, seedLabelLayout
│   ├── compat-candidates.ts # 【合规命名】旧版候选计算 (原 label-candidates.ts)
│   └── compat-coordinator.ts# 【合规命名】旧版全局协调 (原 label-coordinator.ts)
│
├── freeze/                  # 冻结子图框物化、黑盒穿越与边界计算
│   ├── frozen-boundary.ts   # 【断环新建】提取 boundaryWorldPoints, resolveFrozenBoundaryRoute
│   ├── frozen-expansion.ts  # 【断环新建】提取 toggleFrozenExpansion (解耦与 freezeSelection)
│   ├── frozen.ts            # freezeSelection, unfreezeGroup, restoreFrozenGroups
│   ├── frozen-growth.ts     # 冻结框自动扩容
│   └── blackbox-routes.ts   # captureFrozenSubgraph, releaseFrozenSubgraph
│
├── stages/                  # 阶段差异对比、三向合并与阶段切换编排
│   ├── stage-types.ts       # StageConflict 及交互动作枚举
│   ├── stage-transition.ts  # planStageTransition 阶段切换计划
│   ├── stage-navigation.ts  # navigateStageWithMerge 阶段导航编排
│   ├── snapshot-inheritance.ts # mergeStageContent, mergeNodes 三向合并核心
│   └── view-projection.ts   # seedViewProjection 视图初始投影
│
└── workspace/               # 工作区序列化快照、撤销重做栈与存储适配器
    ├── workspace.ts         # CanvasWorkspaceView, captureNodeViews, restoreNodeViews, ViewHistory
    ├── confirmation.ts      # comparableCanvasIntent, draftMatchesConfirmed
    ├── project-workspace.ts # canvasWorkspaceToProject, projectWorkspaceToCanvas
    └── overlay.ts           # UserGraphOverlay (休眠兼容模型)
```

### 3. 必须先期完成的 4 个外科手术式断环拆分

这 4 个拆分仅为**纯函数提取与 import 路径重定向**，100% 保持原有算法逻辑与外部行为不变：

1. **解耦 grouping ↔ spacing**：
   - 将 `grouping.ts` 中的 `separateSiblings`（L118）与 `restoreSiblings`（L161）提取至 `layout/siblings.ts`。
   - `spacing.ts` 仅导入 `kernel/types.ts` 与 `layout/siblings.ts`，不再逆向导入 `grouping.ts`。
2. **解耦 hierarchy ↔ placement**：
   - 将 `hierarchy.ts` 中的 `hierarchyProjection`（L65）与 `nodeIsVisible`（L70）提取至 `layout/visibility.ts`。
   - `placement.ts` 仅导入 `layout/visibility.ts`，彻底切断对 `hierarchy.ts` 的逆向依赖。
3. **解耦 placement $\rightarrow$ frozen $\rightarrow$ hierarchy $\rightarrow$ placement 三角环**：
   - 将 `frozen.ts` 中的 `toggleFrozenExpansion`（L135）提取至 `freeze/frozen-expansion.ts`。
   - `placement.ts` 仅导入 `freeze/frozen-expansion.ts`，不再引入包含 `toggleHierarchy`（`hierarchy.ts:88`）调用的 `frozen.ts`。
4. **解耦 edge-routes ↔ blackbox-routes**：
   - 将 `blackbox-routes.ts` 中的 `boundaryWorldPoints`（L112）与 `resolveFrozenBoundaryRoute`（L123）提取至 `freeze/frozen-boundary.ts`。
   - `edge-routes.ts` 仅导入 `freeze/frozen-boundary.ts`，不再依赖 `blackbox-routes.ts`。

---

## 八、落地四阶段路线图与后续优先级

- **Phase 1（原子断环与合规性准备）**：
  - 在当前目录下就地提取 `visibility.ts`、`siblings.ts`、`frozen-boundary.ts`、`frozen-expansion.ts`，消除 4 条运行时值循环依赖。
  - 将 `label-candidates.ts` 与 `label-coordinator.ts` 重命名为 `compat-candidates.ts` 与 `compat-coordinator.ts`，确保绝不触发 `boundaries.test.ts:16` 架构红线。
  - 执行 `npm test` 确保 421 个测试保持全绿。
- **Phase 2（二级目录归位）**：
  - 创建 `kernel/`, `layout/`, `routing/`, `labels/`, `freeze/`, `stages/`, `workspace/` 7 个子目录。
  - 将文件按规划移入各子目录，更新模块内相对引用路径。
  - 暂时在 `src/react/model/` 根层保留兼容性转发出口（Re-export），确保全仓其他模块不受破坏。
- **Phase 3（上游引用路径重定向）**：
  - 更新 `src/react/canvas/*`、`src/react/components/*`、`src/react/persistence/*` 以及 `src/react/index.ts` 中的引用路径。
  - 更新 `tests/` 与 `tools/` 中的直接内部测试引用。
  - 移除根层的兼容转发文件，执行全量类型检查 `tsc -b` 与自动化测试。
- **Phase 4（技术债收敛与死代码移除）**：
  - 彻底删除 3 个零调用的死函数：`edgeHandles`（`hierarchy.ts:134`）、`emptyOverlay`（`overlay.ts:24`）、`labelCandidatesForRoute`（`label-candidates.ts:29`）。
  - 合并 `routing.ts` 与 `route-quality.ts` 中完全重叠的 `overlap` 算法。
  - 剥离 `route-groups.ts` 与 `route-cache.ts` 中的废弃标签字段，统一归口至 `LabelLayoutCache`。
