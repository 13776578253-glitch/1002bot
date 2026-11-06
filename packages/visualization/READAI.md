# Visualization Package Development Rules

## 1. Core Principles

This package follows a continuous, iterative development model. Implementations may evolve in response to real-world usage, browser validation, bugs, and new requirements.

Every change must prioritize:

- **Architectural consistency:** Clear module responsibilities, data flow, and execution paths.
- **Code readability:** Straightforward logic, justified abstractions, and minimal unnecessary complexity.
- **Architectural convergence:** New implementations should replace obsolete mechanisms rather than accumulate alongside them.
- **Behavioral reliability:** Preserve correct existing behavior through automated testing and real-browser validation.

The objective is not merely to resolve individual issues, but to progressively reduce the cost of understanding, modifying, and maintaining the system.

## 2. Before Implementation: Root-Cause Analysis

When a new issue or optimization request is introduced:

1. Investigate the root cause by examining the relevant code, data flow, and module boundaries.
2. Determine whether the issue originates from an algorithm, data contract, state management, ownership conflict, or presentation logic.
3. Identify existing mechanisms that already perform similar responsibilities.
4. Prefer correcting existing algorithms, data models, and contracts over introducing localized workarounds.
5. For changes spanning multiple subsystems, present the necessary architectural adjustments, affected components, and validation strategy before implementation.

**Do not treat additional fallbacks, compatibility layers, post-processors, or duplicate state as the default solution.**

## 3. During Implementation: Ownership and Complexity

### 3.1 Prefer Improving Existing Mechanisms

- Fix existing implementations before creating parallel alternatives.
- Address problems at their source rather than repeatedly compensating at downstream consumers.
- Establish a clear owner for each responsibility and piece of authoritative state.
- Avoid duplicate computations, redundant transformations, and competing sources of truth.
- Reuse existing contracts and execution paths whenever appropriate.

### 3.2 Justify Every New Mechanism

Before introducing a new function, abstraction, cache, state variable, fallback, or compatibility mechanism, explain:

1. Why can the existing architecture not fulfill this responsibility?
2. What exact problem does the new mechanism solve?
3. Which module owns it?
4. Where is its data produced, updated, and consumed?
5. What governs its creation, invalidation, and cleanup?
6. Can obsolete logic be removed or replaced to offset the additional complexity?

Mechanisms without a clear purpose, owner, and lifecycle should not be introduced.

### 3.3 Complete the Transition from Old to New

When a new implementation replaces an existing mechanism, inspect and remove:

- Superseded algorithms and execution branches.
- Unused functions, types, fields, and interfaces.
- Redundant caches, state variables, and data transformations.
- Obsolete compatibility logic, fallbacks, and post-processing.
- Tests, comments, and documentation that no longer reflect the implementation.

If legacy behavior must temporarily remain, document why it is necessary, where it applies, and the conditions for its removal.

**Do not continuously accumulate new implementations while retaining obsolete mechanisms without a defined purpose.**

## 4. Validation and Definition of Done

Keep every iteration focused on a clearly defined task. Avoid unrelated refactoring.

After implementation, perform validation appropriate to the change:

1. Relevant unit and integration tests.
2. Type checking, builds, and regression tests.
3. Real-browser interaction and visual verification.
4. State consistency checks for stages, snapshots, caches, and persistence when applicable.
5. Comparison of key data flows and execution paths before and after the change.

Clearly distinguish passed, failed, and unexecuted checks.

**Passing tests alone is not sufficient for architectural completion.**

A completed change should also demonstrate:

- Clear data flow.
- Explicit module ownership.
- Traceable execution paths.
- Correct migration or removal of superseded logic.
- No unjustified additional complexity.
- Preservation of existing correct behavior.

If these conditions are not fully met, classify the result as an intermediate milestone and document the remaining work.

## 5. Mandatory Post-Iteration Report

After every code-modifying iteration, append a report under the **Iteration Log** section at the end of this file.

Each report must cover:

1. **Problems Fixed**
   - Original symptoms, root causes, and implemented solutions.
2. **Functions, Algorithms, and Mechanisms Changed**
   - New, modified, or removed functions, algorithms, state, and data contracts.
   - Explain their responsibilities and justification.
3. **Files Modified**
   - List the main affected files and the purpose of each change.
4. **Complexity Assessment**
   - Identify added abstractions, branches, state, caches, or execution paths.
   - Consider whether a simpler implementation exists.
   - State whether structural complexity decreased, remained stable, or increased, and explain why.
5. **Legacy Mechanism Cleanup**
   - Identify mechanisms superseded by the new implementation.
   - List removed legacy functions, fields, state, and compatibility branches.
   - Explain any retained legacy logic and the conditions for future removal.
