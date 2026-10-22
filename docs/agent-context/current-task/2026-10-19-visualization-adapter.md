# Visualization adapter

Time: 2026-10-19

Intent: Add the 1002bot data adapter under `packages/visualization/src/adapters/` that executes the legacy canvas model in an isolated VM context and converts all 12 stages into valid `TrackSeries` snapshots.

Logic: Load the legacy stage definitions and `buildGraph` through `node:vm`, set the legacy track selector before each build, convert recursive nodes and local relative edges, and validate every snapshot with the core validator. Evolution deltas remain automatic; the adapter does not create explicit steps.

Impact: The adapter and its tests are additive. Core schema and evolution semantics remain unchanged, and package dependencies remain unchanged.

Verification plan: Run the requested adapter test command, then the package typecheck. Check that all 12 snapshots validate, every main-track adjacent diff is non-empty, M2 and later introduce added nodes, and the M6 memory design is marked planned.

Implementation: `src/adapters/bot-1002.ts` runs the legacy file in `node:vm`, selects each track, invokes `buildGraph`, and rebuilds VM-realm arrays in the host realm. Edges resolve from their owner node and convert the full legacy path to the final local node path. Four local group keys avoid collisions with existing node ids. The adapter validates every snapshot before returning it.

Verification: `node --experimental-strip-types --test tests/adapter.test.ts` passed 4 tests; 12 snapshots across main, qq, and tui passed validation. `node --experimental-strip-types --test tests/*.test.ts` passed all 13 visualization tests. Every main-track adjacent delta is non-empty and introduces added nodes. M1.0 to M2.0 adds `console`, `ingress-control`, `admission`, and `measure`. M6.0 `memory-design` and its child carry `planned: true`. `git diff --check` passed for the adapter, test, and this record.

Open issues: The full package typecheck reports missing `@xyflow/react` and `zustand` modules plus resulting implicit-any errors in `src/react/store/canvas-store.ts`; package dependencies were left unchanged. A focused strict typecheck of the adapter and its test passes.
