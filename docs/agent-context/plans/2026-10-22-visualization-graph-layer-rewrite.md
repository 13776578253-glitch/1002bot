Owner: packages/visualization/src/core/schema、graph、projection、layout、engine 与 src/react/canvas

# Visualization 五层图模型重构计划

Time: 2026-10-22

## 目标

重写以下完整链路：

```
Canonical Graph → Projection → Layout Engine → React Flow Adapter → Canvas Renderer
```

重构的主目标是让“节点身份、父子关系、端口、边、坐标和渲染节点”使用同一套稳定契约。当前代码以嵌套 `children` 加路径字符串承载图结构，布局和 React Flow 再从路径反推父子关系；这会把路径变化、折叠投影、嵌套坐标和渲染 id 混在一起。新实现使用扁平规范图、稳定 ID 和显式引用，路径只作为派生显示信息。

范围包含通用 Core、1002bot adapter、React Flow 适配器和 Canvas Renderer。主题颜色、阶段文案和业务数据内容不作为第一阶段目标。

## 当前基线与需要推倒的部分

- `GraphNode.children` 同时承担树存储、父子关系和可视化层次；`GraphEdge.from/to` 使用路径字符串，路径由 key 拼接而成。
- `indexGraph` 的 `byKey` 在重复 key 时会覆盖，边端点解析、父节点推断和稳定身份没有统一边界。
- `projectGraph` 以 expanded path 为状态，折叠后会丢失具体端口，投影边主要依赖端点字符串去重。
- `elk.ts` 只收到可见路径和 expanded 标记，父子关系仍由路径切分推导；路由结果按数组下标与边绑定，缺少稳定 edge id 和端口锚点契约。
- `CanvasModel`、`FlowNodeData` 没有完整传递 `GraphNode.ports`；Card/Aggregate 虽然读取 `data.ports`，实际自定义 Handle 不会生成。
- `projectionToFlow` 收到路由点后没有写入 edge data，公开适配器会退回默认 smooth-step 路径。
- `EvolutionCanvas` 仍混合 Core 计算、React Flow 状态和 Inspector 渲染；`ArchitectureBoard` 与 Canvas 的职责重叠。
- 当前 28 项 node:test 和直接 TypeScript 检查通过，说明现有测试覆盖当前实现的内部假设，不能作为新契约的验收替代。

## 新的规范数据模型

### 1. Canonical Graph

将递归树改为扁平、不可变、可校验的图：

```ts
type GraphNodeId = string;
type GraphEdgeId = string;
type GraphPortId = string;

interface CanonicalPort {
  id: GraphPortId;
  label?: string;
  direction: 'in' | 'out' | 'bidirectional';
  side: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  order: number;
  role?: string;
}

interface CanonicalNode {
  id: GraphNodeId;                 // 跨阶段稳定；不由 parent/path 生成
  parentId: GraphNodeId | null;    // 显式父引用，根节点 parentId 为 null
  kind: 'root' | 'group' | 'component' | 'actor' | 'store' | 'adapter' | 'planned';
  label: string;
  summary?: string;
  details?: readonly string[];
  ports: readonly CanonicalPort[];
  sourceRefs?: readonly string[];
  introducedAt?: string;
  planned?: boolean;
  order: number;
}

interface CanonicalEndpoint {
  nodeId: GraphNodeId;
  portId?: GraphPortId;
}

interface CanonicalEdge {
  id: GraphEdgeId;                 // 跨阶段稳定
  source: CanonicalEndpoint;
  target: CanonicalEndpoint;
  relation: 'data' | 'control' | 'call' | 'event' | 'storage' | 'unknown';
  direction: 'directed' | 'bidirectional';
  label?: string;
  order: number;
}

interface CanonicalGraph {
  rootId: GraphNodeId;
  nodes: readonly CanonicalNode[];
  edges: readonly CanonicalEdge[];
}

interface StageSnapshot {
  id: string;
  track: string;
  order: number;
  label: string;
  title: string;
  graph: CanonicalGraph;
  meta: StageMeta;
}
```

