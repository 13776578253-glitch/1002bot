# Visualization model 架构审计（只读）

## Intent

Audit `packages/visualization/src/react/model` without changing code, tests, configuration or behavior.

- Identify the real execution chain from baseline input to rendered routes and labels.
- Locate complexity hotspots, runtime coupling and unclear ownership boundaries.
- Distinguish necessary product complexity from historical patches and dormant compatibility paths.
- Propose a lightweight second-level directory grouping and a safe execution order.

Scope: 40 implementation files under `src/react/model` (excluding `__tests__` and `README.md`), about 5.8k lines. The audit also follows call sites into `src/react/canvas`, `src/react/persistence` and `tests/`.

## Method

- Read the largest and most stateful modules in full, then follow their imports and callers.
- Count implementation size and locate functions with `Get-Content`/`ripgrep`; line counts are locators, not acceptance criteria.
- Search production, test and benchmark call sites for suspected legacy helpers.
- Reconstruct the actual chain through `use-workspace-session.ts`, `use-canvas-scene.ts` and `use-canvas-controller.ts`, not only through the model README.

## Verdict

The main issue is not file length. It is that one canvas geometry/state is written by several modules at once, with runtime import cycles and multiple parallel implementations of the same pipeline.

Three root causes:

1. **Cyclic geometry/state graph.** `grouping`/`spacing`, `hierarchy`/`placement`, `placement`/`frozen`, and `edge-routes`/`blackbox-routes` form runtime cycles.
2. **Parallel implementations.** Routing has two engines and two caches; labeling has three generations; handle-side and segment-overlap logic are duplicated.
3. **Persistence/merge concerns embedded in runtime geometry.** Workspace history, confirmation comparison, project conversion, card-size migration and dormant overlay live beside node placement and routing.

A directory-only move improves discoverability but does not remove these risks.

## Scale and actual execution chain

Largest implementation files:

| File | Lines | Actual role |
|---|---:|---|
| `route-groups.ts` | 461 | Group solver, port allocation, A*, mode scoring, transactions |
| `label-layout.ts` | 428 | Final label placement, attachment projection, occupancy, cache |
| `placement.ts` | 378 | Added-node placement, container expansion, collision/route avoidance |
| `blackbox-routes.ts` | 361 | Frozen-subgraph capture, boundary paths, frozen validation |
| `grouping.ts` | 328 | Node type, size constants, coordinates, selection, grouping, protection |
| `group-route-cache.ts` | 319 | Group-level incremental cache, invalidation, merge, stats |
| `snapshot-inheritance.ts` | 308 | Three-way merge for nodes, routes, frozen groups, label pins |
| `stage-transition.ts` | 273 | Stage diff, placement, routing, validation |
| `workspace.ts` | 267 | Content capture/restore and undo history |
| `edge-routes.ts` | 249 | Canonical route ledger, boundary resolution, application |
| `routing.ts` | 190 | Obstacle geometry, candidate handles, A* stitching |
| `route-cache.ts` | 184 | Legacy incremental route cache |
| `route-quality.ts` | 176 | Path, port and label quality metrics |
| `constraints.ts` | 168 | Snapping, collision, multi-select consistency, binary fallback |
| `frozen.ts` | 160 | Freeze selection, unfreeze, read-only expansion |

Actual chain:

```text
baseline
  → baselineForView / baselineNodes
  → CanvasNode[]
  → hierarchyProjection (core.projectGraph)
  → aggregateProjectedEdges
  → legacy engine: DiagramRouteCache.update
                   → createDiagramGeometry
                   → routeDiagramGeometry
                   → pathIsClear / validateRoute
                   → applyStoredRoutes
    group engine:  GroupRouteCache.update
                   → solveRouteGroups
                   → buildRouteGroups → planMode
                   → routeOrthogonal → validateRoute → scoreRoutes
  → LabelLayoutCache.update
  → captureLabelledRoutes / captureDisplayRoutes
  → render entities
```

Entry points:

