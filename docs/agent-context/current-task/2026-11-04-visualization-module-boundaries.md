# Module boundary audit

## Intent

Audit published entries and playground cross-boundary imports without changing canvas, routing or labeling behavior.

- Compare `package.json` exports with the actual entry modules and the distribution verifier.
- Classify `routing-lab.tsx` imports of `relation-edge.tsx` and `ports.tsx` as test-only or missing public API.
- Route `scale-baseline.ts` contract types through the public root entry instead of `src/core/schema/*`.
- Codify the playground import boundary in the architecture test.
- Verify package build, typecheck, playground entry points and focused tests.

Impact: playground fixture imports and architecture test only. No production API, canvas, routing or labeling changes.

## Result

- `package.json` exports match the built entry modules: `.`, `./react`, `./adapters/project`, `./adapters/progress-reports` and `./styles.css`. `check-dist` resolves every target and imports the documented entry symbols; no export change was needed.
- `routing-lab.tsx` imports `relation-edge.tsx` and `ports.tsx` only to exercise the real renderer for synthetic dense routes and port handles. `Link`/`Ports` have no production consumer outside `VisualizationCanvas` and `nodes.tsx`, so this is a test-only internal dependency, not a missing public capability. No public export was added.
- `scale-baseline.ts` now imports its contract types from `src/index.ts` instead of `src/core/schema/*`. The fixture consumes the published contract without a new forwarding module.
- `tests/architecture/boundaries.test.ts` records the routing-lab exception, so a new playground deep import fails the suite.
- Verification: package typecheck passed; library build passed with 168 artifacts and `check-dist`; playground build passed with 257 modules; browser checks passed for `/`, `/?lab=routing` and `/?lab=scale&edges=50` (11/6, 36/1 and 55/50 nodes/edges, no error text). Architecture boundary tests passed 4/4.
- Package `pnpm test` reports 381 passed and 13 failed. The failures are the pre-existing card-size, layout-intent and project-data expectations in the uncommitted working tree; the new boundary test passed in that run.

Open issues: none within this round. The 13 package test failures belong to the existing uncommitted visualization work.

Commit suggestion: `refactor(visualization): keep playground on public entry points`
