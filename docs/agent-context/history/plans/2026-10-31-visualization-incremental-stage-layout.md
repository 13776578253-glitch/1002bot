# 增量阶段布局、冻结子图与受约束路由

Scope: 将 `packages/visualization` 从“切换阶段时恢复目标视图或重建整张图”改为“阶段快照 + 差异增量 + 冻结子图 + 用户覆盖层 + 局部受约束路由”。已确认的几何成为下一阶段的不可变基础；算法只处理新增、删除、归属变化和未冻结的自由区域。本轮不引入全局布局求解器、ELK、Worker、多人协同或权威数据回写。

Design stance: 已确认的节点位置、容器尺寸、手动分组、冻结范围和人工路径是事实，不是待优化变量。冻结同时保护节点与路径。用户编辑通过覆盖层表达，Canonical Graph 保持来源完整。自动路由只在不违反硬约束的自由区域求解。

## 现状与差距

| 能力 | 现有实现 | 差距 |
| --- | --- | --- |
| 阶段视图 | `CanvasWorkspaceView` v1 按基线保存 `CanvasNodeView[]` 和视口，包含 `layoutMode`、展开、容器尺寸、`fitOffset`、`reflowOrigin`、`expansionSizes`、`groupOrigins`、分组标题 | 不保存路径、冻结组、覆盖层、已确认状态；版本需升级 |
| 阶段切换 | `selectBaseline` 保存当前视口，`switchBaseline` 使用目标阶段已保存布局或 `makeNodes` 新布局，`syncHierarchyExpansion` 同步共同节点展开 | 没有阶段差异、没有增量安置、没有原子失败；首次进入目标阶段仍是全量初始布局 |
| 稳定 ID 恢复 | `restoreNodeViews` 已按稳定 ID 合并来源修订，保留合法手动分组，重定位世界坐标，删除空组 | 不合并路径、冻结组、覆盖层；没有替换来源 `previousId`；分组循环直接抛错，需转为结构化冲突 |
| 节点约束 | `free` / `fixed` / `locked`，`layoutProtectionConflict` 保护固定与锁定节点，`fitMovedContainers` 处理容器扩缩 | 没有“整片冻结”语义；展开冻结容器仍会重算尺寸和推开同级；没有冻结组边界端口和成员账本 |
| 路径 | `DiagramRouteCache` 按端点、障碍、文本增量失效，路径和标签缓存，折叠连接在展示层聚合 | 路径只存在于会话；没有 `auto` / `pinned` / `locked`；没有把已有路径作为后续布线障碍；展开状态变化会改变显示边身份 |
| 端口 | `CanonicalPort` 已存在；`Ports` 固定渲染四侧手柄；路由按相对中心选择出入侧 | 数据适配器输出的 `ports: []`；没有端口代价、拥堵感知或冻结边界端口 |
| 用户编辑 | 无；Canonical Graph 只读；手动分组只是显示层容器 | 没有覆盖层、重连、自定义节点/连线、隐藏来源实体或原始/编辑关系切换 |
| 路由质量 | A* 代价为距离 + 固定拐弯惩罚 30；逐边独立寻路 | 没有交叉、重叠、稳定性代价；没有局部多边协同；已有路径不参与空间占用 |

可复用基础：`restoreNodeViews` 的稳定 ID 合并、`layoutProtectionConflict` 的自动编辑保护、`fitMovedContainers` 的容器扩缩、`toggleHierarchy` 的展开/收起、`DiagramRouteCache` 的增量失效、`SpatialIndex`、`adaptProgressReports` 的累计阶段与变化标记。

## 设计

### 1. 来源、差异与阶段快照

来源阶段继续使用 `VisualizationBaseline`。新增两项可选合同：

```ts
interface StageDiff {
  fromStageId?: string;
  nodes: {
    added: string[];
    removed: string[];
    reparented: { id: string; from: string | null; to: string | null }[];
    replaced: { from: string; to: string; note?: string }[];
    updated: string[];
  };
  edges: {
    added: string[];
    removed: string[];
    replaced: { from: string; to: string; note?: string }[];
    updated: string[];
  };
}

interface VisualizationBaseline {
  // 现有字段
  previousStageId?: string; // 显式阶段父级；缺省取数组前一项
  diff?: StageDiff;         // 无则用 diffStages 计算
}
```

