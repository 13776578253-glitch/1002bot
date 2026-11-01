# Visualization aggregate layout

Time: 2026-10-20

Intent: Keep expanded child cards below the aggregate title and description on every track.

Logic: Use one layout metrics contract for card size, aggregate padding, and the title/description band. Apply the same metrics to React Flow node dimensions and theme CSS. Compute an expanded aggregate's size from its placed children, content origin, and padding.

Impact: Changes are limited to the tidy layout, React canvas projection, aggregate theme styles, and regression tests. Server startup configuration is outside this task.

Verification plan: Check every expanded parent-child pair generated from all stage snapshots on the main, QQ, and TUI tracks. Run package tests, strict TypeScript checking, the theme check, and a production bundle build.

Time: 2026-10-20 23:05

Change: The tidy layout now uses one geometry contract for card size, aggregate padding, the 52px title band, the 36px description band, and a 12px content gap. Expanded aggregate heights include child bounds and bottom padding. React Flow node dimensions and theme CSS use the same fixed dimensions with border-box sizing.

Verification: 15 package tests pass, strict TypeScript checking passes, the theme check covers 24 selectors, and the Vite production build succeeds. Browser checks on the main, QQ, and TUI tracks found every expanded child below its description band and inside its parent frame.

Open issues: none.
