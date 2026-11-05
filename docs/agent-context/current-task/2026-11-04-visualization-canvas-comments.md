# Canvas hook comments

## Intent

Apply the repository comment convention to `packages/visualization/src/react/canvas`:

- English module headers state each hook's role and boundary.
- Chinese annotations explain only non-obvious invariants, cache lifecycles and transaction ordering.
- No code, type or public API changes.
- `use-drag-profile.ts` already has a suitable English module header and no non-obvious contract requiring a Chinese annotation, so it is left unchanged.

## Result

- `use-canvas-controller.ts`: documented commit validation order, deferred navigation, freeze/route-state constraints, label-pin isolation, drag release and commit-frame capture.
- `use-canvas-scene.ts`: documented group-solver eligibility and fallback, complete-solution replacement, label cache fork/adopt, same-frame snapshots, stable edge/node caches, derived render state and guide clipping.
- `use-workspace-session.ts`: documented per-view baselines, authoritative draft refs, draft seeding, restore/normalization order, display-route cache invalidation, transaction boundaries, undo metadata, atomic three-view transitions, confirmation revision and viewport persistence.
- Comment-only diff: 43 insertions, 0 deletions. No code, type or signature changes.

## Verification

- `pnpm --filter @1002bot/visualization typecheck`: passed.
- Full package suite: 399 passed, 13 failed; the failure set is the same pre-existing card-size, growth, grouping, layout-intent and project-data baseline.
- `git diff --check` and a line-by-line diff check confirmed the canvas changes are comment-only.

## 2026-11-04 — Canvas hook comment refinement

### Intent

Align `packages/visualization/src/react/canvas` with the root `src/` comment convention:

- English appears only in the module header and states the module's ownership, boundary and core mechanism.
- Chinese marks only contracts that the code cannot show: ordering, failure semantics, cache lifecycles and metadata that stays outside persisted geometry.
- Remove narration that restates the following code; add no per-field translation.
- Comment-only change; no code, type or public API edits.

Planned coverage:

- `use-canvas-controller.ts`: preview read-only boundary, capture-before-commit order, drag intent versus automatic compensation, deferred finish flag, URL routing switch, edge-state ownership.
- `use-canvas-scene.ts`: reserved-path registration, complete group solution replacement, route label as snapshot carrier, fill order of connected nodes, cache identity rules.
- `use-workspace-session.ts`: history key isolation, content-versus-metadata separation, compatibility alias, reused transitions, save-before-read.
- `use-drag-profile.ts`: sample-on-change and single publication point.

### Verification Plan

- `pnpm --filter @1002bot/visualization typecheck`.
- `git diff --check -- packages/visualization/src/react/canvas`.
- Review the diff line by line to confirm every added or removed line is a comment.

### Result

- `use-canvas-controller.ts`: the module header now states the command boundary and commit-frame ordering. Annotations cover the URL routing switch, capture-before-commit, `finishRevision` versus `pendingFinish`, drag intent versus automatic compensation, resize fitting, parent derivation and aggregated-edge route ownership.
- `use-canvas-scene.ts`: the module header now states render derivation and the no-solve boundary for selection, hover and viewport. Annotations cover reserved-path registration, group-cache binding, Legacy timing zeroing, route labels as snapshot carriers, `connected` fill order, handler rebuild scope and node-cache identity.
- `use-workspace-session.ts`: the module header now states draft/history/confirmation/persistence ownership and ref-based reads. Annotations cover content/metadata separation, history isolation, the compatibility alias, reused transitions, save-before-read and migration messaging.
- `use-drag-profile.ts`: kept the existing header; annotations cover sample-on-change, single publication and separate constraint timing.

### Verification

- `pnpm --filter @1002bot/visualization typecheck`: passed.
- `git diff --check -- packages/visualization/src/react/canvas docs/agent-context/current-task/2026-11-04-visualization-canvas-comments.md`: no whitespace errors.
- `git diff --unified=0 -- packages/visualization/src/react/canvas`: every added or removed line is a comment; no code, type or signature change.
- Full suite and browser checks were not rerun for this comment-only round; the existing 13 pre-existing package failures are unchanged.

## Correction — comment taxonomy

Following `src/agent`, the three comment roles are now separated:

- Module header: one English `/** ... */` line naming the module subject, its ownership and boundary.
- `/** ... */`: declaration contracts only; used on module-level helpers and the input/state interfaces that carry a non-obvious content-versus-metadata or read-only boundary.
- `//`: function-body logic only; ordering, failure semantics, cache lifecycles and policies that the code cannot show.

Changes from the previous pass:

- Collapsed the three multi-line English headers to one line each; named the subjects `Canvas controller`, `Canvas scene`, `Workspace session` and `Drag profile`.
- Moved the module-level `contentOf` contract from `//` to `/** ... */`; added `/** ... */` to `replaceContent`, `TransitionPreview`, `SceneState` and `CanvasSessionState`.
- Removed two restatements of visible conditions (`groupCache` dependencies and `nodeCache` comparison fields).
- Kept the remaining Chinese `//` notes only where they state ordering, fallback, persistence or ownership rules.

Verification: package typecheck passed; `git diff --check` clean; `git diff --unified=0` confirms comment-only changes.

## Writing rule persisted

The three comment roles are now recorded in `docs/agent-context/AGENTS-en.md` §3 so future rounds do not need the instruction repeated:

- English single-line module header: module subject, ownership and boundary.
- Chinese `/** ... */`: declaration contracts on interfaces, fields, methods and module-level helpers.
- Chinese `//`: function-body logic such as ordering, fallback, cache invalidation and persistence.

No code or package behavior changed.