6. **Validation and Remaining Technical Debt**
   - Report automated tests, type checking, build results, and real-browser verification.
   - Record incomplete validation, known defects, and unresolved technical debt.

Reports must be concise, specific, and verifiable. Never describe planned work as completed or unexecuted checks as passed.

## 6. Scope and Documentation Rules

- These rules apply only to `packages/visualization` and its directly related tests, Playground, and documentation.
- Do not modify repository-wide agent instructions or unrelated packages without explicit authorization.
- Preserve the rules and existing iteration history in this file.
- Append a new report after every code-modifying iteration; do not overwrite previous reports.
- Read-only investigations and discussions do not require a code-change report.
- If these rules conflict with higher-priority repository instructions, identify the conflict and follow the higher-priority instructions.

---

# Iteration Log

Append all future code-change reports below.

## YYYY-MM-DD — Task Name

**1. Problems Fixed**

**2. Functions, Algorithms, and Mechanisms Changed**

**3. Files Modified**

**4. Complexity Assessment**

**5. Legacy Mechanism Cleanup**

**6. Validation and Remaining Technical Debt**

## 2026-11-04 — Compact overview and unified label layout

**1. Problems Fixed**

- Overview and Full projections exposed hierarchy controls and accepted hierarchy double-clicks despite fixed projection scope. They now omit controls and ignore those gestures.
- Canvas rendering had competing route-side and final label placement. Final placement now uses one `LabelLayoutCache` for both Legacy and Group paths.
- Labels could float away from their route. Final candidates are inline or attached with at most a two-world-unit capsule gap; illegal labels hide and never reappear through hover or selection.
- Small path changes could move a valid label. Prior attachments are projected onto compatible segments and a candidate must improve by at least 20 points to replace them.
- Automatic positions were not identity-scoped caches. `label-snapshots.ts` now stamps identity, route and policy and excludes derived caches from authored merge/undo comparisons.
- Explicit pins lacked a strict endpoint/port identity contract and shared a path-lock lifecycle. Pins are now independent workspace content with member fingerprints.

**2. Functions, Algorithms, and Mechanisms Changed**

- `LabelLayoutCache`: unified final placement, tight attachment, collision resolution, prior-attachment projection, 20-point hysteresis, fork/adopt commit boundary.
- `LabelLayoutAttachment` / `labelSeeds` / `captureLabelledRoutes` / `sceneGeometryKey`: geometric attachment identity, cache lifecycle and same-frame capture.
- `LabelLayoutEdge.identity`, `labelPinForEdge`, `pinLabelForEdge`, `retainLabelPins`: explicit pin identity and source-stage migration.
- `useCanvasScene.frame`, controller deferred finish, and `cacheRenderedRoutes`: final node/path/label snapshot is captured only after the matching React commit.
- Compact Overview: `CARD_SIZE` changed to 240×80; hierarchy handlers exist only in Structure View.

**3. Files Modified**

- Core: `label-layout.ts`, `label-pins.ts`, `label-snapshots.ts`, `route-cache.ts`, `route-groups.ts`, `group-route-cache.ts`, `route-quality.ts`, `edge-routes.ts`, `blackbox-routes.ts`.
- Integration: `use-canvas-scene.ts`, `use-canvas-controller.ts`, `use-workspace-session.ts`, `relation-edge.tsx`, `connection-panel.tsx`, `VisualizationCanvas.tsx`.
- State/storage: `workspace.ts`, `confirmation.ts`, `snapshot-inheritance.ts`, `stage-navigation.ts`, `stage-transition.ts`, `local-storage.ts`, `project-storage.ts`, `project-workspace.ts`.
- Compact Overview: `grouping.ts`, `nodes.tsx`, `components/README.md`, `packages/visualization/README.md`, `model/README.md`, playground title.
- Tests and records: label layout/pin/snapshot tests, route/stage regression tests, `2026-11-03-visualization-compact-overview.md`, `2026-11-04-visualization-label-layout.md`.

**4. Complexity Assessment**

- Structural complexity decreased in the render path: route engines no longer own final label placement, and one cache owns placement and attachment continuity.
- State complexity increased modestly with fork/adopt caches, fingerprint-bearing pins and same-frame snapshots; each has an explicit owner, invalidation rule and payload.
- Remaining complexity is structural rather than algorithmic: Routing still carries dormant label fields and Labeling still reconstructs geometry/segments. A direct Routing→Labeling space contract would remove that duplication.

**5. Legacy Mechanism Cleanup**

- Active canvas label placement was removed from Legacy/Group route outputs; route `label` values are zero placeholders and no longer seed final placement.
- `labels.ts:placeEdgeLabel` remains only for compatibility tests; it is no longer in the canvas pipeline.
- Not removed: `CachedRoute` / `GroupCandidate` label fields, label fields in `route-quality`, and path-only stage snapshots. These remain documented technical debt.

