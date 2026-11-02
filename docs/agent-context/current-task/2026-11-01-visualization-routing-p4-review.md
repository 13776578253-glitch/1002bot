# Visualization routing P4 review

## Findings

1. **Drag switches engines.** `use-canvas-scene.ts` marks the group attempt ineligible while `dragging`; the rendered routes fall through to the legacy cache on the first drag frame. `use-canvas-controller.ts` bumps `routingRevision` on release, so the group cache performs a cold/full solve and can jump again. This is the main source of first-frame and release discontinuities.
2. **Release full solve is unnecessary.** The group cache already computes per-group signatures, reserves unchanged routes and can update dirty groups plus shared-node neighbors. A revision bump deliberately defeats that reuse. P4 should keep the group engine active during drag and let the incremental cache decide; a full solve should remain an explicit cache capability, not a release side effect.
3. **Snapshot source mismatch.** `snapshotRoutes` re-runs `solveRouteGroups` (group branch) or `cache.update` (legacy branch). A save can therefore capture a different solution from the visible route map. Snapshots must be derived from the current visible `routes` map and the same projection/barriers/policy.
4. **Switch continuity.** When the group engine becomes ineligible (pinned/locked/frozen/aggregated), the legacy cache re-routes from its own previous state, not from the visible group paths. Seed the legacy cache once with the last visible group routes so the engine switch does not discard the user's current paths. The group engine still does not own frozen groups or manual paths in P4.
5. **Atomicity and identity.** The group cache mutates only its own records and returns a pure outcome. Unchanged groups must keep route object identity. A failed incremental solve currently falls back to a full solve, which can change unaffected objects; keep this as an explicit fallback and verify no partial workspace commit occurs.

## Planned changes

- Remove `dragging` from group ineligibility; update the group cache on drag frames. Remove the controller/scene `routingRevision` release bump. Keep `revision` in the cache API for explicit full solves.
- Add an optional seed map to `DiagramRouteCache.update`; on a group-to-legacy transition pass the last visible routes once. Reindex seeded routes.
- Make `snapshotRoutes` capture the visible route map; no solve inside the snapshot path.
- Add a P4 fixture with three stages, three views, a nested container, pinned/locked routes, a frozen group and a relation added in the last stage. Add model regression tests for confirmation, restore, inheritance, undo and refresh consistency, plus a route cache seed test.
- Browser regression: group engine stays active through drag and release, path continuity, snapshot/refresh consistency, `space-exhausted` hover, and a many-Handle stress view.
