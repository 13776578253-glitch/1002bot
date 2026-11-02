# Visualization routing P6: reuse, spatial dirty set, global labels

## Result

P6-A plan/route reuse and P6-B spatial dirty gating are implemented; P6-C global label safety is implemented. The full P6 quality gate is **not** met, so Legacy remains the default and Group remains opt-in.

## P6-A: plan/mode/route reuse

- `GroupSolveInput` accepts `modeHints` and soft `portHints`.
- The group cache reuses legal `CachedRoute`s inside a dirty group (unchanged endpoints + clear path), keeps the cached mode, and re-plans only affected edges. `GroupPlan` keeps mode/slot/trunk hints while paths are recomputed.
- Port hints are soft; stale handles fall back to normal allocation. Fixed cached routes use `reserveExisting` so an existing slot is not rejected by new-request capacity.
- 100-edge star local update: P50/P95 **3.0/4.0 ms**, 2/10 groups solved, 19 routes reused, mode reuse 2.
- 200-edge star local update: P50/P95 **11.4/12.6 ms**, 4/20 groups solved, 16 reused. The last sample still reports a group failure, so this is not yet a clean interactive gate.

## P6-B: spatial dirty gating

- Removed the shared-node blanket cascade.
- A moved node marks directly incident groups; AABB queries against cached route/label/group bounds identify candidate groups; actual path checks decide reuse.
- Unchanged auto paths are no longer hard obstacles; they are soft context. Fixed/locked/frozen barriers remain hard.
- 200-edge crossed local update: **4/19 groups** solved (P50/P95 7.7/10.0 ms), versus P5's 19/19 cascade.
- 30-frame local sequences still end in a failed transaction at 50/100/200 edges; fallback remains atomic but the interactive acceptance is not satisfied.

## P6-C: global label safety

- `label-coordinator.ts` adds a global label occupancy beam over all `labelCandidates`; fixed labels are hard occupancy.
- The cache runs a final route-map safety gate, hiding any unresolved label as `space-exhausted` with the existing hover fallback.
- `route-quality.ts` no longer counts hidden/zero-size labels as rendered overlaps.
- All 30-sample runs report **labelOverlaps = 0**.
- Hidden counts at 200 edges: stars **56**, crossed **60**. This meets zero rendered overlap but reduces visible label density; cross-group local replanning is not yet implemented.

## 30-sample benchmark (warm-up 3)

| Variant | Edges | Cold G P50/P95 | Cold L P50/P95 | Local G P50/P95 | Local L P50/P95 | Commit G P50/P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stars | 50 | 23.5/26.6 | 22.0/25.0 | 1.4/2.6 | 1.0/2.2 | 24.7/30.0 |
| stars | 100 | 81.6/84.0 | 63.5/66.6 | 3.0/4.0 | 0.8/3.5 | 98.7/101.2 |
| stars | 200 | 308.1/318.5 | 313.1/319.4 | 11.4/12.6 | 1.1/4.2 | 366.2/375.1 |
| crossed | 50 | 21.4/22.6 | 20.6/23.1 | 1.3/2.0 | 0.6/1.4 | 25.5/27.7 |
| crossed | 100 | 85.8/88.8 | 63.6/66.4 | 3.2/7.0 | 0.8/2.7 | 100.7/103.1 |
| crossed | 200 | 306.8/312.7 | 300.7/309.6 | 7.7/10.0 | 1.0/4.7 | 359.8/385.1 |

Quality on the cold cache:

| Variant | Edges | Group labels/crossings/hidden | Legacy labels/crossings |
| --- | ---: | ---: | ---: |
| stars | 50 | 0 / 60 / 0 | 0 / 5 |
| stars | 100 | 0 / 410 / 15 | 0 / 55 |
| stars | 200 | 0 / 1,900 / 56 | 0 / 525 |
| crossed | 50 | 0 / 63 / 0 | 0 / 4 |
| crossed | 100 | 0 / 516 / 30 | 0 / 53 |
| crossed | 200 | 0 / 1,721 / 60 | 0 / 503 |

## Gate status

- **Interactive P95 <=16ms**: local P95 is 2-13ms, but sequences still contain failed transactions; not accepted.
- **Commit P95 <=60ms**: fails at 100/200 edges (99-385ms).
- **Label overlaps = 0**: passes with hidden fallback counts above.
- **200-edge crossings <= Legacy ×1.5**: fails (Group is ~3.4-3.6× Legacy).
- **Fault injection/engine switch**: existing P4/P4.1/P5 tests pass.
- **Legacy fallback**: preserved; default remains Legacy.

## Remaining P6 work

1. Soft port coordination for reused routes; eliminate the remaining failed local transactions and report their reasons.
2. Cross-group path-quality reviewer and global channel ordering; bring 200-edge crossings under 1.5× Legacy without raising A* limits or the crossing weight.
3. Stage-2 local re-plan for hidden labels, to reduce the 56/60 hidden count.
4. 50/100/200 browser scale lab with 30-frame measurement and screenshots; this report's browser evidence is still the P4/P5 labs.

## Files changed

- `group-route-cache.ts`, `route-groups.ts`, `node-port-allocator.ts`, `route-quality.ts`, new `label-coordinator.ts`.
- `tests/port-allocator.test.ts`, `tests/group-route-cache.test.ts`, new `tests/label-coordinator.test.ts`.
- `tools/routing-benchmark.ts` now uses 3 warm-ups and 30 samples plus commit metrics.