- `use-workspace-session.ts:90` builds the three view baselines; `:106` seeds a draft; `:113-115` restores nodes and frozen groups and runs card normalization.
- `use-canvas-scene.ts:54` creates the legacy cache; `:65` the group cache; `:89` retained routes; `:96` applies stored routes; `:99` selects the engine; `:105` the label cache.
- `use-canvas-controller.ts:43-44` computes projection and display edges; `:203` captures a frozen subgraph; `:292` prepares stage navigation.
- `stage-transition.ts:161` is the stage transition pipeline; `stage-navigation.ts:71` is the merge/navigation entry.

## Complexity hotspots

| Location | Structure | Why it is hard |
|---|---|---|
| `placement.ts:224 placeAddedNodes` | About 86 lines; helpers `placeAuthoredAdditions:177`, `fitChain:114`, `candidates:130` | One function handles auto/manual modes, required ancestor expansion, gap search, finite growth, route avoidance, collision checks and fallback retries; `repairAuto` adds another loop layer at `:244` and `:272` |
| `label-layout.ts:296 LabelLayoutCache.update` | Class-level `update` about 130 lines; `generateCandidates:160`, `projectAttachment:227`, `validPrior:269` | Candidate generation, attachment projection, occupancy, bounded reselection, 20-point hysteresis, fork/adopt cache and stats share one method |
| `route-groups.ts:327 solveRouteGroups` | About 130 lines; `planMode:242` about 85 lines | Four modes, independent time slices, port-allocation transactions, A*, legality, quality scoring, fixed-route reservation and stats |
| `blackbox-routes.ts:245 captureFrozenSubgraph` | About 78 lines; `resolveFrozenBoundaryRoute:123` about 80; `materializeFrames:36` | Frame materialization, boundary exits, internal paths, external connectors, a WeakMap cache and conflict returns in one module |
| `snapshot-inheritance.ts:194 mergeNodes` | About 95 lines; `mergeStageContent:289`, `mergeDisplayRoutes:149`, `mergeFrozenGroups:180` | Three-way merge combines world coordinates, parent chains, layout intent, frozen invariants, label pins and display-route membership |
| `grouping.ts:275 groupSelection` / `:315 ungroup` | About 40 lines each; `encloseChildren:238`, `layoutProtectionConflict:144`, `separateSiblings:63` | Node type, sizes, selection, LCA, group ledger, parent fitting and protection checks share one file |
| `route-cache.ts:50 DiagramRouteCache.update` | About 130 lines, seven mutable fields | Geometry, reserved paths, policy, topology, text, seed, indexing and stats invalidation in one method |
| `constraints.ts:53 constrainNodeMoves` | About 115 lines | Snapping, three collision passes, multi-select displacement consistency, container fitting, legality closure and a 20-step binary fallback |
| `stage-transition.ts:161 planStageTransition` | About 110 lines | Replacement mapping, expansion-change detection, route inheritance, placement, frozen growth, protected conflicts, route conflicts and display-route capture in one pipeline |
| `stage-navigation.ts:30 finalizeMerged` | About 40 dense lines | Restore nodes, refit, overlap checks, route validation, frozen restore and candidate preview in one branch-heavy function |

Implementation-level signals:

- `.find(` counts: `blackbox-routes.ts` 21, `grouping.ts` 20, `edge-routes.ts` 12, `constraints.ts` 11, `stage-transition.ts` 10. Many are repeated ID scans inside loops; this is an O(n²) risk and makes each algorithm locally harder to reason about.
- Non-null assertion counts: `edge-routes.ts` 21, `label-layout.ts` 21, `blackbox-routes.ts` 17, `constraints.ts` 12. Several implicit invariants are not encoded in types or boundary checks.
- Many one-line, semicolon-dense functions in `blackbox-routes.ts`, `stage-navigation.ts`, `stage-transition.ts`, `placement.ts` and `edge-routes.ts` increase review cost even where behavior is correct.

## Coupling and boundary issues

### Runtime cycles (confirmed by import statements)

- `grouping.ts:5` imports `fitMovedContainers` from `spacing.ts`; `spacing.ts:2` imports `restoreSiblings`, `separateSiblings` and `structureHeaderHeight` from `grouping.ts`.
  → `grouping ↔ spacing`.
- `hierarchy.ts:4` imports `solveHierarchyExpansion` from `placement.ts`; `placement.ts:6` imports `hierarchyProjection` and `nodeIsVisible` from `hierarchy.ts`.
  → `hierarchy ↔ placement`.
