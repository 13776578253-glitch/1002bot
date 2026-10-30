# Visualization 认可版提升为唯一基线

Intent: 将已验收的递归自由画布提升为 packages/visualization 唯一正式基线，移除旧页面、样式、渲染器、布局管线、示例生成链与无关测试，保持数据输入独立。

Logic: 保留实际使用的 Canonical Graph schema/validation/index/projection/geometry。将认可交互模型移入 src/react/model，UI 拆为节点、关系、控制组件与控制器；公开 VisualizationCanvas 接收通用 baselines 输入，包源码不导入示例或Playground。M1/M2数据独立放 examples，通用坐标生成不包含节点ID。样式按主题/画布/节点/控制分拆并限定在画布作用域。唯一 Playground根入口使用公共组件，删除 ui-proposal.html、preview-theme.html、旧board/React/store/theme/Core engine及替代布局。测试随保留模块迁移并去除已废弃手动尺寸、旧渲染与旧发布契约断言，补数据边界和发布面测试。

Impact: 更新 ./react 导出为新画布组件与输入契约，移除旧API；增加独立CSS导出。根 pnpm dev 保持127.0.0.1:5199，旧预览路径移除。不接入真实业务源，不改bot运行逻辑。历史任务与计划保留。

Verification plan: 保留交互/几何回归、通用第三方ID数据与输入校验、模块依赖边界、包JS/declarations/CSS构建导入、唯一页面产物、无旧入口引用；包级测试、Core/Web类型检查、库构建与站点构建，原生浏览器验证基线切换/三层展开/四向自动扩容/分组/拖动/主题。

Change: 认可交互迁入src/react/model，拆分控制器、场景派生、节点/关系/控件组件与四份作用域CSS。新增VisualizationBaseline输入合同、完整输入校验、通用ID和缺省位置支持，库源码不再导入示例；样例独立于examples/baselines.ts，公开VisualizationCanvas与styles.css，包版本0.2.0。Core仅保留schema/graph/projection/geometry及GraphPatch，移除旧路径字符串兼容。

Cleanup: 删除旧业务adapter和四阶段源、旧board、旧React renderer/store/panels、旧theme CSS/HTML预览、engine/evolution及替代layout、数据生成与主题检查脚本、旧测试合同和已废弃手动尺寸功能。已认可的交互测试按当前模块迁移并补输入/边界测试。Playground只装配公共组件，MPA模式仅提供根入口，旧路径实际404。原认可源已保存至scratch/visualization-approved-source.zip，包内没有备份壳或兼容运行时。

Verification: visualization包级86/86测试通过，Core/Web类型检查通过；库构建及check:dist验证63个JS/声明/样式文件，JS导入和CSS依赖完整，无示例依赖或测试产物；站点单入口构建197 modules通过，仅index.html。仓库根pnpm test通过242项，根typecheck通过。初次整体测试受沙箱回环网络限制，允许本地端口后复测通过。根检查使用已缓存pnpm与任务局部命令包装，未安装依赖或改系统配置。

Browser verification: 原生IAB在新根入口验证M2三层展开、M1/M2切换保留三层，框选两张内部卡片后聚合并直接改名“上下文处理”，聚合前后两卡DOM位置逐项一致。组内摘要拖动使四层高度312/408/663.349/759.349增长至402.442/498.442/753.791/849.791，回拖收缩至接近原尺寸。深浅主题正常，主题属性只写在canvas根，不修改document主题，最终error列表为空。自动扩缩精确恢复、四方向、封顶、多选及隐藏层级由模型回归覆盖。

Routes: / = 200；/ui-proposal.html = 404；/preview-theme.html = 404。当前站点http://127.0.0.1:5199/。

Evidence: scratch/visualization-new-baseline.png、visualization-root-tests.log、visualization-root-typecheck.log。README已重写，说明新API、模块边界、完整快照和稳定ID/父局部坐标/变化标记/revision合同。

Open issues: none within the approved baseline migration.

Commit suggestion: refactor(visualization)!: promote the accepted canvas baseline

Archive: 新基线计划原文复制至docs/agent-context/history/plans/2026-10-30-visualization-new-baseline.md，SHA-256一致。
