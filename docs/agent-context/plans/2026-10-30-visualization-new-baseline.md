# Visualization 唯一基线模块化计划

## 数据与Core

CanonicalGraph、StageSnapshot、图校验、稳定ID索引、折叠投影及正交几何是Core的职责。公开 VisualizationBaseline 描述阶段、初始位置与显式变化标记；示例数据只在 examples 下，src 不导入 examples 或 playground。真实数据适配器后续生成相同输入。

## React边界

VisualizationCanvas消费通用baselines。交互模型、受控状态、场景派生与UI组件分别维护；节点、关系和控制组件消费状态与回调。保留认可版展开、跨层关系、分组、近距离吸附、四向有限扩缩及切换展开同步。

## 样式与入口

样式分为tokens、canvas、nodes、controls并限定画布作用域，通过 ./styles.css 显式导入。Playground只装配示例输入与公共组件，根路径为唯一页面；删除旧HTML、路由、样式、渲染器和数据生成工具。

## 清理与验证

移除旧engine、未使用布局提供器、旧React/store/themes和无关测试。保留覆盖当前行为的测试并迁移至对应模块旁或tests/integration；发布检查覆盖JS、声明、CSS、示例边界及唯一站点产物。更新README说明当前API和真实数据接入契约。
