Owner: `../VisualizationCanvas.tsx`, `top-actions.tsx`, `snapshot-menu.tsx`, `snapshot-dialog.tsx`, `../styles/controls.css`, `../styles/snapshot-dialog.css`, `../styles/tokens.css`, `../styles/canvas.css`

# Canvas controls

The top strip contains project, snapshot, import, export and theme entries. Project and file-transfer entries expose accessible names and disabled semantics without business handlers. Theme and snapshot open/close interactions are active.

The snapshot entry opens a two-column detail dialog inside its canvas host. Its left column contains the actual workspace title, description, source component/relation counts and detail/activity/note tabs. Its right column contains metadata and reserved save/restore/delete actions. Unknown authors and timestamps are dashes; activity is not fabricated. Previous/next/new controls remain disabled.

Tab and note state stay local to the dialog. Notes survive tab changes and are discarded on close; they do not write workspace records. Tab arrows, Home and End navigate sections. Keyboard focus stays inside the dialog, and Escape or backdrop click closes it and restores trigger focus. Narrow screens stack the two columns and scroll inside the dialog. Node geometry and persistence remain independent.

Status notices are centered at the bottom, above the toolbar on narrower screens. The notice icon is neutral for general messages; save errors use a warning icon and retain the retry action. Message lifetime follows the controller.

Canvas chrome has scoped light/dark tokens. Node geometry, routing, persistence and project sources are independent of these controls.