**6. Validation and Remaining Technical Debt**

- Passed this iteration: 52 focused label/pin/snapshot/integration tests; package TypeScript checks; compact-only split-tree TypeScript checks. No browser or build was run in this commit round; earlier task records claim browser/build verification for their respective scopes.
- Remaining: Routing does not yet provide stable segment ids, shared-trunk identity or available label space; Labeling still reconstructs geometry and segments.
- Remaining: stage navigation/transition still use path-only display routes, so automatic label caches are not carried across stages.
- Remaining: legacy pins without `memberFingerprints` can still match by display identity; strict migration/hiding is pending.
- Remaining: remove dormant route-side label fields and the legacy `placeEdgeLabel` helper once all compatibility tests are migrated.
- Commits: `942dba3` Compact Overview; `64268db` final unified label layout.

## 2026-11-04 — Persistence validation baseline

**1. Problems Fixed**

- No production behavior changed. Added characterization tests for persisted workspace normalization and localStorage backup order/side effects.

**2. Functions, Algorithms, and Mechanisms Changed**

- None in production.
- Test-only: `workspace-normalization.test.ts` and `local-storage.test.ts`; the package test glob now includes persistence unit tests; an architecture test asserts normalization remains internal to the React entry.

**3. Files Modified**

- `src/react/persistence/__tests__/workspace-normalization.test.ts` (new)
- `src/react/persistence/__tests__/local-storage.test.ts` (new)
- `package.json` (test glob)
- `tests/architecture/boundaries.test.ts` (export boundary)
- `docs/agent-context/current-task/2026-11-04-visualization-persistence-refactor.md`
- This report.

**4. Complexity Assessment**

- No runtime complexity change. Tests lock error precedence, field/reference behavior, migration results and backup side effects; no new abstraction.

**5. Legacy Mechanism Cleanup**

- None. The schema/local-storage split has not started.

**6. Validation and Remaining Technical Debt**

- New persistence tests: 16/16 passed; package typecheck passed.
- Full package suite: 398 passed, 13 failed. The failures are the pre-existing card-size, four-side-growth, grouping, layout-intent and project-data expectations, unchanged by this test-only phase.
- Recorded gap: overlay element-level validation only checks the top-level shape and is intentionally unchanged in Phase 1.
- Next phase: move schema code unchanged into `workspace-schema.ts`, preserving `checkNodeViews` error order and `save()` side effects.

## 2026-11-04 — Persistence schema/storage split

**1. Problems Fixed**

- No runtime behavior changed. Separated persisted-workspace schema and migration from the localStorage adapter so each module has one owner.

**2. Functions, Algorithms, and Mechanisms Changed**

- `workspace-schema.ts` now owns `normalizeWorkspaceView`, `assertWorkspaceView`, content readers and v1/v2 migration, moved unchanged from `local-storage.ts`.
- `local-storage.ts` now owns only `createLocalStorageViewStorage`; backup order and failure side effects are unchanged.
- Internal imports now target `workspace-schema.ts`; the React public entry is unchanged.

**3. Files Modified**

- `src/react/persistence/workspace-schema.ts` (moved from `local-storage.ts`)
- `src/react/persistence/local-storage.ts` (storage adapter only)
- `src/react/persistence/project-storage.ts`, `src/react/VisualizationCanvas.tsx` (imports)
- `src/react/persistence/__tests__/workspace-normalization.test.ts`, `src/react/model/__tests__/label-pins.test.ts`, `src/react/model/__tests__/label-snapshots.test.ts` (imports)
- `src/react/model/README.md` (owner path)
- This report.

**4. Complexity Assessment**

- Runtime behavior and data contracts are unchanged. Module ownership is clearer: schema has no storage access, and storage no longer carries validation logic.
- No new abstraction layer, manager, fallback or compatibility path was added.

**5. Legacy Mechanism Cleanup**

- Removed the schema implementation from the storage adapter. `normalizeWorkspaceView`/`assertWorkspaceView` are no longer imported through `local-storage.ts`.
- No behavior, field, copy rule or migration branch was removed.

**6. Validation and Remaining Technical Debt**

- Package typecheck passed; persistence tests 16/16; architecture tests 5/5.
- Full package suite: 398 passed, 13 failed. The same pre-existing card-size, growth, grouping, layout-intent and project-data failures remain; no new failures.
- Next phase: optimize reader composition without changing `checkNodeViews` error order, field/copy behavior, migration output or `save()` semantics.

## 2026-11-04 — Persistence reader consolidation

**1. Problems Fixed**