- `placement.ts:7` imports `toggleFrozenExpansion` from `frozen.ts`; `frozen.ts:4` imports `toggleHierarchy` from `hierarchy.ts`; `hierarchy.ts:4` imports `placement.ts`.
  → `placement → frozen → hierarchy → placement`.
- `edge-routes.ts:11` imports `boundaryWorldPoints` and `resolveFrozenBoundaryRoute` from `blackbox-routes.ts`; `blackbox-routes.ts:8` imports `endpointFingerprint`, `routeSnapshotForEdge`, `storedRouteAttached`, `worldRoutePoints` and `reservedLockedRoutes` from `edge-routes.ts`.
  → `edge-routes ↔ blackbox-routes`.
- `workspace.ts:12` imports `comparableCanvasIntent` from `confirmation.ts`; `confirmation.ts:2` imports only types from `workspace.ts`.
  → No runtime cycle, but storage/history depends on confirmation policy.

Consequences: initialization order is sensitive, individual modules cannot be moved independently, and any geometry change ripples across subsystems.

### Model versus persistence and rendering

- `workspace.ts:164` defines `CanvasViewStorage`; `workspace.ts:278` defines `ViewHistory`; `project-workspace.ts:115` and `:141` convert project and canvas shapes. Persistence modules import these model contracts.
- `grouping.ts:9` makes `CanvasNode` extend React Flow's `Node` and includes `onToggle`, `onRename` and `onRenameCommit`. The runtime node and the persisted `CanvasNodeView` are deliberately different, but `restoreNodeViews` has to rebuild the difference.
- Card sizes, `structureHeaderHeight`, `RESPONSIBILITY_CARD_SIZE` and label text measurement live in `grouping.ts:35-42` and `labels.ts:45`. These are canvas product constants, not pure domain constants.

### State ownership

| State | Current owner | Persisted | Duplicate/derived |
|---|---|---|---|
| Canonical graph | core `StageSnapshot` / baseline | Datasets | Model reads only; clearest boundary |
| Node geometry | `CanvasNode` runtime / `CanvasNodeView` persisted | Yes | `width/height`, `style`, `measured`, `contentWidth/contentHeight` |
| User layout intent | `data.layoutEdits` | Yes | `authored`, `contentWidth/Height`, `fitOffset` overlap |
| Group membership | `parentId` + `groupOrigins` | Yes | Actual parent and restore ledger |
| Draft/confirmed | `CanvasBaselineView` / `CanvasWorkspaceView.views` | Yes | `baselines` is the active-view alias; `views` is authoritative |
| Canonical routes | `EdgeRouteSnapshot` | Yes | `CachedRoute` runtime, `DisplayRouteSnapshot` display cache |
| Labels | `EdgeLabelPin`, display-route label fields, `LabelLayoutResult` | Partial | Authored pin, display snapshot, runtime result |
| Frozen groups | `FrozenGroupSnapshot` | Yes | `worldBounds`, `protectedFrame`, `frozenFrames`, `previousRoutes`, `previousModes` |
| Stage inheritance | `StageInheritanceBase`, `confirmed`, `sourceStage`, `confirmedRevision` | Yes | Multiple parent/target baselines |
| Undo history | `ViewHistory` | No | Runtime; uses confirmation comparison |
| Route/label caches | `DiagramRouteCache`, `GroupRouteCache`, `LabelLayoutCache`, `boundaryCache` | No | Four state containers with separate invalidation |

Live runtime state is actually held by refs in `use-workspace-session.ts` (starting around `:54`), not by the model. Model functions are mostly transitions; the stateful exceptions are `ViewHistory`, `DiagramRouteCache`, `GroupRouteCache` and `LabelLayoutCache`.

## Patch-on-patch and non-modular updates

### 1. Three label generations (confirmed)

- First generation: `labels.ts:59 placeEdgeLabel`; `READAI.md:184` says it remains only for compatibility tests and is outside the canvas pipeline.
- Second generation: `label-candidates.ts:29 labelCandidatesForRoute` and `label-coordinator.ts:22 coordinateLabels`; only tests and the routing benchmark reference them. `route-groups.ts:4` imports only the `LabelCandidate` type, and `route-groups.ts:444` writes an empty `labelCandidates` array.
- Third generation: `label-layout.ts:296 LabelLayoutCache`, the active canvas path.

