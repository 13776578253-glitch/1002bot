Owner: `packages/visualization/`

# Visualization Core 设计

## 目标

把架构演进可视化沉淀为独立包：任何项目提供阶段快照，即可得到递归展开、跨层连线、阶段增量定位的交互画布。1002bot 的 12 个阶段是第一个数据接入方。

## 分层

| 层 | 内容 | 依赖 |
| --- | --- | --- |
| 项目接入层 | 1002bot 阶段数据、自定义架构数据 | 实现 adapter |
| Visualization Core | schema / graph / projection / evolution / layout，纯 TypeScript | 无运行时依赖 |
| 交互与渲染层 | React Flow 适配、自定义节点/边、时间线、详情面板 | React Flow，可选 Zustand |
| 最终交付 | 可安装 npm 包、可嵌入组件、独立演示站点、静态导出 | tsup / Vite |

## 数据模型：快照 + 演进事件

每个阶段是一份完整快照：确切存在的节点树与关系，不含相对上一阶段的推导。演进事件单独描述阶段间语义：

- `added` 出现新模块，新节点高亮
- `modified` 模块内部修改，节点局部变化提示
- `moved` 模块迁移到新的聚合块，保留身份，显示位置变化
- `split` 一个模块拆成多个，展示一对多来源
- `merged` 多个模块合并，展示多对一来源
- `removed` 组件被移除，对比模式展示退出状态
- `rewired` 关系改变，高亮旧边与新边

节点身份用稳定 `key`（跨阶段不变），路径（`parent/child`）可因 moved/split 改变。演进事件引用 key，不引用路径。差异由快照自动计算，事件补充语义。

## Core 模块职责

- `core/schema` — 类型协议与校验：StageSnapshot、GraphNode、GraphEdge、EvolutionEvent
- `core/graph` — 节点树、按 key/路径索引、关系查询；构建时校验父引用与端口引用
- `core/projection` — Graph Projection Engine：给定展开路径集合，计算可见节点与可见关系；折叠时端点投影到最近可见祖先；展开时端点落到实际接口端口。不依赖 UI
- `core/evolution` — 相邻快照比较，自动得出 added/modified/removed/rewired；与显式事件合并，得出 moved/split/merged 语义
- `core/layout` — 布局数据与路由接口：自由坐标、自动整理入口、正交路由的输入输出契约；默认实现放在 core，ELK.js 作为可选适配

## React 层约定

- `react/canvas` — React Flow 适配：把 projection 输出映射为 nodes/edges
- `react/nodes` — 叶子卡片与聚合容器两种节点组件
- `react/edges` — 正交连线与标签
- `react/panels` — 阶段时间线、详情面板、增量明细
- `react/hooks` / `react/store` — 展开状态、相机、选择；展开状态属于 core projection 输入，不属于 React Flow 内部状态

## 渐进迁移

1. core 先落地并通过 node:test 验证（当前步骤）
2. 现有 JS 原型继续由 `tools/build-html.mjs` 生成演示页
3. 写一个 adapter 把 1002bot 的 12 阶段转成快照序列
4. React Flow 接入后，playground 提供开发调试页；legacy 保留作对照

## 用户体验约束

- 首次打开看到整洁的整体图：默认只展开第一层，聚合合理但不固定层次
- 展开时内部组件原位呈现，外部关系改连实际接口，其他模块位置尽量稳定；子模块可继续展开到无更细层级
- 切换阶段优先显示变化：added/split/merged/rewired 局部高亮并可定位源码或阶段报告，整图不重新排列