- No runtime behavior changed. Reduced repeated error literals and repeated rect/bounds/baseline checks in the persisted-workspace schema.

**2. Functions, Algorithms, and Mechanisms Changed**

- Added named constants for the repeated schema error messages.
- Added `optionalText`, `checkRectFields`, `checkBounds` and `checkBaseline`; each is shared by multiple readers.
- `checkNodeViews` remains two-pass and keeps duplicate-ID errors ahead of node-shape errors.
- Display-route validation checks the record before optional policy fields with the same messages; invalid label attachments are still stripped without rewriting path geometry.
- `normalizeV2` uses `optionalText` while preserving cross-field validation order and output fields.

**3. Files Modified**

- `src/react/persistence/workspace-schema.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-persistence-refactor.md`
- This report.

**4. Complexity Assessment**

- Diff: 81 insertions, 49 deletions, +32 net lines.
- Repeated literals and three rect/label loops were consolidated; the added lines are shared helpers and invariant comments.
- No new layer, manager, fallback or compatibility path was added.
- Endpoint checks remain in their original order to preserve error behavior.

**5. Legacy Mechanism Cleanup**

- None removed. No field, copy rule, migration branch or storage behavior was replaced.

**6. Validation and Remaining Technical Debt**

- Package typecheck passed; persistence tests 16/16; architecture tests 5/5.
- Full package suite: 398 passed, 13 failed. The same pre-existing card-size, growth, grouping, layout-intent and project-data failures remain; no new failures.
- Next phase: storage narrowing and comments without changing backup order or failure side effects.

## 2026-11-04 — Persistence storage finalization

**1. Problems Fixed**

- No runtime behavior changed. Named the two one-time backup suffixes and documented the adapter's load/save contracts.
- Added a test that locks the exact read/write sequence of the two backups.

**2. Functions, Algorithms, and Mechanisms Changed**

- `local-storage.ts` now uses named backup suffixes and a clearer local variable for the three-view backup.
- Chinese comments state the load failure contract and the fixed backup order.
- No validation, migration, backup trigger or exception behavior changed.

**3. Files Modified**

- `src/react/persistence/local-storage.ts`
- `src/react/persistence/__tests__/local-storage.test.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-persistence-refactor.md`
- This report.

**4. Complexity Assessment**

- The storage adapter remains about 38 lines and owns only read/write plus one-time backups.
- The added test increases coverage without adding runtime complexity.
- No new layer, manager, fallback or compatibility path.

**5. Legacy Mechanism Cleanup**

- None removed in this phase. The schema/storage split and reader consolidation were completed in earlier phases.

**6. Validation and Remaining Technical Debt**

- Package typecheck passed; persistence tests 17/17; architecture tests 5/5.
- Full package suite: 399 passed, 13 failed. The same pre-existing card-size, growth, grouping, layout-intent and project-data failures remain; no new failures.
- Remaining: overlay element-level validation is still a recorded gap and was intentionally unchanged.
- Refactor summary: storage adapter 364 → about 38 lines; schema now owns validation/migration; public API unchanged; no fallback or compatibility patch added.

## 2026-11-04 — Canvas hook comments

**1. Problems Fixed**

- No runtime behavior changed. Added module-level English headers and Chinese invariant annotations to the three main canvas hooks.

**2. Functions, Algorithms, and Mechanisms Changed**

- None in production. Comments document transaction ordering, deferred navigation, group-solver fallback, label cache fork/adopt, snapshot timing, render caches and per-view workspace ownership.
- `use-drag-profile.ts` already had a suitable English module header and was left unchanged.

**3. Files Modified**

- `src/react/canvas/use-canvas-controller.ts`
- `src/react/canvas/use-canvas-scene.ts`
- `src/react/canvas/use-workspace-session.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-canvas-comments.md`
- This report.

**4. Complexity Assessment**

- Comment-only diff: 43 insertions, 0 deletions; no code, type or signature change.
- Comments are limited to non-obvious invariants and cache/transaction lifecycles; no per-line narration.

**5. Legacy Mechanism Cleanup**

- None. No mechanism was replaced or removed.

**6. Validation and Remaining Technical Debt**

- Package typecheck passed.
- Full package suite: 399 passed, 13 failed. The failure set is the same pre-existing card-size, growth, grouping, layout-intent and project-data baseline.
- Diff checks confirmed the canvas changes are comment-only.
- Remaining technical debt is unchanged: the 13 pre-existing suite failures and the recorded overlay validation gap.

## 2026-11-04 — Canvas hook comment refinement

**1. Problems Fixed**

