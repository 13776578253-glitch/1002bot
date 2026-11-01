# Canvas and controls styling

Time: 2026-11-01
Intent: Polish only the canvas background, floating toolbar and baseline popover in tokens.css, canvas.css and controls.css. Preserve card geometry, relationship rendering, project data and interaction handlers. Other sessions are editing fixtures and architecture; do not stage their files.

Design: warm neutral canvas, visible subdued optional grid, compact consistent control sizes, modest borders/shadows, small list-style baseline popover, explicit selected and keyboard focus states, reduced-motion support.

Guidance: ui-ux-pro-max desktop quick reference (focus states, state clarity, light/dark pairing and subtle grid). Python search runtime is absent; use the bundled written rules. Native browser verification uses computer-use.

Verification: native light/dark appearance and baseline open/close, grid toggle, keyboard focus; package types/build and architecture checks; root tests/types before an isolated style commit. No implementation-mirroring CSS tests.

## Approved visual scope

The owner approved: bottom-centered compact status notice; stronger dots with unchanged spacing; project/import/export icon entries with no business handlers; snapshot popover appearance replacing the stage-switch list. Snapshot actions are presentation-only in this round. Show the actual current workspace title and stage without fabricating saved names or timestamps. Preserve source data, workspace persistence and graph calculations.

Implementation also touches isolated control components and the canvas composition. Existing staged fixture migration belongs to another session and must remain staged after the style commit.

## Result and verification

Canvas tokens now separate the background and floating control surfaces. Optional dot alpha is .34 in light and .38 in dark. Controls use consistent compact sizing and modest shadows. The status notice is bottom-centered with a neutral status icon, plain close button and a warning/retry variant for save errors; narrow layouts raise it above the toolbar.

The right strip exposes project, snapshot, import, export and theme icons. Project/import/export/save-snapshot have disabled semantics and no business handlers. Snapshot is a presentational popover with the real workspace title and stage tag, without fabricated saved records. The old baseline-picker component and its unused styles were removed. Escape closes the panel and restores trigger focus.

Native Edge validated light/dark grid and control appearance, panel open/close, Escape focus return, and the one-node freeze notice. The temporary freeze was undone, restoring all six original free modes. A clean reload produced no new console errors (the earlier HMR notice concerned removal of the retired picker module). Screenshots: .scratch/visualization-chrome-light.png, .scratch/visualization-chrome-dark.png, .scratch/visualization-chrome-final.png. Secondary text contrast measured 4.96:1 in light and 5.90:1 in dark.

Package tests 216/216 pass; root tests 242/242 pass; package/root types, library distribution build and site build pass. The final site build includes the narrow-screen notice spacing. No source/project/persistence/geometry logic changed. Snapshot capture/list/restore wiring remains deferred as approved.

This record is archived by finish-task/2026-11-01-visualization-canvas-chrome-snapshot/README.md; the original remains retained. Other sessions’ fixture migration and existing staged rename must remain outside this style commit.

Commit suggestion: feat(visualization): refine canvas chrome and snapshot presentation