Three sets of clearance constants and two candidate-generation algorithms coexist (`CLEARANCE=8`, `BEND_CLEARANCE=12`, `SIDE_GAP=4/2`). This is historical implementation debt, not necessary business complexity.

### 2. Two routing engines, two caches and duplicated geometry logic (confirmed)

- Legacy cache: `route-cache.ts:50 DiagramRouteCache`. Group cache: `group-route-cache.ts:121 GroupRouteCache`. Both rebuild geometry, track dirty sets, reuse routes, merge results and collect stats.
- `route-selection.ts:10` is a clean seam: group results replace legacy only when every expected edge is legal. The duplication is above it.
- Side selection is implemented three times:
  - `hierarchy.ts:134 edgeHandles`
  - `routing.ts:119 preferredHandles`
  - `route-groups.ts:142 sideOf` / `:151 preferredPair`
  All use roughly the same `1.15` horizontal/vertical ratio. `edgeHandles` has no production caller.
- Segment overlap is implemented twice: `routing.ts:129 overlapLength` and `route-quality.ts:79 overlap`.
- `routing.ts:103 routeDiagramEdge` is test-only; production uses `routeDiagramGeometry`.
- `edge-routes.ts:56 captureRoutesForGroup` is test-only; production uses `captureFrozenSubgraph`.

### 3. Dormant features remain in live state (confirmed)

- `overlay.ts:2` states “Unenabled: no controller or UI currently creates an overlay; persistence compatibility only”; `emptyOverlay:24` has no caller. Overlay still appears in `CanvasBaselineContent`, confirmation comparison, stage three-way merge and project conversion.
- `route-cache.ts:26-27` keeps `labelFallback` and `labelState`; `route-groups.ts:53-56` keeps `labelCandidates`, `label` and `labelState`, and `:444` writes empty values. `route-quality.ts:120` and `:124` still score label visibility from these fields.
- `README.md:31` calls the older candidate/beam helpers compatibility-only; `READAI.md:193` lists route-side label fields and `placeEdgeLabel` as technical debt.

### 4. Test-only wrappers and aliases (confirmed)

Production code has no caller for:

`placeEdgeLabel`, `labelCandidatesForRoute`, `coordinateLabels`, `crossGroupCrossingHotspots`, `routeDiagramEdge`, `edgeHandles`, `moveAuthoredNodes`, `containerSizeLimits`, `removeLabelPin`, `emptyOverlay`, `captureRoutesForGroup`.

Some are legitimate low-level APIs, but they are not marked as test-only or isolated from production entries.

### 5. Repair loops and migration passes in the live path

- `placement.ts:244` and `:272` use `repairAuto` loops with six bias directions; this is a solve-then-offset-repair strategy.
- `constraints.ts:53` uses three collision passes and a 20-step binary fallback; `manual-layout.ts:88` uses an 18-step binary fallback.
- `normalize-card-layout.ts:11` is a card-size migration pass, but `use-workspace-session.ts:65` calls it on every restore. With `repairExisting` false it often does nothing, but it remains in the hot restore path.
- `workspace.ts:215 restoreNodeViews` combines manual-parent recovery, source-node rebuilding, shape changes, cluster/structure/card conversion, legacy layout edits and `standardizeCards`.

Classification:

- **Necessary degradation:** incomplete group solution falls back to legacy; labels hide when no legal space; frozen boundary conflicts; infeasible routes are omitted.
- **Historical migration:** v1/v2 workspace migration, legacy layout edits, `normalizeCardLayout`, backup keys. Keep, but isolate and gate by version.
- **Patches to remove or isolate:** two old label generations, route-side label fields, dormant overlay, test-only aliases, duplicate handle and overlap logic.

## Proposed second-level directory grouping

Target: one kernel plus six functional domains.