- Canvas module headers stated only one aspect, so the command/session/scene ownership boundary was not recoverable from the file head.
- Non-obvious contracts were unmarked: preview read-only behavior, capture-before-commit, drag intent versus automatic compensation, reserved-path registration, route labels as snapshot carriers and metadata kept outside geometry history.

**2. Functions, Algorithms, and Mechanisms Changed**

- None in production. English headers now state ownership, boundary and core mechanism for the three command/session/scene hooks; `use-drag-profile.ts` kept its existing header.
- Chinese annotations were added or tightened only for ordering, failure semantics, cache lifecycles and non-persisted metadata.

**3. Files Modified**

- `src/react/canvas/use-canvas-controller.ts`, `use-canvas-scene.ts`, `use-workspace-session.ts`, `use-drag-profile.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-canvas-comments.md`
- This report.

**4. Complexity Assessment**

- Comment-only diff; no runtime branch, state, cache or type change.
- Comments stay limited to contracts the code cannot show; no per-field translation or per-line narration.

**5. Legacy Mechanism Cleanup**

- None. No mechanism, code path or comment policy was replaced.

**6. Validation and Remaining Technical Debt**

- `pnpm --filter @1002bot/visualization typecheck`: passed.
- `git diff --check`: no whitespace errors.
- `git diff --unified=0` confirmed every canvas change is a comment.
- Full suite and browser checks were not rerun for this comment-only round; the existing 13 pre-existing package failures are unchanged.

## 2026-11-04 — Canvas comment taxonomy correction

**1. Problems Fixed**

- The first pass used multi-line English module headers and `//` for a module-level function contract. That mixed `src/agent`'s three roles: module header, declaration contract and in-function logic note.
- Two `//` notes restated conditions already visible in dependency arrays or cache comparisons.

**2. Functions, Algorithms, and Mechanisms Changed**

- None in production. Module headers are one English line each and name the module subject, ownership and boundary.
- `/** ... */` now carries declaration contracts on `contentOf`, `replaceContent`, `TransitionPreview`, `SceneState` and `CanvasSessionState`.
- `//` notes are limited to function-body ordering, fallback, persistence and ownership rules.

**3. Files Modified**

- `src/react/canvas/use-canvas-controller.ts`, `use-canvas-scene.ts`, `use-workspace-session.ts`, `use-drag-profile.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-canvas-comments.md`
- This report.

**4. Complexity Assessment**

- Comment-only diff; no runtime branch, state, cache or type change.
- Removed two restatements; added four new declaration contracts. No new abstraction or narration.

**5. Legacy Mechanism Cleanup**

- None. No code path or comment policy was replaced; the previous entry remains as history.

**6. Validation and Remaining Technical Debt**

- `pnpm --filter @1002bot/visualization typecheck`: passed.
- `git diff --check`: no whitespace errors.
- `git diff --unified=0` confirmed every canvas change is a comment.
- Full suite and browser checks were not rerun for this comment-only round; the existing 13 pre-existing package failures are unchanged.

## 2026-11-04 — Components directory split

**1. Problems Fixed**

- `components/README.md` named `../styles/canvas.css` twice in its Owner list.
- The flat components directory mixed rendered geometry, controls, detail panels and snapshot UI, so ownership was not visible from the path.

**2. Functions, Algorithms, and Mechanisms Changed**

- None in production. Moved ten files into `primitives/`, `controls/`, `panels/` and `snapshot/`; root keeps `change-badge.tsx`, `icon.tsx` and `README.md`.
- Rewrote only relative imports whose depth changed. Updated `VisualizationCanvas.tsx`, `use-canvas-scene.ts`, `routing-lab.tsx` and the architecture-boundary expectation.
- Added the directory layout to `components/README.md` and corrected its Owner list; the package README names the four groups.

**3. Files Modified**

- `src/react/components/primitives/{nodes,relation-edge,ports}.tsx`
- `src/react/components/controls/{top-actions,canvas-controls,selection-tools}.tsx`
- `src/react/components/panels/{connection-panel,transition-panel}.tsx`
- `src/react/components/snapshot/{snapshot-menu,snapshot-dialog}.tsx`
- `src/react/VisualizationCanvas.tsx`, `src/react/canvas/use-canvas-scene.ts`, `playground/src/routing-lab.tsx`
- `src/react/components/README.md`, `README.md`, `tests/architecture/boundaries.test.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-components-split.md`
- This report.

**4. Complexity Assessment**

- No runtime complexity change. The split adds one path segment per moved import and no barrel, wrapper or new abstraction.
- Root keeps the two shared primitives rather than inventing a `shared/` directory for two files.

**5. Legacy Mechanism Cleanup**

- Removed the flat component locations from all imports. The architecture test now expects the `primitives/` paths.
- No compatibility re-export was added.

**6. Validation and Remaining Technical Debt**

