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