`adaptProgressReports` 已掌握 `ReportReplacement.previousId`，但当前 `ChangeMark` 只保留 `note`。适配器应把替换来源写入 `StageDiff.nodes.replaced` / `edges.replaced`；展示层 `ChangeMark` 不改语义。`core/graph/diff.ts` 提供 `diffStages(previous, next)`，按稳定 ID 比较节点、父级、连线端点和元数据。差异是语义事实，不因布局操作变化。

阶段布局结果升级为 `CanvasWorkspaceView` v2：

```ts
interface CanvasBaselineViewV2 {
  revision: string;
  confirmedAt?: string;          // 已确认快照；缺省视为工作草稿
  nodes: CanvasNodeView[];
  edgeRoutes: EdgeRouteSnapshot[];
  frozenGroups: FrozenGroupSnapshot[];
  overlay?: UserGraphOverlay;
  viewport?: CanvasViewport;
  transition?: StageTransitionRecord;
}

interface CanvasWorkspaceViewV2 {
  version: 2;
  baselineId: string;
  baselines: Record<string, CanvasBaselineViewV2>;
}
```

`StageTransitionRecord` 只记录无法从结果推导的增量信息：来源阶段、目标修订、安置方式、扩容次数、冲突解决动作、成功/失败原因。它不重复保存完整节点或路径。

v1 → v2 迁移：缺失字段补空数组/空对象，`version` 改为 2，原节点视图不变。存储适配器同时接受 v1 与 v2；写入统一 v2。只持久化 `pinned` / `locked` 路径，`auto` 路径每次重建，避免陈旧路径和体积膨胀。

### 2. 阶段切换流水线

新增纯函数模块 `src/react/model/stage-transition.ts`：

```ts
type StageTransitionResult =
  | { ok: true; nodes: CanvasNode[]; routes: EdgeRouteSnapshot[]; frozen: FrozenGroupSnapshot[]; overlay?: UserGraphOverlay; record: StageTransitionRecord }
  | { ok: false; conflicts: StageConflict[]; candidate?: StageTransitionCandidate };

interface StageConflict {
  kind: 'no-space' | 'frozen-violation' | 'locked-route' | 'growth-ceiling' | 'invalid-source' | 'merge-conflict';
  entityIds: string[];
  containerId?: string;
  message: string;
  actions: ('unfreeze' | 'expand' | 'move-free-nodes' | 'cancel' | 'retry')[];
}
```

流水线固定为 `Prepare → Diff → Place → Route → Validate → Commit`：

1. **Prepare**：确定目标快照。目标阶段已有同修订已确认快照时直接恢复；目标修订变化时以保存快照参与三方合并；首次进入时以父阶段已确认快照为基础。`VisualizationCanvas` 继续用 `revision` 重建会话，恢复逻辑扩展为 v2。
2. **Diff**：用 `diffStages` 计算新增、删除、重归属、替换和更新。删除节点级联删除后代与挂接连线；重归属节点重算局部坐标以保持世界位置；替换节点仅在 `previousId` 明确时继承原布局。
3. **Place**：为新增节点寻找空隙，必要时有限扩容或移动自由节点。冻结节点、锁定节点、冻结路径和已确认阶段几何是硬约束。
4. **Route**：复用未变化的 `auto` 路径；恢复 `pinned` / `locked` 路径；只对新增边、端点是新增节点的边、失效的 `auto` 边和冻结组外部段重新寻路。
5. **Validate**：校验图结构、节点不重叠、容器扩容不超过上限、冻结成员世界坐标不变、锁定路径逐点不变、所有新增节点已安置、路径不穿过障碍。任何校验失败都返回结构化冲突，不产生半完成状态。
6. **Commit**：只有成功结果才写入目标阶段快照、切换 `baselineId`、记录一次目标阶段事务并保存。失败时源阶段节点、路径、视口和 `baselineId` 全部保持不变。

`planStageTransition` 不调用 React，不写存储；控制器只负责调用、提交和展示冲突。`restoreNodeViews` 内部的循环检查异常应在流水线边界转为 `merge-conflict`，不能中断整个画布。