关键规则：

- 根节点是图模型中的真实容器，但默认不映射成 React Flow 节点；其直接子节点成为顶层可见节点。
- 只有 `kind: group` 或带子节点的节点可展开；子节点关系只由 `parentId` 决定。
- 节点 ID 和边 ID 不得由路径生成。跨阶段移动只改变 `parentId)，不改变 ID。
- 路径由 `GraphIndex.pathOf(nodeId)` 派生，用于 Inspector、日志和调试，不进入边端点契约。
- 每个节点的端口 ID 在节点内唯一；方向、侧边和顺序是布局及 Handle 的输入。
- 图校验必须拒绝重复 ID、重复端口、未知父节点、父循环、多个根、未知端点、端口方向不匹配和不允许的跨容器关系。

### 2. Evolution

演进事件只引用稳定 node/edge ID：

- `added`, `removed`, `modified`, `moved` 使用 node ID；
- `split`、`merged` 使用源/目标 node ID 数组；
- `rewired` 使用 edge ID 或显式的 before/after endpoint；
- 路径变化由 GraphIndex 计算，不作为事件身份。

自动 diff 先按 ID 比较节点、父引用、端口和边，再叠加显式语义事件。这样移动、拆分、合并不会被路径重建误判成删除与新增。

## Projection 层重写

新增 `core/projection/model.ts` 与 `core/projection/project.ts`，输出只描述当前可见场景：

```ts
interface ExpansionState {
  expanded: ReadonlySet<GraphNodeId>;
}

interface VisibleNode {
  id: GraphNodeId;
  parentId?: GraphNodeId;
  canonicalId: GraphNodeId;
  kind: CanonicalNode['kind'];
  depth: number;
  expanded: boolean;
  expandable: boolean;
}

interface VisibleEndpoint {
  nodeId: GraphNodeId;
  portId?: string;
  foldedFrom?: GraphNodeId;
  boundary: boolean;
}

interface ProjectedEdge {
  id: string;                      // edge id + 当前投影端点的稳定派生 id
  canonicalEdgeId: GraphEdgeId;
  source: VisibleEndpoint;
  target: VisibleEndpoint;
  folded: boolean;
  label?: string;
  relation: CanonicalEdge['relation'];
  direction: CanonicalEdge['direction'];
}
```

算法顺序固定：

1. 根据 `expanded: Set<GraphNodeId>` 计算可见节点；清除不存在或不可展开的 ID。
2. 对每条 canonical edge 独立解析 source/target，沿显式 parentId 向上找到最近可见祖先。
3. 若端点被折叠，生成确定性的 boundary port；不丢弃原始 port，也不把所有边合并为一条。
4. 只有同一 canonical edge 在同一组可见端点上才可去重；平行关系按 edge ID 保留。
5. 输出 `nodeByCanonicalId`、`projectedEdgeByCanonicalId` 和折叠原因，供 Inspector 与增量高亮使用。

Projection 不计算宽高、坐标、React Flow 类型或 CSS。

## Layout Engine 重写

把现有 `core/layout/elk.ts`、`tidy.ts`、`geometry.ts` 统一到显式的布局输入输出：

```ts
interface LayoutInput {
  nodes: readonly {
    id: GraphNodeId;
    parentId?: GraphNodeId;
    kind: CanonicalNode['kind'];
    expanded: boolean;
    minSize: Size;
    headerSize: number;
    order: number;
    ports: readonly CanonicalPort[];
  }[];
  edges: readonly ProjectedEdge[];
  pinned?: ReadonlyMap<GraphNodeId, Point>;
  previous?: LayoutResult;
}

interface NodeLayout {
  id: GraphNodeId;
  parentId?: GraphNodeId;
  worldRect: Rect;
  contentRect?: Rect;
  headerRect?: Rect;
  anchors: ReadonlyMap<string, Point>;
}

