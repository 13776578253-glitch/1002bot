# Persistence validation refactor

## Intent

Split persisted workspace schema validation from the localStorage adapter without changing production behavior.

Phase 1 only establishes the behavior baseline:

- Lock `checkNodeViews` error precedence, especially duplicate-ID errors winning over per-node shape errors.
- Lock `save()` ordering and side effects: validate the view first, write the uniform-card backup, parse and validate the previous record, optionally write the three-view backup, then write the new record.
- Lock reader field preservation, reference/copy behavior and migration results, including the display-route label-attachment stripping rule.
- Confirm `normalizeWorkspaceView` and `assertWorkspaceView` remain module-level internals, not package exports.
- Record the current overlay validation gap without changing it.

No production files are modified in this phase. Reader size, nesting depth and file length are not acceptance targets. Later phases must move code unchanged before simplifying it, keep `checkNodeViews` behavior, keep `save()` semantics, and avoid fallbacks or compatibility patches for refactor regressions.

## Result

Phase 1 is test-only.

- Added `src/react/persistence/__tests__/workspace-normalization.test.ts`: duplicate-ID error precedence, hierarchy cycles and missing parents, field/reference preservation, display-route attachment stripping, v1 migration, three-view consistency, `assertWorkspaceView`, and the recorded overlay gap.
- Added `src/react/persistence/__tests__/local-storage.test.ts`: backup order, three-view backup trigger, existing-backup protection, invalid-view short circuit, malformed previous JSON/workspace side effects, final write failure, and load behavior.
- Updated the package test glob to include persistence unit tests.
- Added an architecture test confirming `normalizeWorkspaceView` and `assertWorkspaceView` stay out of the React public entry.
- Recorded the overlay element-level validation gap without changing behavior.

Verification:

- New persistence tests: 16/16 passed.
- `pnpm --filter @1002bot/visualization typecheck`: passed.
- Full package suite: 398 passed, 13 failed. The 13 failures are the pre-existing card-size, four-side-growth, grouping, layout-intent and project-data expectations; the new tests and the architecture test passed in the same run.
- No production files changed in this phase.

## Phase 2 Result

- Moved the existing schema validation and migration code from `local-storage.ts` to `workspace-schema.ts` without changing its logic.
- `workspace-schema.ts` now owns `normalizeWorkspaceView`, `assertWorkspaceView`, all content readers, and v1/v2 migration. It has no storage imports.
- `local-storage.ts` is recreated with only `createLocalStorageViewStorage`; the backup order, trigger conditions and exception side effects are unchanged.
- Updated internal imports in `VisualizationCanvas.tsx`, `project-storage.ts`, persistence tests, label tests, and the model README owner list.
- The React public entry is unchanged: it still exports `createLocalStorageViewStorage`, and normalization helpers remain internal.

Verification:

- Package typecheck passed.
- Persistence tests: 16/16 passed.
- Architecture tests: 5/5 passed.
- Full package suite: 398 passed, 13 failed. The same pre-existing card-size, growth, grouping, layout-intent and project-data failures remain; no new failures.
- No behavior changes and no fallback or compatibility shim was added.

## Phase 3 Result

- Consolidated repeated reader checks in `workspace-schema.ts`:
  - named the repeated error messages instead of duplicating literals;
  - added `optionalText`, `checkRectFields`, `checkBounds` and `checkBaseline`, each used by at least two readers;
  - kept `checkNodeViews` two-pass so duplicate-ID errors stay ahead of node-shape errors;
  - normalized display-route validation to check the record before its optional policy fields, with the same messages and ordering;
  - kept the display-route label-attachment stripping rule unchanged.
- `normalizeV2` now reads optional confirmation fields through `optionalText`, while preserving cross-field validation order and output fields.
- No field, reference/copy, migration, storage or public API behavior changed.

Complexity:

- Diff: 81 insertions and 49 deletions, +32 net lines.
- Repetition decreased: seven repeated error literals were named, three rect/label loops and two bounds checks were centralized.
- The additional lines are shared helpers and invariant comments, not a new abstraction layer or manager.
- `checkEdgeRoutes` endpoint checks intentionally remain in their original order to preserve error behavior.

Verification:

- Package typecheck passed.
- Persistence tests: 16/16 passed.
- Architecture tests: 5/5 passed.
- Full package suite: 398 passed, 13 failed. The same pre-existing card-size, growth, grouping, layout-intent and project-data failures remain; no new failures.

## Phase 4 Result

- Finalized the storage adapter:
  - named the two backup suffixes instead of repeating literals;
  - renamed the local three-view backup variable;
  - documented the load failure contract and the save backup order in Chinese;
  - added a test that locks the exact read/write sequence for the two one-time backups.
- Backup trigger conditions, read/write order and exception side effects are unchanged.
- `local-storage.ts` remains a storage-only adapter of about 38 lines; validation stays in `workspace-schema.ts`.

## Overall Result

Added:

- `src/react/persistence/workspace-schema.ts`: schema validation and v1/v2 migration with no storage access.
- Persistence unit tests: 17 cases covering error precedence, field/reference behavior, migration, display-route attachment stripping, backup order and side effects.
- Architecture test: persistence normalization stays internal to the React entry.
- Shared schema helpers: `optionalText`, `checkRectFields`, `checkBounds`, `checkBaseline`; named error and backup constants.

Removed:

- Schema validation, migration and view consistency logic from `local-storage.ts`.

Replaced:

- Persistence normalization imports now target `workspace-schema.ts`; the storage adapter no longer exports schema internals.

Complexity and behavior:

- `local-storage.ts`: 364 lines before, about 38 after.
- `workspace-schema.ts`: about 371 lines after moving and consolidating readers.
- Total production lines increased by about 45 because shared helpers and invariant comments were added; repeated literals and repeated rect/bounds checks decreased.
- No new layer, manager, fallback or compatibility path. The React public API is unchanged.
- Behavior is unchanged: 399 tests pass and the same 13 pre-existing failures remain.

Verification final:

- Package typecheck passed.
- Persistence tests: 17/17 passed.
- Architecture tests: 5/5 passed.
- Full package suite: 399 passed, 13 failed; failure set matches the pre-existing baseline.