### 3. 空隙填充与有限扩容

新增 `src/react/model/placement.ts`，输入目标画布节点、目标阶段投影、新增节点集合、冻结组、路径障碍和上限参数。按深度父级优先处理新增容器，再处理其子节点。

候选位置按确定性顺序生成：

1. 与新增节点直接关联的既有节点四侧，保持最小间距。
2. 目标父容器内部可用网格；跳过冻结组、锁定节点、已有路径通道和标题栏。
3. 以关联节点质心为中心的扩展环，用于根层节点。
4. 父容器允许扩容时，尝试右/下优先的有限扩容，复用 `fitMovedContainers` 和 `separateSiblings`；扩容受 `containerGrowthCeiling` 限制。
5. 仍无位置时，尝试移动附近 `free` 节点让出空隙；不移动 `fixed` / `locked` / 冻结成员。
6. 全部失败返回 `no-space` 或 `growth-ceiling` 冲突，附带需要处理的容器和新增节点。

评分依次考虑：硬约束是否满足、对冻结/锁定对象的扰动、与关联节点的距离、是否触发扩容、对齐质量、确定性 ID 顺序。新增节点在当前阶段已保存过位置时优先恢复；只有来源修订变化且实体仍存在时才重新安置。

新增节点位于折叠容器内时，只自动展开通往新增节点的最小祖先路径；不改变其他分支的展开状态。展开只增加可见性，冻结容器使用只读展开路径，不触发尺寸重算。

### 4. 冻结子图

冻结组不新增第三套坐标体系，复用现有容器：

- Canonical 容器：容器节点标 `data.frozen = true`，容器本身 `layoutMode = 'fixed'`，可整体拖动；全部后代 `layoutMode = 'locked'`，禁止直接移动和编辑。
- 任意多选：复用 `groupSelection` 生成 `cluster`，同样标记冻结；移动 cluster 时子节点随动。
- 内部边自动进入 `locked`；跨边界边默认 `pinned`，内部段与边界端口受保护，外部段可重算。
- `frozenGroups` 只保存成员账本、根节点、边界端口和创建时的世界包围盒；节点坐标仍由现有父子局部坐标维护。

冻结组的“查看”和“编辑”分开：

- 查看：允许展开显示内部节点和路径，使用只读展开函数，不调用 `resize` / `separateSiblings`，内部几何不变。
- 编辑：显式解冻后进入普通布局，解冻是一次可撤销事务；冻结组内部节点重新参与自动避让。
- 移除成员或成员被来源删除时，不静默收缩冻结组；返回 `merge-conflict`，由用户选择解冻或保留空组。

移动冻结组时：

- 完全位于组内的节点和锁定路径随组平移。
- 跨边界路径保留内部段和边界端口，外部段重新路由；暂时无法拆分时降级为 `pinned` 并提示。
- 与冻结组无关的路径保持不变，但校验新位置是否与这些路径相交；相交时优先调整新增元素，无法调整则阻止提交。

### 5. 路径状态与坐标空间

```ts
type EdgeRouteState = 'auto' | 'pinned' | 'locked';

interface EdgeRouteSnapshot {
  canonicalEdgeId: string;
  state: EdgeRouteState;
  source: { nodeId: string; portId?: string; handle?: string };
  target: { nodeId: string; portId?: string; handle?: string };
  points: Point[];
  space: { kind: 'world' } | { kind: 'owner'; ownerId: string };
  endpointFingerprint: string;
  label?: EdgeLabelPlacement;
}
```

路径身份使用 `canonicalEdgeId`，不使用折叠聚合后的 `DisplayEdge.id`。`DisplayEdge` 只在非聚合、两端可见且端点指纹匹配时应用保存路径；聚合展示边保持 `auto`。被折叠隐藏的锁定路径保留，展开后重新应用。

坐标空间优先使用最深冻结所有者；没有冻结所有者时使用世界坐标。所有者移动时直接平移；端点移动、端口变化或父级变化导致指纹不匹配时，状态转为待确认，不静默套用旧路径。

`auto` 路径可被路由算法修改；`pinned` 默认保留，仅在新增障碍使其失效时请求有限局部修正；`locked` 路径逐点不可变，并作为后续布线的硬障碍。路径标签与路径一起保存；锁定路径的标签位置冻结，`pinned` 路径允许标签重新放置。

