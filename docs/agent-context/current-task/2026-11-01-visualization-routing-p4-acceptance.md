# Visualization routing P4 acceptance

## Result

P4 keeps the group engine active through drag and release, removes the release-time full solve, seeds the legacy cache from the visible group routes on an engine switch, and captures snapshots from the visible route map. The full multi-stage/nested/pinned/locked/frozen fixture and browser regression pass.

## Source changes

- `use-canvas-controller.ts` / `use-canvas-scene.ts`: removed `routingRevision`; group routing is no longer disabled while dragging. A previous group render seeds the legacy cache once when the next render must fall back.
- `route-cache.ts`: optional `seed` map. Seed routes override the previous routes for one update, are indexed, and keep object identity afterwards.
- `route-groups.ts`: exported `buildRouteGroups` and an explicit `groups` input for incremental group solves; hidden labels retain a fallback box.
- `group-route-cache.ts`: no incremental-failure full reallocation. Failed incremental solves return `mode: failed` and leave cached records intact; the canvas falls back to seeded legacy routes. The solver is injectable for the failure test.
- `use-canvas-scene.ts`: `snapshotRoutes` now calls `captureDisplayRoutes` with the visible `routes`, projection, barriers and policy. It never solves during capture.

## Fixture and model tests

`tests/fixtures/project-p4.ts` contains three stages and three views, nested `engine → inner → worker`, and relations added at `s1` and `s2`. `tests/fixtures/p4-content.ts` adds a pinned `invoke-view`, a locked `persist-view`, and a frozen `inner-view`.

`tests/integration/p4-fixture.test.ts` covers:

1. Stage adaptation and nested parentage.
2. Pinned, locked and frozen content restoring with no conflicts.
3. `s0 → s1 → s2` transitions preserving anchors and frozen/manual paths while adding `archive-view` and `read-view`.
4. Atomic failure when a frozen member disappears; source content is byte-for-byte unchanged.
5. `prepareStageNavigation` reuse of a saved nested/frozen view and an atomic divergent-edit conflict.
6. Confirmation persistence, reload, display/frozen route equality, refresh layout and undo/redo values.

`tests/group-route-cache.test.ts` covers unchanged hits, 1/2-group incremental updates with route identity, successive drag positions without revision, failed incremental without a full call, revision full solves and shared-node invalidation. `tests/route-cache-seed.test.ts` covers seed replacement, retained identity and subsequent movement.

## Browser acceptance

Main app `?routing=group`, headless Edge:

- Initial `group / full:0/1`; drag first frame `group`, no fallback, no path diff; middle/last frames `group / incremental:0/1`; release `group / incremental:0/1`.
- `initialToFirst: []`, `lastToReleased: []`; only the moved edge changed between first and last.
- Pin: `legacy / protected-routes`, fallback notice visible, path diff `[]`. Unpin: `group / hit:1/1`, path diff `[]`.
- Reload: `group / full:0/1`, path diff `[]`, node transforms equal.
- Legacy URL: path diff `[]`; group again: path diff `[]`; no console exceptions.
- Main canvas: 264 total handles, 216 slot handles.

Routing lab `?lab=routing`:

- 36 nodes, 1,584 handles (1,296 slot), mount ~216 ms in headless Edge.
- Hidden label initially absent; edge hover reveals `data-label-state="revealed"`; leaving hides it; no console exceptions.

## Gates

- Package tests 300/300; root tests 242/242.
- Typecheck (app + web), package build 150 artifacts, web build, snapshot check.
- Worktree clean after the P4 commit.

## Limitations

- The group engine still does not natively own frozen groups or pinned/locked paths; it falls back to legacy as required. The seed covers group→legacy; geometry edits made while legacy and then returning to group may re-solve changed groups.
- Full group solves remain available for cold start, explicit revision and node-set changes; the canvas no longer bumps revision on release.
- Browser performance is measured in headless Edge on this machine, not production hardware.
- Snapshot capture uses the last visible render's routes and nodes; it intentionally does not advance the solver during save.