```text
src/react/model/
├─ kernel/
│  ├─ node.ts          # CanvasNode, LayoutMode, card sizes, header height
│  ├─ coordinates.ts   # worldPosition, contentPosition
│  ├─ spatial.ts       # SpatialIndex, bounds helpers
│  └─ change.ts        # ChangeMark display rules
├─ layout/
│  ├─ visibility.ts    # hierarchyProjection/nodeIsVisible
│  ├─ hierarchy.ts     # baselineNodes/createHierarchyNodes/expansion orchestration
│  ├─ placement.ts
│  ├─ constraints.ts
│  ├─ manual-layout.ts
│  ├─ spacing.ts
│  ├─ siblings.ts      # separateSiblings/restoreSiblings
│  ├─ groups.ts        # groupSelection/ungroup
│  ├─ selection.ts     # selectionRoots/normalizeMarqueeSelection/leafMembers
│  ├─ protection.ts    # layoutProtectionConflict
│  ├─ intent.ts        # layout-intent
│  ├─ normalize-card-layout.ts
│  └─ guides.ts
├─ routing/
│  ├─ geometry.ts      # routing.ts
│  ├─ legacy-cache.ts  # route-cache.ts
│  ├─ group-solver.ts  # route-groups.ts
│  ├─ group-cache.ts   # group-route-cache.ts
│  ├─ route-state.ts   # edge-routes.ts
│  ├─ selection.ts     # route-selection.ts
│  ├─ quality.ts       # route-quality.ts
│  ├─ status.ts        # routing-status.ts
│  ├─ display-edges.ts
│  ├─ display-routes.ts# display-route-snapshots.ts
│  └─ diagnostics.ts   # cross-group-quality.ts (tests/benchmark)
├─ labels/
│  ├─ measure.ts       # labels.ts measurement/visibility
│  ├─ layout.ts        # label-layout.ts
│  ├─ pins.ts
│  ├─ snapshots.ts
│  └─ legacy/          # placeEdgeLabel/label-candidates/label-coordinator
├─ freeze/
│  ├─ selection.ts     # freezeSelection/unfreeze/restore
│  ├─ expansion.ts     # toggleFrozenExpansion
│  ├─ boundary.ts      # frozenBoundary/resolveFrozenBoundaryRoute/handles
│  ├─ capture.ts       # captureFrozenSubgraph/release/validate
│  └─ growth.ts
├─ stages/
│  ├─ transition.ts
│  ├─ navigation.ts
│  ├─ inheritance.ts
│  ├─ view-projection.ts
│  └─ types.ts
└─ workspace/
   ├─ content.ts       # CanvasNodeView/capture/restore
   ├─ history.ts       # ViewHistory + comparable intent
   ├─ confirmation.ts
   ├─ project.ts       # project-workspace
   └─ overlay-compat.ts
```

Mapping:

- `kernel`: node type, card/header constants, `worldPosition`, `contentPosition`, `SpatialIndex`, `change`.
- `layout`: `grouping` (rest), `spacing`, `hierarchy`, `placement`, `constraints`, `manual-layout`, `layout-intent`, `normalize-card-layout`, `guides`.
- `routing`: `routing`, `route-cache`, `route-groups`, `group-route-cache`, `edge-routes`, `route-selection`, `route-quality`, `routing-status`, `display-edges`, `display-route-snapshots`, `cross-group-quality`.
- `labels`: `labels` (measurement/visibility), `label-layout`, `label-pins`, `label-snapshots`, and legacy label helpers under `labels/legacy/`.
- `freeze`: `frozen`, `blackbox-routes`, `frozen-growth`.
- `stages`: `stage-transition`, `stage-navigation`, `snapshot-inheritance`, `view-projection`, `stage-types`.
- `workspace`: `workspace`, `confirmation`, `project-workspace`, `overlay`.

Target dependency direction:

```text
core
  ↑
kernel
  ↑
layout ── routing ── labels
  ↑         ↑          ↑
freeze ─────┴──────────┘
  ↑
stages → workspace
```

- `kernel` imports only core.
- `layout` imports kernel/core only; not routing, labels, freeze, stages or workspace.
- `routing` imports kernel/core and `layout/visibility`; not stages or workspace.
- `labels` imports kernel/core and routing geometry/path types; not stages or workspace.
- `freeze` imports kernel/core, layout/geometry and routing geometry/route-state.
- `stages` may import all lower groups.
- `workspace` uses only types from stages/labels/routing.