### 6. 用户覆盖层

新增 `src/react/model/overlay.ts`，覆盖层与 Canonical Graph 分离：

```ts
interface UserGraphOverlay {
  version: 1;
  addedNodes: CanonicalNode[];
  addedEdges: CanonicalEdge[];
  hiddenSourceNodeIds: string[];
  hiddenSourceEdgeIds: string[];
  edgeOverrides: {
    id: string;
    source?: CanonicalEndpoint;
    target?: CanonicalEndpoint;
    label?: string;
    relation?: CanonicalEdge['relation'];
    direction?: CanonicalEdge['direction'];
    note?: string;
  }[];
}
```

- 自定义 ID 使用 `user-node:` / `user-edge:` 前缀，避免与来源冲突。
- `composeStageSnapshot(baseline.stage, overlay)` 在投影前合成展示图；Canonical Graph 不变。
- 隐藏节点默认连同后代隐藏；隐藏边或隐藏节点导致悬空边时级联隐藏。用户显式重连或新增边后可恢复连接。
- 覆盖层变更标记复用现有 `added` / `replaced` / `inherited`：自定义实体为 `added`，修改来源关系为 `replaced` 并带说明。是否新增独立 `overridden` 视觉类型留待讨论。
- 提供“显示原始关系”开关：关闭覆盖层后显示纯来源图；切换不修改覆盖层数据。
- P2 只支持当前阶段覆盖层。跨阶段继承作为显式操作，使用来源 ID、覆盖层版本和目标阶段快照做三方合并；不能在切换阶段时自动扩散。
- 重连优先使用 React Flow 的 `onReconnect`；自定义 `Link` 需要渲染重连锚点或提供等价面板。端点变化、端口变化和路径冻结都作为显式编辑事务，重新校验合法性。

### 7. 统一代价、自动端口与局部协同路由

在 `routeDiagramGeometry` 与 `DiagramRouteCache` 之上增加 `src/react/model/route-cost.ts`：

- 代价项：路径长度、拐点数、与既有/冻结路径的交叉、共线重叠、与障碍的最小间距、对旧路径的扰动、端口方向偏好。
- 硬约束：`locked` 路径、冻结组边界端口、不可穿越节点；`pinned` 路径是强偏好而非硬障碍。
- 自动端口：对自由边尝试 4×4 出入侧组合，按方向和局部拥堵评分；锁定/固定端口不参与评分。Canonical `ports` 暂不强制启用。
- 局部多边：新增边和受影响的自由边组成一个局部集合，按优先级逐条寻路，再用有界迭代重路由降低交叉与重叠；每轮只接受代价下降且不改变冻结结果的方案。
- 迭代上限和候选数量显式配置为模型常量；达不到上限时返回当前最优结果并记录未解决冲突。算法先把约束可行性检查完，再进入搜索，避免搜索到卡顿才失败。

## 实施顺序、分工与优先级

主代理负责合同、流水线、控制器集成、最终审查和浏览器验收。子代理只改各自文件边界，不并发修改 `workspace.ts`、`use-canvas-controller.ts` 或 `VisualizationCanvas.tsx`。

