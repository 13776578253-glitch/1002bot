# Visualization routing P5: performance, stability and default-engine decision

## Method

`tools/routing-benchmark.ts` builds deterministic 50/100/200-edge graphs with 5 star hubs, long labels, cross-star edges in the crossed variant, and `portPolicy.direction = "top-down"`. Each cold measurement uses 5 samples and each local-update measurement 9 samples. P50/P95 are over those samples. Environment: Windows, Node 24, headless Edge for the screenshots; single-process benchmark, no production hardware claim.

## Benchmark

| Variant | Edges | Groups | Cold group P50/P95 ms | Cold Legacy P50/P95 ms | Local group P50/P95 ms | Local Legacy P50/P95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stars | 50 | 5 | 26.2 / 53.0 | 23.2 / 38.8 | 22.3 / 28.6 (1/5 groups) | 1.5 / 2.2 |
| stars | 100 | 10 | 79.6 / 82.2 | 66.1 / 80.5 | 89.6 / 94.7 (failed, 2/10 groups) | 1.1 / 9.3 |
| stars | 200 | 20 | 303.4 / 312.1 | 311.6 / 319.8 | 91.2 / 91.7 (failed, 4/20 groups) | 1.2 / 26.7 |
| crossed | 50 | 5 | 20.4 / 21.1 | 21.6 / 24.6 | 24.5 / 27.8 (all groups) | 0.8 / 1.9 |
| crossed | 100 | 10 | 84.5 / 87.4 | 63.5 / 67.6 | 97.3 / 103.8 (all groups) | 0.9 / 6.2 |
| crossed | 200 | 19 | 308.3 / 317.8 | 304.0 / 317.1 | 362.1 / 371.6 (all groups) | 1.2 / 28.2 |

### Quality on the cold result

| Variant | Edges | Group label overlaps / crossings / unintended overlap / owner misses | Legacy label overlaps / crossings / unintended overlap / owner misses |
| --- | ---: | ---: | ---: |
| stars | 50 | 0 / 60 / 19,690 / 0 | 0 / 5 / 25,690 / 5 |
| stars | 100 | 35 / 410 / 42,012 / 4 | 0 / 55 / 144,010 / 20 |
| stars | 200 | 124 / 1,900 / 372,754 / 4 | 0 / 525 / 611,410 / 35 |
| crossed | 50 | 4 / 63 / 20,477 / 0 | 0 / 4 / 33,422 / 4 |
| crossed | 100 | 34 / 516 / 48,560 / 0 | 0 / 53 / 155,766 / 19 |
| crossed | 200 | 111 / 1,721 / 422,090 / 1 | 0 / 503 / 630,114 / 34 |

The group solver reduces unintended overlap and improves label ownership, but its per-group label selection does not coordinate across groups, so cross-group labels overlap at scale. Its channel/lane choices also produce more crossings. Cold latency is comparable; local updates on crossed graphs cascade through shared nodes and cost 25-372 ms. Star-only local updates at 100/200 edges hit the incremental budget and fall back despite reusing most groups. Legacy remains far cheaper for local updates.

## Stability and fault injection

- `tests/p5-stability.test.ts`: multi-node moves invalidate only affected groups and keep untouched route objects; node-set changes force a full solve with no stale records; injected `budget`, `no-candidate`, `port-capacity` and `fixed-conflict` failures stay atomic, never trigger a full solve, and recover on the next incremental update. Label ownership/overlap assertions cover the small stable graph.
- `tests/port-allocator.test.ts` now covers `reserveExisting`: cached fixed routes reserve their existing slot even when the slot already exceeds the new-request capacity; new requests still respect capacity.
- `route-groups.ts` reserves cached fixed routes with `reserveExisting`, fixing the earlier false `fixed route ... cannot reserve` failures. Remaining star-scale local failures are budget exhaustion, not bad port state.
- Existing P4/P4.1 tests: drag/release path diff zero, pin/unpin, reload, legacy switch, cold seed, snapshot geometry version.

## Visual acceptance

Same 1002bot layout at 1440×900, fixed stage/view:

- [legacy.png](p5-visual/legacy.png): 5 labels, legacy horizontal elbow placement.
- [group.png](p5-visual/group.png): 5 labels, shared Runtime trunk with branch drops; labels remain attached to their own branches; no overlap at this size.
- Group timing 6.0 ms vs Legacy 4.4 ms on this five-edge view; Group reports zero legacy geometry/routing/label time.
- At 50+ edges the offline quality table shows the cross-group label and crossing regressions that prevent promotion.

## Release decision

Legacy remains the default. Group remains opt-in with `?routing=group`; Legacy fallback stays available with `?routing=legacy` and is used automatically for pinned/locked/frozen, aggregated, preview, incomplete/illegal group results and failed incremental recovery.

Promotion conditions for a future default switch:

1. 50/100/200-edge cold and local P95 <= 16 ms at the target interaction budget.
2. Zero cross-group label overlaps and no unresolved hidden labels without hover.
3. Crossings and unintended overlap no worse than Legacy on fixed visual fixtures.
4. Atomic rollback/fault injection and engine-switch continuity green at scale.
5. Legacy can remain the immediate rollback engine.

Current blockers: cross-group label coordination, local-update cascade/budget, and crossing quality. The next work should address cross-group label placement and incremental budget/mode reuse before any default switch.

## Commands and gates

- `pnpm bench:routing`
- Package tests 306/306; root tests 242/242; typecheck, package build, web build, snapshot check.
