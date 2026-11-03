# Authored incremental placement and container fitting

## Intent

Fix root additions intersecting an inherited expanded Runtime, authored drag/expansion rejecting available parent growth, and responsibility cards failing inside spacious parent regions. Keep user expansion state and inherited content anchors; only additions receive new placement. Fit affected ancestors in all directions with existing growth ceilings and child coordinate compensation, without moving unrelated neighbours. Collapsed parents remain collapsed during stage changes. Preserve routing protection and atomic failure.

Verify current user geometry through the native browser, especially Console outside Runtime and FixtureWorld nested expansion. Use type/build checks; no automated test suites or performance benchmarks. Preserve pre-existing edits and deleted historical screenshot files.

## Result — 2026-11-03

- Authored expansion, drag and incremental placement share `fitAuthoredLayout`. It refits affected expanded ancestors in four directions, compensates child coordinates, respects the existing finite growth baseline, and leaves unrelated components in place. Manual groups remain eligible for fitting without an expansion flag.
- New visible stage nodes search existing gaps before finite growth. Expanded frames block their complete rectangle for unrelated additions. Collapsed ancestors remain collapsed and hidden additions retain authored local coordinates. A responsibility card becoming a container resets its natural baseline to the target authored dimensions.
- FixtureWorld's saved local y was 152.662px. Its expanded 260px height plus 24px bottom inset required 436.662px in a World frame saved at 390px. The former authored branch rejected that overflow before fitting the parent.
- Native browser on the user's saved M1 workspace: FixtureWorld expansion grew World from 390px to 436.662px; collapse shrank it to 272.662px. World and FixtureWorld origins stayed unchanged. Undo restored the complete pre-collapse node geometry. Refresh restored the expanded card and parent size; closing/reopening World retained its nested expansion.
- Native isolated page used the same project adapter and actual M1/M2 assets without persistence. M1 Runtime was moved to (0,250) to cover Console's authored M2 position. After fixing all six visible M1 nodes and confirming, M2 succeeded with inherited root origins unchanged; Console was placed at (-344,250), outside Runtime (0,250,996,444). InputChannel and InputRun remained inside Runtime and collapsed; other modules retained their collapsed state.
- The user's existing M2 draft reports three-way merge conflicts for Runtime size and World position after upstream edits. Its original saved content remains intact; candidate preview was cancelled. This is separate from new-stage no-space placement. In the isolated layout, expanding InputRun into the fixed World frame correctly rejected the overlap and preserved the prior state.
- Verification: package and browser TypeScript checks, all three dataset snapshot IDs, library build (154 artifacts), site build, and diff whitespace check passed. No automated test suites or performance benchmarks were run. No commit or push. Pre-existing edits and historical screenshot deletions were preserved.
- Browser evidence: `.scratch/visualization-world-expansion.png`. Isolated native verification entry: `packages/visualization/playground/.scratch/placement-preview.html`; it is ignored and not a site build entry.
- Archive: `docs/agent-context/finish-task/2026-11-03-visualization-authored-placement-snapshot/2026-11-03-visualization-authored-placement.md`; copied byte-for-byte with SHA-256 verification.
