# Draft/confirmed state fixes

## Intent

Minimal state-management repair in `packages/visualization` only. Do not refactor manual layout, `fixed/locked`, frozen subgraphs, three views or stage inheritance, and do not start P1/P2.

## Changes

- Added `confirmation.ts` to compare the current draft with its confirmed content. Node position, size, parent/group membership, stored edge routes, frozen groups and overlay changes invalidate confirmation; derived display routes do not. Legacy omitted layout fields normalize to their runtime defaults.
- `use-workspace-session.ts` now derives confirmation status and `getConfirmedRevision()` from that comparison instead of trusting only the source revision and `requiresConfirmation`.
- Removed the implicit `views.current[...] = ...` write from the ordinary read path, and stopped calling `normalizeCardLayout` with `repairExisting = true`; reads now use the default size-migration-only path.
- Viewport-only saves and view/stage switches no longer call `storeCurrent()`, so normalized display geometry from a read cannot be persisted by those actions.
- `project-workspace.ts` no longer appends checkpoints on new confirmations. Existing checkpoint arrays are cloned through unchanged, and `project-storage.ts` accepts a confirmation without a matching new checkpoint while still validating existing checkpoint links.
- Snapshot dialog now distinguishes `已确认` from `有未确认修改`; the top view dots use the same comparison.
- The pin control tooltip is now `固定当前可见节点（与子图冻结不同）`.
- `UserGraphOverlay` remains in place and is documented as unenabled with no active controller or UI caller.

## Verification

- Isolated HEAD worktree (`fa630dc`): 334 tests, **334 passed, 0 failed**.
- Pre-P0 copy (current GPT work minus this P0): 334 tests, **297 passed, 37 failed**.
- Post-P0 worktree: 338 tests, **301 passed, 37 failed**. The failure set is unchanged apart from the renamed checkpoint test; **no new regression**.
- `pnpm --filter @1002bot/visualization typecheck` — passed.
- The remaining 37 failures are existing geometry/card-size, frozen-route, grouping and stage-inheritance fixture failures from the uncommitted three-view work, not P0.

P0 commit is isolated on branch `p0-state-fixes`; the prerequisite three-view baseline is a separate parent commit. Nothing was pushed. No P1/P2 work.
