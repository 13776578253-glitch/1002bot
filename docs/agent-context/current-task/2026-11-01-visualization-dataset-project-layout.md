# Dataset project layout

Intent: Replace `datasets/progress-reports/` with a project registry plus `projects/runtime-architecture/{project.json,source,stages,views,workspace}`. Split source facts into a catalog and stage selections, and add `resolveSourceStages` to assemble the existing `ProjectSourceStage[]` contract so `adaptProject`, baselines and workspace stay unchanged. Update the playground loader, the project-data test and both READMEs. Multi-project selection and the v3 workspace/state contract remain out of scope.

Verification: package tests, core and web typechecks, library build; load the site on the running dev server; confirm no active references to the retired directory.

Result: Dataset moved to `datasets/projects.json` plus `projects/runtime-architecture/{project.json,source/catalog.json,stages/M0.json,views/M0.json,workspace/initial.json}`. Added `resolveSourceStages` and four contract tests; the loader reads the registry and resolves manifest paths inside the project directory. `ProjectManifest` is now version 2 with file lists. The retired `datasets/progress-reports/` directory is gone. Baselines, workspace contract and layout behavior are unchanged.

Verification: package tests 220/220; package and web typechecks passed; library build 128 artifacts and site build passed; root tests 242/242 and root typecheck passed; the running dev server resolves all six dataset assets and serves the page.

Update 2026-11-01: 项目 id 与标题改为 `1002bot`。目录 `projects/runtime-architecture/` → `projects/1002bot/`；注册表、清单、事实目录、工作空间种子与 README 同步更新。工作空间键变为 `visualization:project:1002bot:workspace:v1`，旧键记录不再读取。

Verification: package tests 220/220; the dev server was restarted and resolves `projects/1002bot/...` for the registry, manifest, catalog, stage, view and workspace assets.
