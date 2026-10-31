# packages/visualization 注释规范化与补全

Intent: 按照 AGENTS-en.md 与 src/ 的注释规范，为 packages/visualization 补全核心模块、模型、计算算法与交互控制器的代码注释，杜绝无意义的语法转述，准确沉淀不变式与架构契约。

Logic:
1. 参照 AGENTS-en.md 第 3 节规范：结论先行、说明不变式与契约、消除无意义语法转述（如遍历、赋值等显而易见的代码描述），禁止虚构对比与无事实依据的修饰词。
2. 参照 src/ 注释风格：模块头简要声明模块核心职责与边界；关键类型与字段说明坐标系、单位与生命周期；核心算法（正交避障路由、容器四向有限扩缩容配额、图投影与折叠端口、基线状态同步、局部与全局坐标映射）记录数学与几何不变式。
3. 覆盖范围：
   - src/index.ts 与 src/react/index.ts：公开入口与分层契约
   - src/core/schema/：图模型契约、基线合同、输入校验边界
   - src/core/graph/：图语义校验、拓扑索引、增量补丁原子变更
   - src/core/projection/：纯投影计算、展开显隐状态、折叠边界端口坍缩
   - src/core/layout/geometry.ts：局部/世界坐标转换、A* 网格正交避障与拐角平滑
   - src/react/model/：约束吸附、四向有限扩缩容配额、分组与解散生命周期、层级展开联动、标签避障布局、连接桩路由
   - src/react/canvas/：受控交互控制器与场景派生管线
   - src/react/components/：核心节点、关系与工具组件的交互与无障碍契约
   - playground 与 examples：独立入口与样例数据说明
   - tools/：打包构建与产物校验辅助脚本

Impact: 纯注释更新，不变更任何运行时逻辑、类型定义与对外签名。

Verification:
1. pnpm --filter @1002bot/visualization typecheck: 通过
2. pnpm --filter @1002bot/visualization test: 86/86 通过
3. pnpm --filter @1002bot/visualization build: 通过，产物 63 项 JS/声明/样式验证通过
4. pnpm --filter @1002bot/visualization build:web: 197 modules 成功构建
5. pnpm run typecheck: 全仓类型检查通过
6. pnpm test: 全仓 242/242 项测试通过