- Package typecheck passed.
- Package build passed; dist check reported 170 artifacts.
- Architecture tests 5/5 passed.
- Full package suite: 399 passed, 13 failed. The failures are the pre-existing card-size, growth, grouping, layout-intent and project-data baseline; no new failures.
- Headless Edge smoke on `http://127.0.0.1:5199/` (existing Vite server): stage `16d69bf0`, Structure view, 11 nodes, 6 edges, 6/6 routes, no notice.
- `git diff --check` passed.

## 2026-11-04 — Component comments

**1. Problems Fixed**

- Components had short English headers and only a few Chinese component comments; props interfaces, helpers and non-obvious rendering rules were unmarked.

**2. Functions, Algorithms, and Mechanisms Changed**

- None in production. Added one English module header per file, Chinese `/** */` declaration contracts and `//` logic notes.
- Comments cover slot fractions, hidden labels, pagination clamping, colon splitting, terminal badges, focus containment, portal targets and confirmation freshness.

**3. Files Modified**

- `src/react/components/change-badge.tsx`, `icon.tsx`
- `src/react/components/primitives/{nodes,relation-edge,ports}.tsx`
- `src/react/components/controls/{top-actions,canvas-controls,selection-tools}.tsx`
- `src/react/components/panels/{connection-panel,transition-panel}.tsx`
- `src/react/components/snapshot/{snapshot-menu,snapshot-dialog}.tsx`
- `docs/agent-context/current-task/2026-11-04-visualization-components-split.md`
- This report.

**4. Complexity Assessment**

- Comment-only diff; no runtime branch, state or prop change.
- Comments stay limited to contracts the code cannot show; no per-field translation.

**5. Legacy Mechanism Cleanup**

- None. No code path or comment policy was replaced.

**6. Validation and Remaining Technical Debt**

- Package typecheck passed.
- `git diff --check` passed.
- Line review confirmed this pass only changed comments. The import-path lines in the working diff belong to the uncommitted directory split.
- Build, full suite and browser smoke were not rerun for this comment-only round; the preceding split round reported 170 artifacts, 399 passing tests with 13 pre-existing failures, and a clean 11-node/6-edge browser smoke.

## 2026-11-04 — Persistence comments

**1. Problems Fixed**

- Persistence modules had short headers and only a few comments; backup order, final-write behavior, write-queue recovery and migration defaults were unmarked.

**2. Functions, Algorithms, and Mechanisms Changed**

- None in production. Added one English module header per file, Chinese `/** */` contracts on storage factories, normalization helpers, schema checks and backup constants.
- Added Chinese `//` notes for duplicate IDs, frozen-member uniqueness, confirmation/checkpoint consistency, queue failure handling and order-insensitive comparison.

**3. Files Modified**

- `src/react/persistence/local-storage.ts`, `workspace-schema.ts`, `project-storage.ts`, `storage-session.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-persistence-refactor.md`
- This report.

**4. Complexity Assessment**

- Comment-only diff; no runtime branch, state, error text or API change.
- Comments stay limited to contracts the code cannot show; no per-field translation.

**5. Legacy Mechanism Cleanup**

- None. No code path or comment policy was replaced.

**6. Validation and Remaining Technical Debt**

- Package typecheck passed.
- Persistence tests: 17/17 passed.
- `git diff --check` passed; line review confirmed this pass only changed comments.
- Build, full suite and browser smoke were not rerun for this comment-only round.

## 2026-11-04 — Card layout migration boundary

**1. Problems Fixed**

- Legacy card-size normalization ran inside `makeContent`, so view switching, stage switching and undo/redo could re-run the relaxation/conflict path.
- No runtime behavior changes to routing, labeling, snapshot merge or the current-spec layout.

**2. Functions, Algorithms, and Mechanisms Changed**

- Added `migrateRestoredViews`; it runs once from the workspace-session initial state and migrates stored views with a matching baseline.
- `makeContent` now restores nodes/frozen groups and validates routes only; it no longer calls `normalizeCardLayout`.
- Migration compares normalized frames with saved frames, skips current-spec views, updates only existing node IDs, leaves confirmed snapshots literal and does not create Undo entries.
- Frozen/locked cards remain unchanged.

**3. Files Modified**

- `src/react/canvas/use-workspace-session.ts`
- `tests/integration/card-layout-migration.test.ts` (new)
- `docs/agent-context/current-task/2026-11-04-visualization-card-migration.md`
- This report.

**4. Complexity Assessment**

- Removed one runtime normalization call from every `makeContent` read; the migration now has one recovery-boundary entry point.
- Added four focused tests plus the frozen-card case; no new state layer or framework.
- Diff in the production file: 50 insertions, 12 deletions.

