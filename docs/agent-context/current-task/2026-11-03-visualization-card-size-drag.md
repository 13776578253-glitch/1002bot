# Fixed responsibility cards and independent authored child movement

## Intent

Use TestAgent's existing 195x72 responsibility tiles as the shared size, with 8px gaps and two columns. Remove container-width stretching. Responsibility-only expanded nodes use the matching 432px width and row-dependent height; real structural containers continue to contain their children. Preserve historical confirmations, protected frozen geometry and all three view identities while updating working geometry.

Native reproduction on the user's M1 Structure view found JSONL SessionStore is free and draggable. Dragging it right/down moved the child from (998.731,483.981) to (1205.56,551.854), but Session also moved from (974.731,411.981) to (1181.56,473.261) and shrank from 964.02x451.28 to 757.189x390. The gesture was undone to restore the original user layout. The failure is unconditional ancestor fitting during an in-bounds child move.

During authored dragging, retain existing parent frames when children remain inside; when children cross a boundary, extend the affected frame outward without consuming existing empty space. Keep collision, frozen, fixed and locked-route checks. Surface a genuine blocked movement instead of silently returning to the old position. Verify the user's Session example by native browser interaction and inspect fixed tile geometry. Run no automated tests or benchmarks; use TypeScript/build checks and browser verification only. Keep all earlier uncommitted changes.

## Scope clarification

The requested size applies to the static responsibility tiles inside nodes. Preserve existing outer frames and positions, including Runtime's manually saved frame; do not shrink it while standardizing its inner tiles. New or undersized expanded responsibility leaves need at least 432px width and the row budget. Frozen or locked frames remain protected. This keeps the three saved view geometries stable wherever their existing frames already fit the shared tiles.

## Owner correction

The owner explicitly corrected the scope: outer node cards must also have uniform dimensions. The later visual feedback asks for slightly larger responsibility tiles and smaller internal text. Use 210x80 tiles, 8px gaps, uniform 462x96 collapsed cards and 462x280 detail cards. Render exactly four reserved slots per page and paginate all further responsibilities without updating graph/session geometry. Normalize saved working frames to the shared card dimensions while preserving positions, source confirmations and checkpoints; enlarge only affected parent bounds as needed. Real recursive structure frames retain child containment. Back up the full original workspace JSON before the first uniform-card save. Preserve existing frozen/locked geometry and surface resulting conflicts rather than rewriting frozen ledgers.

## Owner follow-up and verification

The owner requested compact two-responsibility cards as well as four-slot cards, and restored automatic container contraction. The final templates are 462x192 for one or two responsibilities, 462x280 for three or more, and 462x96 when collapsed. All tiles are 210x80 with 8px gaps, 12px titles and 11.5px descriptions. More than four responsibilities paginate within the fixed four-slot frame; missing last-page cells retain space. Pager state stays inside the renderer.

Saved working cards normalize to the shared frames. A bounded migration fits ancestors and resolves resulting unprotected overlaps; protected geometry and historical confirmations remain intact. Both storage bridges retain the original JSON at `<key>:before-uniform-cards-v1`. Updated drafts require reconfirmation. Frame origin stays anchored while right/bottom bounds fit content; explicit user minimum sizes remain. During dragging, retain the current frame until boundary overflow; the same drag transaction performs the final content fit on release.

Native verification confirmed Runtime, TestAgent and JSONL SessionStore use 462x280; ScriptedProvider and Responses use 462x192. All inspected tiles computed to 210x80 with 11.5px body text. Runtime page switching changed only displayed responsibilities: every node frame/position, rendered edge path and routing timing attribute stayed identical. JSONL independently moved in its parent while Session origin stayed fixed; the verification move was undone. Collapsing Responses reduced Provider height 602.638 to 506.638 and reopening restored 602.638; parent and child origins stayed unchanged. This checks actual automatic contraction and expansion rather than only source inspection.

TypeScript checks passed. No automated tests or benchmarks were run. Earlier uncommitted changes remain intact; no commit or push. Browser artifacts are under `.scratch/`.

Final verification: the compact-template and anchored-fit code passed library/browser TypeScript compilation, library/dist validation (160 artifacts), site build and diff whitespace checks. Browser keyboard movement shifted JSONL by 5px independently, grew only Session's right edge by 5px and kept its origin unchanged; undo restored the prior position. Final preview: `.scratch/uniform-cards-and-fit.jpg`. No automated test suite ran.

## Commit scope

Owner requested a Git commit. Stage the isolated three-view/card-layout implementation from the preserved pre-P0 snapshot (2923d12), together with the three task records. Leave the separate draft-confirmation repair and scratch lifecycle changes in the working tree. Existing TypeScript/build and native browser verification apply to this snapshot; the owner subsequently allowed tests for continued development.

Commit coordination update: another session advanced feat/visualization to 2923d12 (this implementation), da23892 (state fixes), and 7de6bed (scratch tooling) while staging was in progress. Preserve those commits and submit only this round's three task records; restore shared-file index entries to HEAD without changing working files.
