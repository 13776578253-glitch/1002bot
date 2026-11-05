# Card layout migration boundary

## Intent

Move legacy card-size normalization out of `makeContent` runtime reads and into the workspace storage recovery boundary.

- Keep current-spec views untouched.
- Preserve user drafts, confirmed snapshots and Undo/Redo semantics.
- Reuse `normalizeCardLayout`; add no migration framework, state layer or fallback.
- Do not modify Routing, Group Solver, Legacy, Labeling or Snapshot Merge algorithms.

## Result

- Added `migrateRestoredViews` in `use-workspace-session.ts`; it runs once in the initial state and migrates every stored view that has a matching baseline.
- `makeContent` no longer calls `normalizeCardLayout`; it only restores nodes/frozen groups and validates stored routes.
- Migration compares normalized frames with the saved frames. Current-spec views are not rewritten.
- Only existing saved node IDs are updated; source-added nodes are not written into the draft by migration.
- Confirmed snapshots remain literal. A changed draft sets `requiresConfirmation` only when it no longer matches confirmed content.
- Migration does not create an Undo entry and does not write storage by itself.
- Old frozen/locked cards are left unchanged.
- Removed the runtime normalization call from `makeContent`; the same `normalizeCardLayout` implementation is now used only at recovery.

## Baseline and verification

- Baseline before change: 412 tests, 399 passed, 13 failed; typecheck passed.
- Final: 417 tests, 404 passed, 13 failed; failure set is identical to baseline; typecheck passed.
- New tests: 5 cases covering old-spec migration, idempotence, current-spec skip, confirmed snapshot semantics, frozen geometry and all three views.
- Browser acceptance with Edge:
  - Old-spec workspace: cards render 240x80 after load; migrated sizes persist after view switch and reload.
  - Current-spec workspace: cards stay 240x80 without reflow.
  - M2.0 stage switch succeeds; cards remain 240x80.
  - Structure expand/collapse, drag, undo and redo work with no error text.
  - Freeze marks the selected subgraph and shows the frozen state; no migration-related conflict.

## Risks

- Migration runs for every restored view at mount; this is bounded by stored views but not lazy.
- A migrated draft compared with a legacy confirmed snapshot may set `requiresConfirmation`; this is intentional because the draft geometry changed.
- Route/label caches are unchanged; no routing or labeling behavior was touched.