**5. Legacy Mechanism Cleanup**

- Removed the runtime card-size migration responsibility from `makeContent`.
- Preserved `normalizeCardLayout` as the single existing implementation, now used at recovery.

**6. Validation and Remaining Technical Debt**

- Baseline: 412 tests, 399 passed, 13 failed; final: 417 tests, 404 passed, 13 failed; failure set identical, typecheck passed.
- Browser acceptance covered old/current workspace load, persistence, reload, M2 stage switch, expand/collapse, drag, undo/redo and frozen state.
- Remaining risk: migration executes for every restored view at mount; confirmed legacy snapshots may require re-confirmation after draft geometry changes. No routing/labeling behavior touched.

## 2026-11-04 — Stage roundtrip frame preservation

**1. Problems Fixed**

- Returning M1 -> M2 -> M1 without source or user edits shrank `agent` from `480x390` to `288x208` and shifted `test-agent` by 12 pixels.
- The drift came from classifying a target-only baseline node as newly added, then refitting its parent.

**2. Functions, Algorithms, and Mechanisms Changed**

- `stage-transition.ts` now classifies placements from the target stage's `nodeChanges`: only `added` and `replaced` nodes are placed.
- Removed the reverse `diffStages` calculation for additions and its fallback branch.
- Existing draft reuse, source-revision merge, `finalizeMerged`, frozen/locked validation and persisted geometry remain unchanged.

**3. Files Modified**

- `src/react/model/stage-transition.ts`
- `tests/integration/stage-roundtrip.test.ts` (new)
- `docs/agent-context/current-task/2026-11-04-visualization-stage-roundtrip.md`
- This report.

**4. Complexity Assessment**

- Production diff: 4 insertions, 7 deletions; one target-mark predicate replaces a reverse diff and two sets.
- No new state, fallback, cache or compatibility layer.
- The regression test covers M1 -> M2 -> M1 for `overview` and `structure`.

**5. Legacy Mechanism Cleanup**

- Removed the reverse-diff addition check from `planStageTransition`.
- Kept the target `nodeChanges` contract as the single source for added/replaced placement.

**6. Validation and Remaining Technical Debt**

- Related stage/P4 tests: 22/22 pass.
- Full package suite: 418 tests, 405 passed, 13 failed; failure set identical to baseline; typecheck passed.
- Edge acceptance: M1 -> M2 -> M1 and reload preserve `agent` at `480x390`; no error; expand/collapse, drag/undo and freeze entry remain error-free.
- Remaining: the `full` view has an existing `input-channel` no-space conflict on first entry to M2; full view is outside this round's roundtrip assertion.

## 2026-11-04 — Stage layout inheritance priority

**1. Problems Fixed**

- Full view first entry failed because target `positions` were used for additions but inherited source-auto nodes kept old positions. Runtime grew while provider stayed at y=360, producing `Runtime / Provider` and no-space.
- Applying target positions to every inherited node caused Structure round-trip drift; applying none caused Full no-space.

**2. Functions, Algorithms, and Mechanisms Changed**

- `stage-transition.ts` now applies target `positions` only to free source-auto nodes with the same parent. `layoutEdits.position`, frozen, locked/fixed and parent changes stay protected.
- Source automatic reflow is recognized when source content has an expansion/type change; fixed/locked nodes do not inherit target positions.
- `placement.ts` passes target `preferredPositions` to authored candidates and uses `preserveFrames=true` only in `placeAuthoredAdditions`.

**3. Files Modified**

- `src/react/model/stage-transition.ts`
- `src/react/model/placement.ts`
- `tests/integration/stage-roundtrip.test.ts`
- `docs/agent-context/current-task/2026-11-04-visualization-layout-inheritance.md`
- This report.

**4. Complexity Assessment**

- Production diff: 19 insertions, 1 deletion in stage transition; 2 changed lines in placement; test additions cover Full, source user position and automatic expansion reflow.
- No new state, persistence field, fallback or manager.
- Target positions remain local to target candidates/drafts; source content is unchanged.

**5. Legacy Mechanism Cleanup**

- No mechanism deleted. The existing `layoutEdits`, `layoutMode`, `target.positions`, `nodeChanges`, target draft and collision validator are reused.

**6. Validation and Remaining Technical Debt**

- Full first entry: runtime `1052x900`, additions at target positions, no no-space.
- Structure and Full M1 -> M2 -> M1 preserve frames; source user, fixed/locked and frozen positions remain protected.
- Full package suite: 421 tests, 408 passed, 13 failed; failure set identical to baseline; typecheck passed.
- Edge browser: Structure and Full round trips and reload pass.
- Remaining: source positions deviating from baseline without a position edit or expansion/type marker are conservatively protected; a future automatic reflow producer would need explicit provenance.