interface EdgeRoute {
  id: string;
  points: readonly Point[];
  sourceAnchor: Point;
  targetAnchor: Point;
  labelPoint: Point;
}

interface LayoutResult {
  nodes: readonly NodeLayout[];
  edges: readonly EdgeRoute[];
  bounds: Rect;
}
```

实现拆分：

- `layout/metrics.ts`：卡片、聚合头部、内容区、内边距、网格和最小间距的唯一来源。
- `layout/layered.ts`：按显式 parentId 递归布局；每个 group 先布局子图，再由子图 bounds 反推容器 bounds；同层使用稳定 order，环路使用稳定 SCC 顺序。
- `layout/pinned.ts`：将用户拖拽位置按 node ID 合并进自动布局；父节点变化或超出容器时重新吸附到合法局部坐标。
- `layout/geometry.ts`：只处理矩形、端口锚点、正交避障、折线简化、圆角 SVG 路径。
- `layout/router.ts`：对每条 projected edge 按 edge id 路由；障碍物包含可见卡片和聚合头部，source/target 自身从障碍集合排除。
- `layout/index.ts`：只导出契约、默认 layered engine、可选 ELK provider 和 router。

布局结果统一使用世界坐标。React Flow 适配器再将有 parentId 的节点转换为父节点局部坐标，避免 Core 与 React Flow 各自解释坐标。

默认策略为“分层自动布局 + 稳定手动位置覆盖”。ELK.js 如需引入，只实现 `LayoutProvider`，不能让 schema、projection 或 renderer 依赖 ELK。

## React Flow Adapter 重写

将 `src/react/canvas/projection-to-flow.ts` 改成纯转换器，不再查找路径、推断父节点或重新计算边语义：

- React node id：`node:<canonicalNodeId>`；
- React edge id：`edge:<projectedEdgeId>`；
- `parentId` 来自 Projection，位置由 Layout 的 worldRect 转为 parent-local；
- `data.ports` 明确传递端口 ID、方向、侧边和 Handle ID；
- Handle ID 由 `port:<nodeId>:<portId>:in|out` 生成，折叠边使用 projection 生成的 boundary port；
- Edge source/target 只引用稳定 React node id，sourceHandle/targetHandle 只引用适配器生成的 Handle ID；
- `EdgeData.route` 持有按 edge id 关联的精确 points；OrthoEdge 始终优先消费 route，缺失 route 才使用明确的降级路径；
- 适配器不把回调塞进 canonical 数据，交互回调通过 renderer 的 node factory 注入；
- 节点位置、选择和持久化键都使用 canonical node ID，不使用路径。

为通用输入保留一个 `canonicalGraphToFlow`，为完整 `CanvasScene` 提供一个组合入口；删除当前同时接受 Projection、Layout、CanvasModel 并重复推断的三套转换分支。

## Canvas Renderer 重写

职责拆成四个模块：

1. `react/canvas/use-canvas-scene.ts`：根据 stage、previous、evolution 和 store 状态调用 Core Engine，返回不可变 Scene。
2. `react/canvas/CanvasScene.tsx`：只负责 React Flow、节点类型、边类型、viewport、drag/select 事件。
3. `react/panels/Inspector.tsx`、`DeltaPanel.tsx`：只消费 Scene 的选中项和 stage delta。
4. `playground/src/board/ArchitectureBoard.tsx`：管理 track/stage 导航、Sidebar、Stagebar、Toolbar、DeltaBar，并组合 CanvasScene 与 Inspector。

`EvolutionCanvas` 不再自己重复渲染 Inspector。看板外壳与画布共享同一个 selection/scene 入口。

Store 改为：

```ts
interface CanvasState {
  trackId: string;
  stageId: string;
  expandedByStage: Map<string, ReadonlySet<GraphNodeId>>;
  positionsByTrack: Map<string, ReadonlyMap<GraphNodeId, Point>>;
  viewportByTrack: Map<string, Viewport>;
  selection?: { type: 'node' | 'edge'; id: string };
  layoutMode: 'auto' | 'manual';
  inspectorOpen: boolean;
}
```

切换阶段时：

- 先用稳定 ID 交集保留展开项、选中项和拖拽位置；
- 删除当前阶段不存在的 ID；
- 保留 track 级 viewport；
- 新阶段先计算 projection/layout，再更新 React Flow；
- “展开一层/收起一层/回到总览/自动整理”只改变 store 或 layout mode，不直接修改 React Flow 内部节点树。

## 1002bot Adapter 重写

保留业务源数据在 `examples/1002bot/`，但 adapter 变为纯函数：

- 删除 `setTrack` 这类全局可变状态；
- 每个业务 stage source 先生成 `CanonicalGraphInput` 的扁平 nodes/edges；
- source tree 若继续作为编写便利，只在 adapter 内转换，不能穿过包边界；
- source 的 `id`、`file`、`rules` 等字段映射到 canonical node/port/sourceRefs；
- 每个 stage 运行 `validateCanonicalGraph`，再按 order 生成 TrackSeries；
- adapter tests 覆盖三条 track、稳定 ID、moved/split/merged、端口传播和边端点完整性。

## 推荐目标目录

```
packages/visualization/
  src/
    core/
      schema/
        types.ts
        validate.ts
        normalize.ts
      graph/
        index.ts
        validate.ts
      projection/
        model.ts
        project.ts
        boundary.ts
        index.ts
      evolution/
        diff.ts
        events.ts
        index.ts
      layout/
        metrics.ts
        layered.ts
        pinned.ts
        geometry.ts
        router.ts
        index.ts
      engine/
        scene.ts
        index.ts
    react/
      adapter/
        graph-to-flow.ts
        ids.ts
        ports.ts
      canvas/
        CanvasScene.tsx
        use-canvas-scene.ts
      nodes/
        CardNode.tsx
        AggregateNode.tsx
        NodePorts.tsx
      edges/
        OrthoEdge.tsx
      panels/
        Inspector.tsx
        DeltaPanel.tsx
      store/
        canvas-store.ts
      index.ts
    themes/
      default.css
  examples/
    1002bot/
      source.ts
      adapter.ts
      stages.ts
  playground/
    src/
      board/
        ArchitectureBoard.tsx
        Sidebar.tsx
        Stagebar.tsx
        Toolbar.tsx
        DeltaBar.tsx
        Inspector.tsx
      generated/
        bot-stages.json
  tests/
    core/
    integration/
    react/
    fixtures/
