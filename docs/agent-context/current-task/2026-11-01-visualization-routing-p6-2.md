# Visualization routing P6.2: scale lab and final gate audit

## Result

P6.2 added the real 50/100/200 Scale Lab and further reduced hidden labels. The full routing-epic DoD is **not** met; the default remains Legacy and this phase is not declared final.

## Scale Lab

- `playground/src/scale-baseline.ts` and `scale-lab.tsx`: deterministic 50/100/200-edge star/crossed graphs rendered through the real `VisualizationCanvas`.
- URL: `?lab=scale&edges=200&crossed=1&routing=group|legacy`.
- 200-edge render: 205 nodes, 200 edges, **9,020 handles (7,380 slot handles)**.
- Two-row hub layout keeps the graph visible at the canvas's 20% minimum zoom.
- Freeze test: selecting a node and freezing switches to `legacy / protected-routes`, with the "已冻结 1 个节点" notice; no console exceptions. This validates the Legacy fallback path.
- **Blocking gap:** the automated drag did not move the selected node (the group cache stayed at `full:0/19`; the 16.7ms frame series is only the rAF baseline). The Scale Lab drag/frame assertion is therefore not accepted, and the freeze test is the only real-browser interaction evidence in this pass.

## Quality

- 30-frame offline drag regression: **0 failed transactions** for 50/100/200 stars and crossed after soft ports and a non-colliding drag lane.
- Local P50/P95: 1.3/2.3ms (50), 3.0/4.6ms (100), 8.0/10.1ms star and 7.7/12.5ms crossed (200); warm commit 0.1-0.6ms.
- Rendered label overlaps: **0** at all sizes.
- Hidden labels at 200: **50 star / 49 crossed** (about 25%; DoD asks significantly below 25%, not met).
- Crossings at 200: **1,900 / 1,721** vs Legacy **525 / 503**; roughly 3.4-3.6×, not within 1.5×. `cross-group-quality.ts` now ranks hotspots, but the local reviewer/2-opt/channel repair is not implemented.
- `softPorts` removes hard fixed-port reservation but does **not yet prove** physical-slot mutual exclusion. The required 20+ edge high-degree port regression is not implemented; unrelated retained/new routes may share a physical slot. DoD slot safety is **not signed off**.

## DoD audit

| Gate | Status | Evidence / gap |
| --- | --- | --- |
| Crossings | **Fail** | 200-edge Group 1,900/1,721 vs Legacy 525/503; hotspot ranking only |
| Labels | **Partial** | zero rendered overlap; 50/49 hidden at 200, not significantly below 25% |
| Slot safety | **Fail** | softPorts physical mutual exclusion not tested/proven |
| Interactive | **Partial** | offline 30-frame zero failures, P95 2-12ms; real Scale Lab drag assertion not working |
| Legacy fallback | **Pass** | group/legacy switch and freeze fallback; Legacy remains default |

## Gates

- Package tests 311/311; root tests 242/242; typecheck, package/web build, snapshot check.
- No default-engine switch; `?routing=group` remains opt-in.

## Remaining work before closure

1. Fix the Scale Lab drag harness/fixture selectors and record real 30-frame browser P95, screenshots, freeze/expand and engine switches.
2. Implement high-degree port-slot mutual-exclusion test; make softPorts reserve/reconcile physical slots or reject illegal sharing.
3. Implement the local hotspot reviewer (2-opt/slot exchange, stub adjustment, mode reselect) with net-quality acceptance and atomic rollback; target <=1.5× Legacy crossings.
4. Add stage-2 hidden-label local re-plan to move below 25% hidden at 200 edges.
5. Only then declare the routing epic complete and keep Legacy as the safety net.