## Cycle-breaking extractions

A pure move leaves the four cycles intact. The following four extractions are behavior-preserving and should precede or accompany the move:

1. **Split `grouping` / `spacing`.** Move `separateSiblings` and `restoreSiblings` to `layout/siblings.ts`; `spacing.ts` imports kernel + siblings, not `grouping.ts`.
2. **Split `hierarchy` / `placement`.** Move `hierarchyProjection` and `nodeIsVisible` to `layout/visibility.ts`; `placement.ts` imports visibility, not `hierarchy.ts`.
3. **Split `frozen` / `placement`.** Move `toggleFrozenExpansion` to `freeze/expansion.ts`; `placement.ts` imports expansion, not the whole frozen module.
4. **Split `edge-routes` / `blackbox-routes`.** Move `frozenBoundary`, `boundaryWorldPoints`, `resolveFrozenBoundaryRoute` and `handles` to `freeze/boundary.ts`; `routing/route-state.ts` and `freeze/capture.ts` both depend on boundary.

`workspace` / `confirmation` can be cleaned later: move `comparableCanvasIntent` and `ViewHistory` into `workspace/history.ts`; `workspace/content.ts` should not import confirmation policy.

## Execution order

- **Phase 0 — pure move (low risk).** Create the directories, move files, update imports; accept remaining cycles; typecheck + full tests + browser smoke. Goal: readable ownership and stable paths.
- **Phase 1 — break cycles (medium risk).** Apply the four extractions above; validate each one separately, especially `placement`/`freeze`/`visibility`.
- **Phase 2 — remove patches (medium-high risk).** Migrate or delete the two old label generations and test-only wrappers; remove route-side label fields; isolate or remove the dormant overlay. Biggest complexity reduction.
- **Phase 3 — persistence boundary.** Move `project-workspace.ts` and `CanvasViewStorage` to persistence/shared contracts; model keeps only canvas domain logic. This changes public exports, so it should be a separate commit.

Do not:

- Create a generic `shared/` dumping ground; keep `kernel` limited to node type, coordinates, spatial index and constants.
- Split functions by line count; `placement`, `label-layout` and `route-groups` need separated policies, not more wrappers.
- Add compatibility forwards for old labels or overlay. Delete or isolate them with a named scope.
- Add barrel `index.ts` files while cycles remain; they amplify initialization-order risk.

## Evidence status

- **Confirmed by code:** file size and function locations, import cycles, missing production callers, duplicate handle/overlap logic, dormant route label fields, overlay’s “Unenabled” note, test-only helpers.
- **Inferred:** O(n²) risk from repeated `.find(` scans, maintenance cost of `repairAuto` and binary fallbacks, drift risk from two cache invalidation implementations.
- **Unverified:** actual p95 under realistic node/edge counts, full browser interaction regression, any out-of-repository consumer of these internal modules (package exports currently expose only `src/index.ts` and `src/react/index.ts`).

## Verification

Read-only audit; no code, tests, configuration or behavior changed.

Evidence collected by:

- `Get-ChildItem`/`Get-Content` line counts for the model implementation files.
- `rg` over `packages/visualization` for caller and identifier search.
- Import-line review for the cycle map.
- Full reads of the largest stateful modules and their canvas entry points.

No test suite was run because the audit made no code changes. The existing baseline remains 399 passing tests and 13 pre-existing failures from the last package run.

## Result

- Identified four runtime import cycles and one conceptual workspace/confirmation edge.
- Located ten complexity hotspots, led by `placement.placeAddedNodes`, `LabelLayoutCache.update`, `solveRouteGroups` and `captureFrozenSubgraph`.
- Confirmed three generations of label code, two routing caches, duplicate handle/overlap logic, dormant overlay and route-side label fields, and a set of test-only wrappers.
- Proposed one kernel plus six functional directories, four behavior-preserving cycle cuts, and a four-phase order.
- No code changes.

Open issues: the exact performance impact and the safe deletion order for legacy label tests remain to be measured in a follow-up implementation round.

Commit suggestion: none; this is a read-only architecture record.
