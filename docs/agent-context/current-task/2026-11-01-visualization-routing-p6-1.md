# Visualization routing P6.1: drag failures and quality convergence

## Continuous-drag diagnosis

30 measured frames now complete with **0 failed transactions** at 50/100/200 edges, both star and crossed fixtures.

Two distinct causes were found:

1. **50/100 star/crossed, frames 24-29**: the benchmark dragged a leaf into its neighbour (the leaf advanced into the next card's AABB), producing `no-candidate` for `hub-0-leaf-1`. This was fixture motion, not a solver budget issue. The benchmark now drags into a clear left-hand lane.
2. **200 star/crossed, frames 1-23**: the moved edge could not allocate a port because retained routes occupied fixed port slots (`port-capacity`). Retained auto routes now mark `softPorts`; their geometry and object identity stay, but they do not hard-reserve their slots or paths. The moved edge plans locally and shares capacity if necessary.

## 30-frame measurements

| Variant | Edges | Failed frames | Local P50/P95 ms | Warm commit P50/P95 ms |
| --- | ---: | ---: | ---: | ---: |
| stars | 50 | 0 | 1.3 / 2.3 | 0.1 / 0.2 |
| stars | 100 | 0 | 3.0 / 4.6 | 0.2 / 0.2 |
| stars | 200 | 0 | 8.0 / 10.1 | 0.5 / 0.6 |
| crossed | 50 | 0 | 1.3 / 2.2 | 0.1 / 0.2 |
| crossed | 100 | 0 | 2.6 / 3.3 | 0.2 / 0.2 |
| crossed | 200 | 0 | 7.7 / 12.5 | 0.4 / 0.4 |

The commit figures are warm final updates, matching the no-release-full-solve path. The cold full solve remains 300-600 ms at 200 edges and is reported separately as cold start.

## Labels

- Global label candidate expansion (up to 14 candidates per route) plus a global beam (24 cold / 8 incremental) and final route-map safety gate keeps rendered **labelOverlaps = 0** at every size.
- Hidden labels at 200 edges: stars **50**, crossed **49** (down from 56/60 in P6; crossed from 76 before local scoping). Labels use the hover fallback.
- Stage-2 local group re-planning for hidden labels is not implemented yet.

## Crossings

Crossings are unchanged at 200 edges: stars **1,900** vs Legacy **525**; crossed **1,721** vs **503**. This remains roughly 3.4-3.6× Legacy, above the 1.5× gate.

A new `cross-group-quality.ts` analyzes crossing hotspots by edge and group (`crossGroupCrossingHotspots`) and is covered by `tests/cross-group-quality.test.ts`. A local reviewer that re-routes only the top contributing groups against soft context is not yet implemented; the global channel ordering remains future work.

## Browser Scale Lab

Not delivered in this step. Existing browser evidence remains the P4/P5 labs; the 200-edge real-drag/freeze/30-frame browser scale lab and screenshots are still required.

## Gates

- Package tests 311/311; root tests 242/242; typecheck, package/web builds, snapshot check.
- Interactive P95: passes at 50/100/200 with zero failures.
- Commit P95: passes for warm commit; cold is separately reported and not treated as interactive.
- Label overlaps: passes with hidden fallback.
- Crossing gate: fails; Group remains opt-in and Legacy remains default.
- Soft ports, reuse and label coordination keep the legacy fallback silent on failure.

## Remaining P6.1/P6 work

1. Local crossing reviewer: use `crossingHotspots` to re-plan top groups with context; target 200-edge crossing <=1.5× Legacy.
2. Stage-2 hidden-label local re-plan for the 49-50 hidden labels.
3. Implement `?lab=scale&edges=50|100|200` with real drag, freeze toggle, frame timing and screenshots.
4. Add segmented commit profiling (solve/labels/coordination) before changing cache/scheduler.
