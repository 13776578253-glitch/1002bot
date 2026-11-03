# Terminal responsibility cards

## Intent

Replace the existing single-column responsibility strips with two-column static information cards, preserving all responsibility text and real node identity. Keep the existing details string contract for this small preview change. Split explicit title separators for display and keep unstructured text intact. Mark expanded responsibility-only nodes as terminal. Synchronize row sizing with container header geometry and default expanded leaf dimensions; preserve authored and saved workspace frames.

Static responsibility content is an authored last resort when recursive architecture becomes too deep and internal connections are unnecessary. Real components and relationships continue to use graph nodes and edges; do not automatically flatten them by depth. Pagination, grouped summaries and the shared shell refactor remain for the next redesign.

Verification: inspect the actual Vite page in the native browser, including FixtureWorld and InputChannel expansion/collapse. Run no automated tests or benchmarks, as requested. Leave existing user workspace data intact.

## Result

The shared responsibility renderer now displays two columns of 72px rounded information cards. Explicit colon-separated text has a title and description; other text remains intact with its full string available on hover. Expanded responsibility-only cards show a terminal badge. Matching row budgets update the default leaf size and structure header geometry. No graph entities or relationships were converted, and authored/source data and storage formats were left unchanged. Component/model documentation records the authored last-resort rule.

Native browser verification on the actual Runtime project confirmed World and FixtureWorld render as separate nested architecture nodes, with FixtureWorld's three static responsibilities shown in two columns. FixtureWorld collapse and reopen succeeded. The visible Runtime responsibilities also use the shared grid. InputChannel was not separately exercised. The preview is left open, centered on World/FixtureWorld at 92% zoom; existing node positions and stored frames were not manually edited. Normal expand/collapse and viewport persistence ran through the existing UI.

No automated tests, typechecks or benchmarks were run. Diff whitespace inspection passed. The initial sandbox Vite process was stopped after browser connection failures; a host Vite process now serves 127.0.0.1:5199. Browser evidence: `.scratch/terminal-responsibility-cards.jpg`. No commit or push.
