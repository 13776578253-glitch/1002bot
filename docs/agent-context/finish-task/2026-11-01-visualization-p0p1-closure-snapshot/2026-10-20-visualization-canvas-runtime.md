# Visualization canvas layout and dev runtime

Time: 2026-10-20

Intent: Fix the React Flow aggregate expansion layout so child cards begin below the aggregate title and description on all three tracks. Make the playground a stable local development server started with `pnpm dev`, with a fixed loopback host and port.

Logic: Align aggregate header/description dimensions with the layout engine's reserved child origin; compute container height from actual child bounds and padding. Keep the existing React Flow playground as the served application and make Vite fail rather than silently selecting another port. Preserve legacy HTML output as a separate compatibility build.

Impact: Changes are limited to the visualization layout, theme/component layout contract, Vite server settings, package documentation, and focused tests. Existing workspace and package changes are already present and must remain untouched.

Verification plan: Add a regression test for expanded aggregate placement and bounds; run package tests, strict TypeScript checking, theme check, and Vite production build. Start `pnpm dev` and verify the server responds at the configured loopback URL and serves the React playground.

Open issues: none.

Implementation: The tidy layout now shares explicit card, aggregate padding,
header, description, and content-gap metrics with the React Flow projection and
theme CSS. Expanded frames are sized from the placed child bounds, with child
positions beginning after the header and description bands. A regression test
covers expanded parent-child pairs from all main, QQ, and TUI stage snapshots.
The package dev command remains the data-generation plus Vite playground entry,
and the repository root exposes it as `pnpm dev`. Vite listens on
`127.0.0.1:5199` with `strictPort: true`; the standalone HTML build remains a
compatibility artifact.

Verification: `node --experimental-strip-types --test packages/visualization/tests/*.test.ts`
passed 15/15; package TypeScript checking passed; the theme selector check
passed; and the Vite production playground build completed with 184 modules.
The development server was also started successfully during implementation at
`http://127.0.0.1:5199/`.