## 2026-11-06 — Model dependency boundaries

**1. Problems Fixed**
Four runtime cycles coupled grouping to spacing, visibility to placement, placement to freeze orchestration, and stored routes to frozen capture.

**2. Functions, Algorithms, and Mechanisms Changed**
Layout owns node primitives, sibling reflow, visibility and frozen frame geometry. The stage supplies frozen frame dimensions. Routing owns boundary fragments and connectors. The architecture test checks import direction and runtime cycles.

**3. Files Modified**
Grouped the React model, moved its unit tests with their owners, and updated React exports, callers, tools and owner documentation.

**4. Complexity Assessment**
The dependency graph is acyclic. Existing algorithms, caches, workspace storage contracts and the runtime node type are preserved.

**5. Legacy Mechanism Cleanup**
Retired flat import paths and the spacing re-export. Public React exports resolve directly to their owners.

**6. Validation and Remaining Technical Debt**
422 package tests, both type checks, distribution build (182 artifacts), and Playground build passed. Isolated Edge exited before CDP was ready. Storage ownership remains for the fourth batch.

## 2026-11-06 — Shared route resolution

**1. Problems Fixed**
Canvas and stage flows assembled routes independently and used different port policies. Retained connectors could skip unrelated locked barriers.

**2. Functions, Algorithms, and Mechanisms Changed**
resolveRoutes composes caller-owned engines and emits legal paths or structured failures. Current port anchors, segment legality and protected geometry are checked across solving, reuse and final application.

**3. Files Modified**
Routing engines and snapshots, frozen boundary connector, canvas scene, stage navigation and transition, and port/stage integration tests.

**4. Complexity Assessment**
One route assembly path replaces three. Both engine caches retain independent invalidation. The resolver stores no state between calls.

**5. Legacy Mechanism Cleanup**
Removed the extra selection module, duplicate geometry and handle parsing, and the WeakSet used to bypass route reservations.

**6. Validation and Remaining Technical Debt**
420 package tests, type checks, distribution and Playground builds passed. Full repository tests hit QQ subprocess and temporary Git permission failures. Edge verification remains pending.

## 2026-11-06 — Path and label ownership

**1. Problems Fixed**
Obsolete label algorithms and placeholder geometry obscured ownership of the final placement.

**2. Functions, Algorithms, and Mechanisms Changed**
LabelLayoutCache is the placement owner. Route results carry geometry, handles and path diagnostics. Snapshot capture takes actual placement separately and preserves existing label fields.

**3. Files Modified**
Label algorithms, both routing engines, route quality, snapshot and freeze capture, scene/controller, Playground and benchmark.

**4. Complexity Assessment**
Removed label-only branches in routing, the labelled route copy of each frame, and a test-only freeze capture path.

**5. Legacy Mechanism Cleanup**
Deleted placeEdgeLabel, candidate/beam modules and route-side placeholder metrics. Migrated baseline, recursive and frozen path coverage to their production entry points.

**6. Validation and Remaining Technical Debt**
403 package tests, package and Playground type checks, distribution build (180 artifacts), and Playground build passed. Browser verification remains pending.

## 2026-11-06 — Snapshot contracts and intent authority

**1. Problems Fixed**

Confirmation and stage inheritance compared fitted geometry through separate rules. Workspace also owned storage contracts and project conversion.

**2. Functions, Algorithms, and Mechanisms Changed**

The shared intent comparison uses authored position and sizes, effective legacy geometry, protected anchors, frozen ledgers, protected paths and label pins. Stage merging keeps the current upstream automatic route seed. History retains the previous stage basis when a rebase changes metadata alone.

**3. Files Modified**

Separated snapshot, layout and label contracts. Workspace owns capture, restore, confirmation and history. Persistence owns the storage interface and project conversion. Public React exports retain their names. The route attachment check uses one anchor resolver for both directional and Group slot handles.

**4. Complexity Assessment**

Removed duplicate comparison logic and the overlay's unused React state. The serialized format and historical confirmation content are preserved. The runtime node type and engine caches retain their ownership.

**5. Legacy Mechanism Cleanup**

Removed the unused overlay initializer. Historical overlay payloads remain readable and writable. Captured automatic paths and fitted frames remain recovery data.

**6. Validation and Remaining Technical Debt**

406 package tests and 242 repository tests passed. Repository, package and Playground type checks passed. Distribution build verified 192 artifacts and the Playground build passed. Isolated Chromium verified label pinning and reload, locked Group port fallback, drag undo and redo, conflict preview, M1 to M2 inheritance and reload. The transient React Flow handle warning for event-agent also reproduces on 7cbe3ff. Both runs show 14 nodes and 13 paths after switching.
