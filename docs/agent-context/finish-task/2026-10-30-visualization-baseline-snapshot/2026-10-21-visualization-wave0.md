# Visualization Wave 0

Time: 2026-10-21 09:11

Intent: Preserve the current legacy standalone HTML and begin Wave 0 for the visualization refactor by freezing the core graph contract and adding golden coverage for stable node/edge identity, port validation, projection folding, and evolution semantics.

Backup: `scratch/visualization-legacy-html-backup-2026-10-21-0911/` contains the current `architecture-evolution.html`, the legacy renderer inputs, and `MANIFEST.json` with SHA-256 hashes.

Logic: Keep the legacy renderer unchanged while establishing canonical core behavior. Edge identity will retain endpoints, ports, labels, direction, and parallel edges; projection will resolve the deepest visible ancestor; validation will check declared ports; evolution signatures will include structural and evidence metadata. Add focused regression fixtures before changing React or the HTML renderer.

Impact: This wave is limited to `packages/visualization/src/core/` and core tests. It does not migrate the adapter, React Flow components, standalone HTML renderer, package exports, or build configuration yet.

Verification plan: Run the visualization node:test suite, strict TypeScript checking with the existing package config, and the standalone HTML build. Add direct regression assertions for nested projection, parallel edges, port validation, and metadata changes.

Open issues: React `.tsx` files are still outside the package typecheck/build; explicit evolution events are still not wired into the playground; these belong to later waves.

Commit suggestion: refactor(visualization): freeze core graph contract

## Wave 1/2 implementation update

Time: 2026-10-21 10:02

Change: Wave 1 now has a canonical stage boundary. `canonical-model.ts` owns the extracted stage catalogue and graph builder as an ESM source; the adapter imports it directly instead of executing the legacy renderer through `node:vm`. `data/stages.ts` re-exports the canonical catalogue, `normalizeTrackSeries` orders and validates tracks, and the playground validates generated JSON at startup. The old renderer source remains intact as a compatibility path.

Change: Wave 2 adds `core/engine/index.ts` with a single `createCanvasModel` pipeline for graph indexing, projection, automatic and explicit evolution, tidy layout, routing, stable node/edge metadata, and port handles. React Flow now consumes `canvasModelToFlow`; the tidy layout emits four-point orthogonal routes, and package web typechecking covers all TSX files through `tsconfig.web.json`.

Verification: `npm run typecheck` passed with both core and web configs; `npm test` passed 21/21; `npm run gen:data` produced main(6), qq(2), tui(4); `npm run build` passed; Vite production build passed with 187 modules. The backup manifest was rehashed successfully with every entry unchanged.

Open issues: React still renders smooth-step paths instead of consuming route points, the standalone HTML renderer still has its own model/route implementation, package exports do not yet expose React TSX components, and browser E2E remains for a later wave.

Commit suggestion: refactor(visualization): unify canonical canvas computation

## Wave 0 implementation update

Time: 2026-10-21 09:16

Change: Added the legacy HTML backup before refactoring. In the core projection engine, endpoint folding now walks from the endpoint toward the deepest visible ancestor and projected-edge deduplication retains original endpoints, labels, ports, and direction. Snapshot validation now checks that `#port` references are declared on the endpoint node. Evolution node signatures now include ports, source, intro, and direct child structure; edge deltas retain ports, labels, and direction in their identity.

Tests: Added regression coverage for undeclared ports, three-level folded projection, parallel labeled edges, and metadata changes. `node --experimental-strip-types --test packages/visualization/tests/*.test.ts` passed 19/19. Strict package typecheck passed. The declaration build passed, standalone HTML build passed, and the theme selector check passed 24/24.

Open issues: React/TSX build coverage, canonical adapter extraction, explicit event wiring, React/HTML ViewModel unification, and browser E2E remain for later waves.

Commit suggestion: refactor(visualization): freeze core graph contract

## Wave 1/2 verification update

Time: 2026-10-21 10:08

Change: Added `build:web` and changed the package `dev` script to generate data directly before starting Vite, so the package entry no longer depends on a nested pnpm invocation.

Verification: `npm run build:web` passed with 187 modules; `npm run dev` generated all three tracks and started Vite at `http://127.0.0.1:5199/`, then the process was stopped after readiness was observed. The generated-data, typecheck, test, and build checks remain green.

## Final Wave 1/2 test update

Time: 2026-10-21 10:12

