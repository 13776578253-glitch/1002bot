# Visualization routing P4.1 integration closeout

## Scope

P4.1 is limited to integration hygiene: no new routing mode, no new solver behavior.

## Changes

1. **No legacy work on group success.** `use-canvas-scene.ts` computes the retained seed and legacy route cache only when the group result is incomplete. A complete group result reuses the group route map directly. Group-mode `routeStats` report `geometryMs`, `routingMs` and `labelMs` as 0; `durationMs` is the group solve time.
2. **Committed visible routes.** `lastRenderedEngine` and `lastVisibleRoutes` are updated in `useLayoutEffect`, not during render. A fallback uses the last committed group route map as the legacy seed.
3. **Snapshot geometry version.** `snapshotRoutes` captures `captureDisplayRoutes` from the same render's `nodes`, `projection`, `displayEdges` and `routes`; it never re-solves. `tests/display-route-version.test.ts` checks every snapshot's source/target bounds and points against that geometry/route version.
4. **Cold seed fix.** The browser pass exposed that a cold legacy cache ignored the seed because `policyChanged` and missing previous geometry forced a re-route. `route-cache.ts` now uses the current geometry fallback for seeded edges and permits seed reuse when the policy key is cold. The pinned/unpinned path diffs returned to `[]`.

## Browser evidence

`?routing=group`:

- Initial: `routeMs = groupMs`, `geometryMs=0`, `routingMs=0`, `labelMs=0`, routes `5/5`, cache `full:0/1`.
- Drag: first frame `group`, `initialToFirst: []`; mid/last `incremental:0/1`; release `lastToReleased: []`.
- Pin: `legacy / protected-routes`, path diff `[]`; unpin: `group / hit:1/1`, path diff `[]`.
- Reload: path diff `[]`, node transforms equal. Legacy URL: path diff `[]`; group again: path diff `[]`.
- Main canvas 264 total handles / 216 slot handles; no console exceptions.
- Routing lab remains 36 nodes / 1,584 handles / hidden-label hover.

## Tests and gates

- Package tests: 302/302.
- Root tests: 242/242.
- Package typecheck, web typecheck, package build, web build, snapshot check.
- New: `tests/display-route-version.test.ts`, cold seed case in `tests/route-cache-seed.test.ts`.

## Limitations

- Full group solves remain for cold start, explicit revision and node-set changes; the scene does not bump revision on release.
- Snapshot capture intentionally uses the last committed visible render, not a newer `nodesRef`.
- Performance remains headless-Edge evidence, not a production-hardware benchmark.
