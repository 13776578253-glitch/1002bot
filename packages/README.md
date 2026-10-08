Owner: `../pnpm-workspace.yaml`

# 独立包分类

apps 放可选应用，shared 放有实际复用或分发需求的共享包，extensions 留给独立扩展。每个实际包有自己的 package.json；分类目录不声明依赖。核心保留在根包与 src。

当前实际包是 apps/tui 与 shared/control-api。examples/tui、tests/integration 是开发工作区。安装入口与运行范围见 [包安装与迁移](../docs/使用说明/包安装与迁移.md)。
