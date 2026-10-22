# @1002bot/visualization

Owner: `packages/visualization/package.json`

Interactive architecture evolution canvas for the 1002bot project.

## Contents

- `src/core/schema` — snapshot / event types and validation
- `src/core/graph` — node tree indexing and edge queries
- `src/core/projection` — Graph Projection Engine: recursive expansion, endpoint folding
- `src/core/evolution` — snapshot diff + explicit evolution events (added/modified/moved/split/merged/removed/rewired)
- `src/core/engine` — canonical canvas model combining projection, evolution, layout, and routing
- `src/core/layout` — layout contracts, hierarchical ELK engine, and obstacle-avoiding router
- `src/core/schema/normalize` — canonical track ordering and boundary validation
- `src/react/` — React Flow canvas, nodes, edges, and interaction store
- `examples/1002bot/` — 1002bot project-specific stage definitions and adapter
- `tests/` — node:test unit tests for the core engine

## Usage

From the repository root:

```bash
pnpm dev
```

The repository-level command above is the stable entry point. It delegates to
this package and serves the Vite playground at `http://127.0.0.1:5199`.

You can also run the package command directly:

```bash
pnpm --filter @1002bot/visualization dev
```

Or from this package:

```bash
cd packages/visualization
pnpm dev
```

Both commands serve the Vite playground at `http://127.0.0.1:5199`. The host,
port, and `strictPort` setting are fixed, so startup fails when port 5199 is
occupied instead of selecting another port.

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:web
pnpm typecheck:web
pnpm check:dist
```

`typecheck` covers both the core TypeScript sources and the React Flow/web
sources through `tsconfig.web.json`.

`build:web` produces the Vite playground bundle; `build` produces the typed Core
and React package output.

The React Flow surface is available from `@1002bot/visualization/react`:

```ts
import { EvolutionCanvas, useCanvasStore } from '@1002bot/visualization/react';
```

`build` verifies the public JavaScript, declarations, and canonical data with
`check:dist`.

The React canvas keeps expansion, selection, camera, and manual node positions
in the canvas store. Core `CanvasModel` is the only graph computation entry;
React Flow consumes it directly.

## Design

Data model: complete stage snapshots + explicit evolution events. See
[docs/agent-context/plans/2026-10-19-visualization-core-design.md](../../docs/agent-context/plans/2026-10-19-visualization-core-design.md).

## Integration

Already registered in `pnpm-workspace.yaml` as `packages/visualization`.

The package is private and not published to npm. Use `pnpm dev` for local
interactive preview.