| 阶段 | 主责 | 文件边界 | 交付与验收 |
| --- | --- | --- | --- |
| P0a 合同与差异 | 主代理 + 子代理 A | `core/schema/baseline.ts`、`core/schema/types.ts`、新增 `core/graph/diff.ts`、`adapters/progress-reports`、`tests/core.test.ts` | `diffStages` 覆盖新增/删除/重归属/替换/更新；适配器保留 `previousId`；单元测试通过 |
| P0b 快照 v2 与迁移 | 子代理 B | `react/model/workspace.ts`、`persistence/local-storage.ts`、`persistence/storage-session.ts`、`tests/integration/workspace.test.ts`、`storage-session.test.ts` | v1 可读、v2 写入；节点、视口、冻结占位、路径占位、覆盖层占位往返一致；旧记录不丢 |
| P0c 增量安置 | 子代理 C | 新增 `react/model/placement.ts`、`placement` 单元测试 | 新增节点优先填空隙、有限扩容、自由节点让位；无解返回结构化冲突；冻结/锁定对象零位移 |
| P0d 原子阶段切换 | 主代理 | 新增 `react/model/stage-transition.ts`、`canvas/use-workspace-session.ts`、`canvas/use-canvas-controller.ts`、冲突面板组件 | 首次 M1→M2 只安置新增；失败完全回滚；刷新恢复；切换只产生一次目标阶段事务 |
| P1a 冻结组模型 | 子代理 D | 新增 `react/model/frozen.ts`、`hierarchy.ts`、`constraints.ts`、冻结测试 | 冻结子树/多选组；整体移动、只读展开、解冻编辑；成员世界坐标零漂移 |
| P1b 路径持久化与边界 | 子代理 D + 主代理 | 新增 `react/model/edge-routes.ts`、`route-cache.ts`、`workspace.ts` 集成、路径测试 | `auto`/`pinned`/`locked` 往返；锁定路径逐点不变；内部段平移、外部段重算；冻结路径参与障碍 |
| P1c 冻结交互 | 主代理 | `SelectionTools`、`CanvasControls`、`nodes.tsx`、`VisualizationCanvas.tsx` | 冻结/解冻、路径状态标记、锁定路径提示、刷新恢复；浏览器验收 |
| P2a 覆盖层模型 | 子代理 E | 新增 `react/model/overlay.ts`、`display-edges.ts` 集成、覆盖层测试 | 新增/删除/隐藏/重连/覆盖元数据；投影前合成；Canonical Graph 不变 |
| P2b 覆盖层交互 | 主代理 + 子代理 E | 节点/连线检查器、重连锚点、工具栏、`VisualizationCanvas.tsx` | 自定义节点/连线、重连、冻结路径、撤销、刷新恢复；原始关系开关 |
| P3 端口与代价 | 子代理 F | `react/model/routing.ts`、`route-cache.ts`、新增 `route-cost.ts`、路由测试 | 自动端口、交叉/重叠/扰动代价；固定测试图指标改善；冻结路径零漂移 |
| P4 局部协同路由 | 子代理 F | `route-cost.ts`、`route-cache.ts`、集成测试 | 新增/自由边局部协同；有界迭代；冻结与锁定结果不变 |
| 验收与指标 | 子代理 G | `.scratch/` 浏览器脚本、`playground` 数据属性、验收记录 | M1→M2、冻结移动、路径继承、覆盖层编辑、M6 几何指标；截图与错误日志 |

优先级与依赖：

1. **P0 必须先完成**。没有阶段快照、差异和原子切换，P1/P2 的冻结与覆盖层无法稳定继承。
2. **P1 紧随 P0**。它直接兑现“黑盒”价值，也是后续人工编辑的保护基础。
3. **P2 在 P1 之后**。人工编辑是算法上限的兜底，但必须先有可冻结的路径和阶段快照。
4. **P3/P4 最后**。算法质量只在冻结和人工编辑之后处理剩余自由区域；P4 依赖 P3 的代价函数。
5. P0a 与 P0b 可并行；P1a 与 P1b 可并行；P2a 可在 P1b 合同稳定后并行；P3 可在 P1b 后独立开发，不阻塞 P0/P1。

## 验收与指标

新增以下指标并在固定 M6 测试图上记录：

- **布局保留率** = 切换后保持原位的既有对象数 / 切换前需要保留的既有对象数。冻结节点、锁定路径和已确认容器目标为 100%。
- **自由对象位移**：移动数量、总位移、路径变化段数。
- **阶段切换成功率**：成功提交数 / 尝试数；失败按 `no-space`、`growth-ceiling`、`frozen-violation`、`locked-route`、`merge-conflict` 分类。
- **新增节点安置方式**：直接空隙、容器扩容、自由节点让位、失败。
- **路由质量**：路径长度、拐点数、交叉数、共线重叠长度、对旧路径的扰动总量、寻路耗时。
- **持久化**：视图体积、v1→v2 迁移成功率、保存/读取失败恢复。
- **浏览器性能**：沿用 `data-route-ms`、`data-route-count`、`data-route-total` 与 `data-drag-profile`，增加阶段切换耗时和回滚标记。

