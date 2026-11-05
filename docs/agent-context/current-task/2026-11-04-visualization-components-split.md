# packages/visualization/src/react/components 二次拆分

## Intent

Split `src/react/components` into four functional directories without changing behavior, props or public exports:

- `primitives/`: `nodes.tsx`, `relation-edge.tsx`, `ports.tsx`
- `controls/`: `top-actions.tsx`, `canvas-controls.tsx`, `selection-tools.tsx`
- `panels/`: `connection-panel.tsx`, `transition-panel.tsx`
- `snapshot/`: `snapshot-menu.tsx`, `snapshot-dialog.tsx`
- Root keeps `change-badge.tsx`, `icon.tsx` and `README.md`.

Also remove the duplicate `../styles/canvas.css` entry from `components/README.md` and update its Owner paths.

## Logic

1. Move the ten files with `git mv`; file contents stay unchanged except relative imports.
2. Rewrite only imports whose depth changes; same-directory imports stay.
3. Update `VisualizationCanvas.tsx`, `use-canvas-scene.ts`, `playground/src/routing-lab.tsx` and the architecture-boundary expectation.
4. Update the component README layout/ownership and the package module-boundary row.

## Impact

No runtime behavior, component props, exports or CSS selectors change. The package public entry remains `src/react/index.ts`; components stay internal.

## Verification

1. `pnpm --filter @1002bot/visualization typecheck`
2. `pnpm --filter @1002bot/visualization build`
3. Focused architecture test; full package suite if time permits, with pre-existing failures reported separately.
4. `git diff --check` and import-path review.

## Result

- Moved ten files with `git mv`:
  - `primitives/`: `nodes.tsx`, `relation-edge.tsx`, `ports.tsx`
  - `controls/`: `top-actions.tsx`, `canvas-controls.tsx`, `selection-tools.tsx`
  - `panels/`: `connection-panel.tsx`, `transition-panel.tsx`
  - `snapshot/`: `snapshot-menu.tsx`, `snapshot-dialog.tsx`
- Root keeps `change-badge.tsx`, `icon.tsx` and `README.md`.
- Rewrote only relative imports whose depth changed; same-directory imports stayed.
- Updated `VisualizationCanvas.tsx`, `use-canvas-scene.ts`, `routing-lab.tsx` and the architecture-boundary expectation.
- Removed the duplicate `../styles/canvas.css` from the component Owner list; added the four-directory layout and named the package module groups.

## Verification

- `pnpm --filter @1002bot/visualization typecheck`: passed.
- `pnpm --filter @1002bot/visualization build`: passed; dist check reported 170 artifacts.
- Architecture tests: 5/5 passed.
- Full package suite: 399 passed, 13 failed. The failures are the pre-existing card-size, growth, grouping, layout-intent and project-data baseline; no new failures.
- Headless Edge smoke against the existing Vite server at `http://127.0.0.1:5199/`: stage `16d69bf0`, Structure view, 11 nodes, 6 edges, 6/6 routes, no notice.
- `git diff --check`: passed.

## Component comments

### Intent

Apply the comment roles from `docs/agent-context/AGENTS-en.md` §3 to the twelve files under `src/react/components`:

- one English module header per file, naming the component subject, ownership and boundary;
- Chinese `/** */` contracts on exported components, props interfaces and non-obvious helpers;
- Chinese `//` notes inside function bodies for focus, portal, pagination, visibility and fallback rules.

No code, props or rendering changes.

### Verification Plan

- `pnpm --filter @1002bot/visualization typecheck`
- `git diff --check` and a line-by-line comment-only diff review.

## Result

- All twelve component files now start with one English module header naming the component subject, ownership and boundary.
- Added or tightened Chinese `/** */` contracts on `CanvasControlsProps`, `ConnectionPanelProps`, `TransitionPanelProps`, `SnapshotDialogProps`, `LinkData`, exported components, `LayoutMark`, `Responsibilities`, `slotStyle` and `slotLength`.
- Added Chinese `//` logic notes for mixed layout modes, confirmation freshness, preview focus/portal behavior, hidden labels, slot measurement, duplicate path lookup, pagination clamping and colon splitting.
- No code, props or rendering changes.

## Verification

- `pnpm --filter @1002bot/visualization typecheck`: passed.
- `git diff --check`: passed.
- Line review confirmed this pass only changed comments. The import-path lines still visible in the working diff belong to the uncommitted directory split from the previous round.
