# Port candidate routing correction

Time: 2026-11-01
Intent: Remove asymmetric no-obstacle routing, evaluate port pairs through feasible candidates and explicit cost metrics, propagate an optional view direction policy (top-down or auto), and retain hard card/locked-path/frozen-boundary constraints. Use a documented priority comparison initially; leave numerical cost weights configurable for later dataset-driven tuning. Preserve manual geometry and locked route snapshots.
Impact: Geometry router, port policy contracts, project view adapter, route cache and scene wiring. Existing uncommitted dataset/catalog migration and snapshot-ID work belong to another session and remain separate.
Verification: mirrored six-node paths, geometry-driven free direction, blocked preferred ports, locked paths, cache invalidation and frozen-boundary regressions; package/root checks and native browser verification.

Result: All sixteen directional side-pairs are compared after card/locked-path rejection and outward attachment checks. Top-down is a view preference; auto keeps geometry-derived direction. Five explicit cost metrics use configurable lexicographic priorities; numeric weights remain deferred. Mirrored simple paths include port-axis bends, and the obstacle search carries endpoint axes. No feasible path yields a blocked result, a canvas notice, and no invalid path snapshot.

Snapshot policy keys invalidate legacy/different-policy automatic paths. Pinned/locked canonical geometry and frozen fragments retain their contracts. Automatic cached display paths revalidate unchanged locked barriers. Blocked paths retry when locked barriers move or disappear. Frozen capture returns atomic conflicts for infeasible paths; a frozen connector can derive its unfrozen endpoint from geometry when the automatic fallback has no points.

Verification: 13 port/caching/frozen regression cases passed; full visualization package tests 234/234, package/web typechecks, library build (130 artifacts) and site build passed. Root tests 242/242 and root typecheck passed. Native side browser showed five paths on six nodes, bottom-to-top overview ports and mirrored two-bend Provider/World paths. Freeze, undo and reload preserved all five SVG paths exactly. Screenshot: .scratch/port-candidates-final.png. Node positions remain authored/saved coordinates.

Review: Corrected policy propagation during snapshot capture, blocked-cache invalidation after barrier removal, and empty fallback endpoint handling at frozen boundaries. No remaining blocking review findings.

Compatibility: Older automatic snapshots without policyKey recompute on load. Explicit pinned/locked and frozen geometry is retained. The optional view field defaults to auto. This supplies the read-time migration for the routing policy addition.

Archive: finish-task/2026-11-01-visualization-port-candidates-snapshot/README.md indexes the byte-identical task copy; this source record remains in current-task.
Open issues: none in the initial routing correction scope. Numerical weight tuning, distributed port positions and coordinated multi-edge rerouting remain future work with larger datasets.
Commit suggestion: feat(visualization)!: rank port candidates and symmetric routes