```

迁移期间可保留旧文件名作为薄转发层；新实现稳定后删除路径推断和旧 adapter，避免两套契约并存。

## 分阶段实施与提交边界

### Phase 0：契约冻结和基线

- 新增本计划和 current-task 记录。
- 建立 fixtures：最小树、三层嵌套、平行边、环路、移动节点、拆分/合并、端口方向冲突。
- 明确旧 API 的兼容窗口与迁移顺序。
- 验收：旧测试基线可重复；fixture 结构能够表达所有待修复情况。

### Phase 1：Schema + Graph Index

- 引入扁平 CanonicalGraph、稳定 node/edge/port ID。
- 重写 validate、normalize、indexGraph；路径改为派生值。
- 先保留旧 adapter 的转换入口，禁止新 Core 读取 `children` 或路径边端点。
- 验收：重复 ID、父循环、未知端点、端口方向和根约束均有失败测试；同一 ID 在三阶段移动后仍保持索引身份。

### Phase 2：Projection + Evolution

- 以 node ID expansion 重写 Projection。
- 实现折叠边界端口和稳定 projected edge ID。
- 以稳定 ID 重写 diff/events；补齐 moved/split/merged/rewired。
- 验收：逐级展开、跨层折叠、端口保留、平行边、环路和阶段切换均有纯函数测试。

### Phase 3：Layout + Router

- 实现 metrics、layered、pinned、router。
- 布局输入只使用 Projection 输出，坐标只在 Layout 产生。
- 路由按 edge ID 绑定，验证每段折线不穿越可见障碍，父 bounds 包含子 bounds。
- 验收：同一输入输出确定性；无重叠；子节点在父内容区；拖拽位置可跨重算保留；路由点与端口锚点一致。

### Phase 4：React Flow Adapter

- 新建稳定 node/edge ID 和端口 Handle 映射。
- 删除 adapter 内的路径切分、数组下标绑定和重复边推断。
- 补充 flow fixture，断言 parentId、局部坐标、handle、route points 和平行 edge。
- 验收：React Flow 只消费 Adapter 输出，不改变 Core Scene；命名端口实际渲染。

### Phase 5：Canvas Renderer + Playground

- 拆出 CanvasScene/use-canvas-scene/Inspector；ArchitectureBoard 成为唯一看板编排入口。
- Store 迁移到按 stage/track 保存的 node ID 状态。
- 逐条迁移 Sidebar、Stagebar、Toolbar、DeltaBar 和 Inspector。
- 验收：三条路线切换、阶段导航、节点选择、展开/收起、拖拽、自动整理、viewport、键盘和 aria 行为。

### Phase 6：删除旧契约与收口

- 删除递归 GraphNode、路径端点、旧 `CanvasModel` 重复适配、旧 layout fallback 和重复 Inspector。
- 更新 `src/index.ts`、`src/react/index.ts`、README、生成脚本和 dist 检查。
- 清理旧测试，保留按新契约分层的 core/integration/react fixtures。
- 只对 packages/visualization 相关文件做显式 git stage；不覆盖工作区其他未提交改动。

## 验收矩阵

| 层 | 必须证明的行为 |
| --- | --- |
| Schema | stable ID、显式 parent、端口方向、edge endpoint 和 root 约束 |
| Graph | 无重复/环路；path 是派生值；索引不覆盖 |
| Projection | expansion 按 node ID；折叠到最近可见祖先；boundary port 和平行 edge 保留 |
| Evolution | moved/split/merged/rewired 不依赖路径 |
| Layout | 父子 bounds、确定性、手动位置、端口锚点和稳定路由 |
| Adapter | stable React IDs、parent-local 坐标、Handle ID、route points |
| Renderer | 画布不做业务推导；Inspector 不重复；交互状态跨阶段连续 |
| Example | 1002bot 三轨数据全部经过同一 canonical contract |
| Release | core/react declarations、build、build:web、check:dist 和 README 同步 |

## 验证命令

依次执行：

1. `node --experimental-strip-types --test packages/visualization/tests/**/*.test.ts`
2. `node_modules/.bin/tsc -p packages/visualization/tsconfig.json --noEmit`
3. `node_modules/.bin/tsc -p packages/visualization/tsconfig.web.json --noEmit`
4. `node_modules/.bin/tsc -p packages/visualization/tsconfig.build.json`
5. `node packages/visualization/tools/rewrite-declaration-imports.mjs`
6. `node packages/visualization/tools/check-dist.mjs`
7. `pnpm --filter @1002bot/visualization build:web`（环境可用时）
8. 使用 Codex 原生页面检查 playground 的三条路线和阶段交互。

当前环境的 pnpm 会尝试通过 Corepack 下载 pnpm 10.30.3；若网络隔离继续存在，使用本地 Node/tsc 完成静态验证，并单独记录 pnpm 未执行原因。

## 回退策略与边界

- 每个 Phase 一个独立提交，提交前只 stage 该 Phase 文件。
- Phase 1–3 期间保留旧 adapter 转换层，可随时回退到旧 playground。
- Phase 4 后 React Flow 只读新 Scene；旧 renderer 不再接收新数据。
- 不修改 1002bot 业务事实和阶段报告内容，只改其数据映射。
- 不启动真实 bot，不访问网络，不使用 Playwright CLI wrapper。
