Owner: `../VisualizationCanvas.tsx`, `top-actions.tsx`, `snapshot-menu.tsx`, `snapshot-dialog.tsx`, `ports.tsx`, `nodes.tsx`, `../styles/nodes.css`, `../styles/controls.css`, `../styles/snapshot-dialog.css`, `../styles/tokens.css`, `../styles/canvas.css`

# Canvas controls

The top strip contains project, snapshot, import, export and theme entries. Project and file-transfer entries expose accessible names and disabled semantics without business handlers. Theme, snapshot open/close and the dialog stage selector are active.

The snapshot entry opens a two-column detail dialog inside its canvas host. Its left column contains the workspace title, description and detail/activity/note tabs; the detail panel is reserved for future content. Its right column contains metadata, a stage selector populated from available baselines and a reserved Delete entry under “Revert or delete”. Unknown timestamps are dashes; activity is not fabricated. Previous/next controls remain disabled.

Tab and note state stay local to the dialog and are discarded on close. Stage selection calls the canvas navigation path and closes the dialog; selecting the current stage is a no-op. Refusals, missing confirmations and read-only transition previews appear on the canvas, and the dialog writes no workspace record itself. The three tab panels stay mounted with inactive ones hidden. Tab arrows, Home and End navigate sections. Keyboard focus stays inside the dialog, and Escape or backdrop click closes it and restores trigger focus. Narrow screens stack the two columns and scroll inside the dialog. Node geometry and persistence remain independent.

Status notices are centered at the bottom, above the toolbar on narrower screens. The notice icon is neutral for general messages; save errors use a warning icon and retain the retry action. Message lifetime follows the controller. Group routing fallbacks explain protected/frozen/aggregated/incomplete states; the transient dragging and preview cases stay silent.

Canvas chrome has scoped light/dark tokens. Node geometry, routing, persistence and project sources are independent of these controls.

Routing handles stay transparent during hover and selection. Their mounted geometry remains available to both routing engines; selecting a card uses its border highlight.

Edges with no feasible obstacle-free route are omitted and reported by the canvas notice. The edge renderer consumes the selected geometry; port policy and cost comparison belong to the route model.

Responsibility cards use the same expand/collapse control as containers, with no synthetic child count. Structure headers include their own responsibility blocks; actual children remain separately selectable nodes.