验收场景：

1. M1→M2 首次进入只安置新增节点；既有节点、冻结组、锁定路径逐值不变；刷新后一致。
2. 目标阶段已有快照时直接恢复；来源修订变化时按稳定 ID 合并，删除实体移除、重归属保持世界位置、新节点重新安置。
3. 新增节点空间不足时阻止阶段切换，源阶段完全不变，冲突面板给出容器、节点和可执行动作。
4. 冻结 Runtime 整体移动：内部节点和锁定路径整体平移，外部路径重算，无关路径不变。
5. 冻结容器只读展开不改变内部几何；解冻后可编辑并可撤销。
6. 覆盖层新增、隐藏、重连、冻结路径、撤销、刷新恢复；关闭覆盖层显示原始关系。
7. P3/P4 指标在固定测试图上可比较；冻结与锁定对象在优化前后零漂移。

## 非目标

- 不实现全局重新布局、ELK、Worker 或自动架构推导。
- 不把用户覆盖层写回权威报告数据；发布/提交流程另行设计。
- 不支持多人协同、命名视图、导入导出、圈画注释或跨阶段自动扩散覆盖层。
- 不强制启用 Canonical `ports`；P1 只冻结边界端口，P3 再做自由边端口评分。
- 不改变现有 `VisualizationCanvas` 的只读来源合同；新增能力通过可选字段和显式操作提供。

## 已确认决策

1. **已确认快照**：显式确认；自动保存仅作为草稿。`confirmedAt` 只由确认操作写入；阶段切换以父阶段已确认快照为基础，草稿不参与继承。
2. **冻结组嵌套**：首版单层，禁止交叉重叠。冻结组按 Canonical 子树或单层多选创建；成员集合不得重叠，嵌套留到后续。
3. **路径身份**：使用 Canonical Edge ID。路径按 canonical edge 保存；折叠聚合展示边保持自动，展开后按端点指纹恢复。
4. **跨边界路径**：首版 `pinned`，后续支持分段锁定。内部边可 `locked`；跨边界边保存内部段和边界端口，外部段允许重算。
5. **切换失败策略**：原子阻止，提供只读候选预览。失败时不修改源阶段、不写目标快照、不切换 baseline；候选布局只读展示并可取消。
6. **折叠容器中新节点**：仅展开必要祖先，保护其余展开状态。必要祖先展开计入阶段切换事务；冻结容器只读展开。
7. **覆盖层作用域**：首版当前阶段，后续显式继承。P2 不自动扩散；跨阶段继承使用显式三方合并操作。
8. **人工变更标记**：区分来源变更与用户覆盖。来源 `ChangeMark` 保持；用户覆盖使用独立 overlay 标识和视觉，不混入来源 `ChangeKind`。
9. **阶段撤销**：导航不进入栈，增量提交作为单事务。源阶段快照不变；目标阶段候选布局记一步。
10. **端口模型**：首版虚拟端口，后续开放编辑。P1 使用冻结组边界端口和现有四侧手柄；P3 再做自由边自动端口，P4 再讨论显式端口编辑。
11. **Locked 路径标签**：默认冻结，同时支持显式手动调整。锁定路径保存标签位置；显式编辑作为独立事务。
12. **性能边界**：同步计算、有界候选、耗时监测。阶段切换同步完成；候选数量、搜索轮次和扩容次数有上限；记录耗时和失败原因，暂不引入 Worker。

## 记录与验证

- 实施前在 `docs/agent-context/current-task/` 新增任务记录，写明意图、影响和验证方法；实施后追加更新，不覆盖历史。
- 本计划完成后原文归档到 `docs/agent-context/history/plans/`，任务记录中登记归档位置和校验值。
- 包级验证：`pnpm --filter @1002bot/visualization test`、`typecheck`、`build`、`build:web`、`check:dist`。
- 仓库提交前：`pnpm test`、`pnpm run typecheck`；浏览器代码另外运行 `pnpm --filter @1002bot/visualization typecheck:web`。
- 浏览器验收使用 `pnpm dev` 的 `127.0.0.1:5199` 和报告数据；不启动真实 bot。验收记录截图、几何数值、错误日志和阶段切换指标。
