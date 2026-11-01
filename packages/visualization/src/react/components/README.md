Owner: `../VisualizationCanvas.tsx`, `top-actions.tsx`, `snapshot-menu.tsx`, `../styles/controls.css`, `../styles/tokens.css`, `../styles/canvas.css`

# Canvas controls

The top strip contains project, snapshot, import, export and theme entries. Project and file-transfer entries expose accessible names and disabled semantics without business handlers. Theme and snapshot open/close interactions are active.

The snapshot popover shows the actual current workspace title and stage label. Saved snapshot listing, capture and restore are reserved for the workspace integration; the popover does not fabricate saved names or timestamps. Escape closes it and restores focus to its trigger. The previous stage-switch popover is removed from the rendered canvas.

Status notices are centered at the bottom, above the toolbar on narrower screens. The notice icon is neutral for general messages; save errors use a warning icon and retain the retry action. Message lifetime follows the controller.

Canvas chrome has scoped light/dark tokens. Node geometry, routing, persistence and project sources are independent of these controls.
