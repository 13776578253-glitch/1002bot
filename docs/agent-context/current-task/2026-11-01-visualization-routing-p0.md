# Routing v3 P0 contracts

Intent: Enter P0 with the four review corrections. Add a pure `NodePortAllocator` with stable physical slot identity and capacity fallback (independent, trunk, packed, spill, diagnostic). Add `InputFingerprint` that includes guarded manual paths and cross-group port/label dependencies but excludes automatic solutions. Extract a unified `validateRoute`. Bound the A* expansion count and the stitch loop, and reject illegal fallbacks through the existing candidate gate. Add segmented cache timing and a baseline performance test; the current algorithm stays the default and the benchmark.

Verification: package tests and typechecks; boundary test updated for the new core layout modules; allocator, fingerprint, legality and limit unit tests; baseline route profile recorded; existing port, cache, frozen and stage tests remain green.

Result: P0 contracts landed without switching the default router. `NodePortAllocator` generates stable physical slots shared by source/target roles, allocates by priority with independent → trunk → packed → spill fallback, reports `capacity-exhausted`/`handle-missing`, and reconciles pinned/locked slots across resize. `buildInputFingerprint`/`buildGroupFingerprint` cover policy, topology, geometry, port rules, label boxes, guarded locked/pinned/frozen paths and neighbor port/label tokens; automatic solutions are excluded. `validateRoute` is the single hard gate and `pathIsClear` delegates to it; segment bounds/crossing moved to core geometry; reserved paths are spatially indexed and the four geometry overrides rebuild that index. A* is capped at 4000 expansions / 32 ms and the stitch loop at three iterations; fallbacks still pass the candidate gate. Cache stats expose geometry/routing/label time with matching canvas data attributes. Baseline profile: 20 nodes, 31 edges, geometry 0.55–0.63 ms, routing 27.6–31.4 ms, labels 9.4–11.9 ms, total 39–45 ms.

Verification: package tests 256/256, package typecheck, library build 138 artifacts, root tests 242/242, root typecheck passed.

Open: P1 group solver, last-legal fallback and explicit conflict state, label tri-state, and group-level fixed-member caps remain.

Update P1 offline: `PortSlot` now exposes `physicalId` (`side:index`) beside the logical `handleId` (`side:role:index`); source and target roles share physical capacity and the allocator test asserts it. `createSolveBudget` adds per-A*, per-edge and per-group budgets. `route-groups.ts` adds offline star groups owned by the higher-degree endpoint, owner-id scheduling, one shared allocator snapshot, four modes (`fork`, `trunk`, `mixed`, `lanes`), deterministic candidates, and `classifyFailure` for retain / incomplete / rollback. P1 uses one allocation round; `maxRounds` is accepted for later revalidation. The default router is unchanged.

Verification: package tests 261/261, package typecheck and library build passed. Edge CDP smoke: six nodes and five edges, eight legacy handles centred exactly at 0.5/0/1 fractions, drag moved the node, the freeze action responded with the existing overlap notice, no console exceptions. The single-stage seed has no stage switch or manual path to restore.

Open: multi-slot Handle rendering and its DOM measurement; P2 label candidates and joint scoring; P3 cache/UI integration.

Update P1.5: mode evaluation now carries `isComplete`, `successCount`, `failures`, `score` and `durationMs`; incomplete modes score `Infinity` and transactional solves return `NO_COMPLETE_FEASIBLE_MODE` instead of selecting or committing a partial mode. Per-edge source/target allocation is atomic and releases the source token when the target fails; candidate failures release the pair. Port crowding uses node-scoped global keys. Locked/frozen routes reserve the exact slot handles from their stored route and their point boxes join the reserved obstacle layer; invalid fixed handles throw. Each mode gets an independent time slice, and lanes are ordered by target geometry rather than edge id.

Verification: package tests 266/266, including UT-P15-01 through UT-P15-06; package typecheck and library build (140 artifacts) passed. The default router is unchanged.

Update P2: `label-candidates.ts` generates several branch-biased label candidates per route; the group selects one per edge without label overlaps and marks exhausted labels `space-exhausted`. `route-quality.ts` scores length, bends, crossings, unintended overlap, node-scoped port crowding, channel stability, label readability and label ownership. Crossing stays a soft cost: a direct crossing beats a large detour, an equally long separated arrangement wins, and a mild two-bend detour still loses to one crossing. Shadow tests compare the old router with the offline solver on six-node, fan, dense-label and L-shaped locked fixtures; both metrics are printed.

Shadow metrics (old → new): six overlap 984→0, mode trunk; fan length 2696→2500, bends 10→12, crossings 0→2, overlap 1124→63, mode lanes; dense length 1806→1352, bends 9→8, overlap 754→199, mode fork; locked length 1196→740, bends 4→4, modes fork/fork. All four new label sets have zero overlaps and zero ownership misses; no labels exhausted.

Verification: package tests 275/275, package typecheck and library build (144 artifacts) passed. The default router remains unchanged.

Open: UI label states and cache/snapshot carry-through (P3); the fan trades two crossings for 197 shorter length and 1061 less overlap, so crossing weight remains a tuning decision.

Correction P2 metrics: overlap is now split into `intentionalTrunkLength` (verified trunk segment only) and `unintendedOverlap`. The earlier six-node 984→0 was a metric-definition effect; the corrected six-node value is 984→223. Fan is 1124→63, dense 754→199, locked 0→0. Channel stability sorts target ports by world projection and axis, not local fraction. Crossing weight is 30, validated by a 10/30/100 px detour matrix (10 px detour 336 beats crossing 340; 30 px 356 and 100 px 426 lose). Label placement uses a width-4 beam instead of a pure greedy pass; `labelRequired` excludes edges without text from hidden penalties; bends count actual direction changes.

Verification: package tests 280/280, package typecheck and library build (144 artifacts) passed.
