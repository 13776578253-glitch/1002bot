Owner: `../../core/layout/port-policy.ts`, `../../core/layout/geometry.ts`, `../../core/schema/types.ts`, `../../core/schema/validate.ts`, `routing.ts`, `route-cache.ts`, `display-route-snapshots.ts`, `edge-routes.ts`, `blackbox-routes.ts`, `workspace.ts`, `../canvas/use-canvas-scene.ts`, `../persistence/local-storage.ts`

# Port candidates and route geometry

Views may set `portPolicy.direction` to `top-down`; omitted or `auto` uses the relative positions of the endpoints. The overview selects top-down. The router evaluates side-centre port pairs after rejecting card collisions, locked-path intersections and incorrect departures/arrivals. Frozen fragments and boundary ports remain protected by the existing boundary connector.

Feasible candidates expose five costs: Manhattan length, complete-path bends, shared straight-segment length, occupied endpoint sides, and deviations from the preferred source/target sides. Initial comparison is lexicographic: direction, length, bends, portCrowding, overlap. `portPolicy.priority` may reorder those metrics; omitted metrics follow the defaults. Numerical weights and multi-edge rerouting are deferred until larger authored fixtures provide tuning evidence. The existing obstacle-grid search retains its internal bend penalty; port candidates are compared as complete paths.

The simple-path solver compares horizontal and vertical doglegs symmetrically with both port axes included. The obstacle-grid search uses those axes at its first and last step. Rounded SVG corners are applied only after route selection.

The cache scores changed routes against unaffected and already generated routes. It keeps unrelated paths stable and does not revisit the full graph to improve a score. A policy change invalidates automatic path caches once. Path snapshots carry a policy key; older automatic snapshots are recomputed while explicit pinned/locked paths and frozen fragments retain their contracts. Automatic display snapshots are checked against locked obstacles on restore, including when the barrier version is unchanged.

No feasible candidate produces an empty blocked route. The canvas reports the blocked count, omits the invalid line and excludes it from path snapshots. Node positions, workspace history and locked geometry remain intact.
