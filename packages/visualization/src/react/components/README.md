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

One or two responsibilities use a 1x2 layout inside a 462x192 detail frame. Three or more use four reserved slots per page: a fixed 2x2 grid inside a 462x280 detail frame. All information cards are 210x80. Titles use 12px text and descriptions use 11.5px. Pagination changes only local component state; node dimensions and route inputs remain identical. An explicit colon separates a title from its description; other text stays intact. Expanded responsibility-only nodes carry a terminal badge. This content is an authored last resort for excessive recursive depth when internal connections are unnecessary; real components and their relationships retain graph nodes and edges.

The stage-view selector restores Overview View, Structure View and Full View independently. Status dots identify confirmed snapshots for the current source revision; rebased drafts require reconfirmation. Snapshot metadata identifies the view and its confirmation time. Confirm saves only the current stage/view. Overview and Full keep fixed projection scopes; Structure owns interactive expansion choices.