Verification: After adding the canonical track normalization regression, `npm test` passed 22/22 and `npm run typecheck` passed with both core and web configurations.

## Wave 3/4 implementation update

Time: 2026-10-21 10:35

Change: Wave 3 adds controlled React Flow interaction state: stage changes clear stale expansion and manual positions, node positions persist through the Zustand store, selected nodes are controlled, aggregate/card actions expose expanded state, and the canvas renders an inspector with path, description, delta note, details, and source link. The canvas summary reports visible nodes and stage changes. Web typechecking now covers these TSX paths.

Change: Wave 4 changes standalone HTML generation to embed canonical TrackSeries snapshots and a small compatibility model adapter. `render/freecanvas.js` remains the standalone interaction/layout shell, but `render/canvas-model.js` is no longer its build input. The legacy model source remains preserved for backup/compatibility only.

Verification: `npm test` passed 23/23; `npm run typecheck` passed core and web configs; `npm run build` passed with canonical standalone data; `npm run build:web` passed with 187 modules; theme selector check passed 24/24; `npm run dev` generated all tracks and reached `http://127.0.0.1:5199/`. The standalone HTML test confirms canonical snapshots are embedded.

Open issues: Full browser interaction/E2E has not been run; React OrthoEdge still computes smooth-step paths instead of consuming the Core route points; React components are not yet package exports; the old renderer algorithms remain as a compatibility shell.

Commit suggestion: refactor(visualization): unify interactive and standalone views

## Wave 3/4 metadata preservation update

Time: 2026-10-21 10:43

Change: StageSnapshot now carries the stage scope, changes, and verification copy required by the standalone inspector. The canonical standalone adapter passes these fields through so stage details remain available after the renderer input migration.

Verification: `npm run typecheck` passed; `npm test` passed 23/23; `npm run build` passed; `npm run gen:data`, `npm run build:web`, and the 24-selector theme check passed.

## Wave 3/4 browser verification update

Time: 2026-10-21 10:50

Verification: The local Vite dev server reached readiness at `http://127.0.0.1:5199/` after generating all tracks. The bundled Playwright wrapper could not run in this Windows shell because its Bash launcher was access-denied; `npx` could not acquire the CLI offline. No browser interaction claim is made from this attempt.

## Wave 3/4 completion update

Time: 2026-10-21 11:20

Change: Wave 3 now controls camera viewport, fit-to-view initialization, zoom/pan controls, selection, keyboard activation, aria labels, expanded state, manual positions, and stage-level Inspector content. Wave 4 now serializes a canonical CanvasModel for every stage's default expansion into standalone HTML. The standalone shell consumes that model for its initial scene and route drawing; stage transitions reset stale expansion so each stage starts from the canonical view.

Verification: `npm run typecheck` passed; `npm test` passed 24/24; `npm run build` passed; the standalone parity test compares node paths, edge counts, and bounds against `createCanvasModel` for all tracks and stages. The old HTML backup remains unchanged.

Open issues: Expanded standalone scenes still use the compatibility shell's browser-side expansion path; direct browser execution of the TS Core bundle and full React/HTML parity for every expansion state remain the next migration step. Playwright CLI was unavailable in the current Windows shell.

## Wave 4 engine migration completion

Time: 2026-10-21 12:05

Change: Added a Vite IIFE build of `core/engine` as `standalone-engine.iife.js` and embed it in the standalone HTML. The freecanvas shell now calls `VisualizationStandalone.createStandaloneCanvasModel` for every stage and expansion state, consumes its node positions, edges, and route points, and no longer contains the legacy layout, projection, or routing algorithms. The old `src/render/canvas-model.js` source was removed after the verified backup; the original is preserved in `scratch/visualization-legacy-html-backup-2026-10-21-0911/`.

Verification: `npm test` passed 25/25, including default and expanded standalone/Core parity; `npm run typecheck`, `npm run build`, and `npm run build:web` passed. The standalone artifact contains the embedded `VisualizationStandalone` engine bundle. The theme selector check remains 24/24.

Open issues: Playwright browser execution remains unavailable in the current Windows shell; Vite reports a bundle-size warning for the React playground.

## Wave 5 收口计划

Time: 2026-10-21

Intent: 完成 visualization 包发布出口和交付收口。公开 React Flow 组件、节点、边、store 类型；将 TSX 纳入声明构建；提供独立 web 类型检查命令；增加构建产物检查和 Wave 5 验证记录；在可用环境中执行 playground/standalone smoke。

