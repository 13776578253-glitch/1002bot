# Stage layout inheritance priority

## Intent

Resolve the Full-view no-space conflict without making Structure round trips drift or overriding confirmed user/locked/frozen positions.

## Priority

1. Existing target draft (`targetSaved`) retains its positions.
2. Source protected geometry is preserved: `layoutEdits.position`, frozen, locked or fixed, and unusual parent changes.
3. Source automatic positions may use target authored `positions` when the target parent is unchanged.
4. Target additions use `nodeChanges` (`added`/`replaced`) and target `preferredPositions`.
5. Existing fit and collision checks remain authoritative; protected collisions still report a conflict.

Source automatic positions are positions without `layoutEdits.position` that either match the source baseline or differ only because a source expansion/type change caused automatic reflow. Fixed/locked/frozen and explicit position edits are never classified as automatic.

## Result

- `stage-transition.ts` applies target `positions` only to free, source-auto nodes with the same target parent.
- `placement.ts` consumes target `preferredPositions` for authored additions and preserves existing target frames while fitting. `preserveFrames=true` is limited to `placeAuthoredAdditions`; automatic placement and the global `fitAuthoredLayout` default are unchanged.
- Source content is not mutated; only the target candidate/draft is adjusted.
- No confirmation, frozen ledger, `expansionSizes`, `reflowOrigin` or persisted field changes.

## Verification

- Full first entry: runtime stays `1052x900`; `input-channel`/`input-run` are placed at target positions; no no-space.
- Structure M1 -> M2 -> M1 and Full M1 -> M2 -> M1 preserve frames.
- Source user position, `fixed`/`locked` and frozen geometry remain protected; the automatic expansion-reflow counterexample is covered.
- Full suite: 421 tests, 408 passed, 13 failed; failure set matches the baseline. Typecheck passes.
- Edge acceptance: Structure and Full round trips plus reload preserve expected frames; Full M2 shows runtime `1052x900` and both additions; no error text.

## Risks

- Source positions that deviate from baseline without a position edit or an expansion/type change remain conservatively protected. This avoids silently moving confirmed geometry, but a future automatic-reflow producer without such a marker would need an explicit provenance contract.
- `preserveFrames` prevents shrinking existing authored containers while placing additions; it still permits growth and collision validation.
- `full` view coverage now exercises the previously failing first-entry path; no Routing changes were made.
