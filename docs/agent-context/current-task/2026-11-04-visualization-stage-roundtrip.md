# Stage roundtrip frame preservation

## Intent

Remove frame drift when returning to a stage with no source revision and no user edit, without changing stage inheritance, three-way merge, confirmation semantics or persisted geometry.

## Root cause

`planStageTransition` classified added nodes from a reverse `diffStages(source, target)`. A target-stage baseline node that was absent from the source content could therefore be treated as newly added even when the target's own `nodeChanges` marked it as `baseline`.

For M2 -> M1, `test-agent` is present in M1 but absent from M2. The reverse diff marked it added; `placeAuthoredAdditions` then called `fitAuthoredLayout`, shrinking `agent` from `480x390` to `288x208` and shifting `test-agent` by 12 pixels.

`finalizeMerged` is not on this path. It only runs for an existing draft that needs merge/rebase; an unchanged inherited draft is reused, and first entry returns the `planStageTransition` result directly.

## Result

- `addedNodeIds` now uses the target stage's own `nodeChanges`: only `added` and `replaced` enter placement.
- Removed the reverse `diffStages` call, `diffAdded`, `diffReplaced` and the fallback branch. The target change marks are the single semantic source.
- Existing valid drafts keep the `reused` path; source revisions still merge and call `finalizeMerged` with the existing geometry checks.
- No changes to `confirmation.ts`, frame persistence, `expansionSizes`, `reflowOrigin` or the frozen ledger.

## Verification

- New regression: `tests/integration/stage-roundtrip.test.ts` covers M1 -> M2 -> M1 for `overview` and `structure`; it failed before the fix and passes after it.
- Related stage/P4 tests: 22/22 pass.
- Full suite: 418 tests, 405 passed, 13 failed; failure set identical to the baseline; typecheck passed.
- Edge acceptance: M1 -> M2 -> M1 and reload preserve `agent` at `480x390`; `test-agent` returns; no error; expand/collapse, drag/undo and freeze entry remain error-free.
- Browser setup removed the M2 structure draft so the forward transition was a real first entry.

## Risks

- The `full` view has an existing `input-channel` no-space conflict on first entry to M2. It predates this fix and is outside this round; full view could not be included in the roundtrip assertion.
- The fix relies on target `nodeChanges` coverage. All current datasets contain marks for every non-root target node; targets without marks no longer fall back to the reverse diff.
- Legitimate source revisions still re-fit through `finalizeMerged`; that behavior was intentionally left unchanged.
- The change is limited to the added-node classification in `stage-transition.ts`.