Impact: 修改 packages/visualization 的 package exports、构建 tsconfig、脚本、React 公共入口、README 与测试/任务记录。不会启动真实 bot 或访问网络。

Verification plan: 运行 npm test、npm run typecheck、npm run typecheck:web、npm run build、npm run build:web，并检查 dist/index.js、dist/react/index.js、dist/react/index.d.ts、dist/data/canonical-model.js、dist/architecture-evolution.html。浏览器验证仅在本机 Playwright 可执行时进行。

Open issues: bundle 体积警告和浏览器工具可用性在验证阶段确认。

## Wave 5 implementation and verification update

Time: 2026-10-21

Change: Added `src/react/index.ts` as the public React Flow entry and added the `./react` package export. The root API remains UI-independent while consumers can import `EvolutionCanvas`, nodes, edge, projection adapters, and canvas store types from `@1002bot/visualization/react`.

Change: Included TSX and JSX settings in the declaration build, added a CSS module declaration, and added `typecheck:web` for the explicit browser TypeScript check required by the repository. Added declaration import rewriting so emitted `.d.ts` files point at packaged `.js` modules rather than source `.ts/.tsx` paths.

Change: Added `check:dist` and made `build` verify the public JavaScript, React declaration entry, canonical data, standalone HTML, and export targets. Vite playground output now splits vendor and app groups; the largest emitted JavaScript chunk is 397.70 kB and the previous 500 kB warning is gone.

Verification: `npm test` passed 25/25; `npm run typecheck` passed; `npm run typecheck:web` passed; `npm run build` passed with `visualization dist verified (5 required artifacts)`; `npm run build:web` passed with 187 modules and vendor/app chunks; `npm run check:dist` passed; theme selectors passed 24/24.

Browser boundary: Playwright CLI prerequisite was checked. The wrapper is blocked by Windows Bash access denial, and the Playwright MCP browser is blocked because the Chrome distribution is not installed. The local Vite server was generated successfully, but no browser interaction result is claimed from these unavailable runners.

Open issues: none within the Wave 5 package release scope. Browser installation remains an environment prerequisite for a later interactive smoke run.

Commit suggestion: build(visualization): publish React canvas surface

## Wave 5 acceptance method correction

Time: 2026-10-21

Correction: 按负责人要求，验收不使用 Playwright CLI wrapper。packages/visualization 未引入 Playwright CLI 配置或依赖；临时验收日志和浏览器 profile 已清理。历史记录中的旧 wrapper 尝试保留为历史事实，不改写。

Verification: 改用 Codex 内置验收能力打开 playground/dist/index.html 与 dist/architecture-evolution.html 产物。Codex 内置浏览器无法访问终端隔离的 localhost，现有 Edge 页面也未读取；交互浏览器 smoke 留待 Codex 内置浏览器可访问本地服务后执行。自动化测试、Core/standalone parity、typecheck、build、build:web 和 check:dist 仍为通过状态。

## 2026-10-22 visualization cleanup execution update

Change: React Flow is now the only visualization runtime and delivery surface. Removed the standalone HTML generator, FreeCanvas shell, embedded standalone engine, shell CSS/body templates, standalone render test, and the package legacy directory. Removed the standalone artifact from the package build and exports documentation.

Change: `build` now clears `dist` before generating typed Core and React output. `check:dist` verifies four package artifacts; the package no longer includes `legacy/`. Canonical adapter comments and tests no longer describe the removed HTML renderer as an active compatibility path. Added a React adapter regression covering CanvasModel node/edge mapping, aggregate parent relationships, selection, and expansion callbacks.

Verification: `npm test` passed 23/23; `npm run typecheck` passed; `npm run typecheck:web` passed; `npm run build` passed; `npm run build:web` passed with 187 modules and 397.70 kB vendor output; `npm run check:dist` passed; theme selectors passed 24/24. Package source has no removed runtime references; `dist/architecture-evolution.html` is absent. Backup MANIFEST was rehashed successfully with all 7 entries unchanged.

Plan archive: `docs/agent-context/history/plans/2026-10-22-visualization-cleanup.md` matches the active plan byte-for-byte.

Browser acceptance: Codex built-in file preview is used for the React playground artifact. No terminal browser runner or Playwright CLI wrapper is used. Interactive browser actions remain dependent on the Codex preview being able to serve the local Vite asset graph.

Open issues: none in the cleanup and build scope.

Commit suggestion: refactor(visualization): remove legacy standalone renderer
