# Labels on retained routes

## Intent

Keep Legacy as the default and preserve final routed points, ports, manual paths and frozen paths. Add a label-only pass after final route restoration. Generate bounded candidates, exclude node/header/frame collisions, coordinate label occupancy, penalize crossings of other paths and displacement from previous positions, and hide labels with no legal placement. Full View is allowed to hide labels; hover must not reveal an invalid fallback capsule.

Keep text simplification and focus presentation separate from routing. Retain full semantic text for inspection. Preserve protected historical labels and support independent user label pinning with stage/view isolation, history and confirmation. Derived automatic positions and focus state must not dirty confirmations. Verify route equality, label legality and stability with focused tests and native browser checks; preserve the earlier uncommitted card changes.

## Result

Added a final label-only pass with bounded segment/endpoint/side candidates, spatial collision checks, previous-position reuse and a bounded one-label reassignment. Candidate and result caches are isolated by the stage/view baseline. Labels without valid placements have no inline capsule, including on hover, selection and keyboard focus. Full semantic text remains in SVG titles, accessible names and connection details. Display text has a 140px estimate budget; unrelated labels dim during selection. Legacy remains the default and the new pass never edits route points or handles.

Independent label pins are optional workspace content matched to exact display endpoints and canonical member sets. The connection panel can pin the current placement or restore automatic placement. Pins participate in storage, per-view history, confirmation and three-way inheritance. Invalid fixed positions retain their authored data but display hidden. Locking a path while its label is hidden omits the zero-size label, so a later legal placement remains possible. Source-revision rebasing clears removed label intents without altering historical confirmations.

## Verification

- Focused label, pin, Legacy label/cache and display-snapshot tests plus real runtime project integration: 51 passed, zero failed. Logs: `.scratch/runs/2026-11-04-label-layout/logs/focused-tests.txt`.
- Runtime M1/M2 across Overview, Structure and Full: points, handles and node frames are identical before/after the label pass. In these six initial projections, label intersections with other paths fell from 77 to zero, distant labels from one to zero, and visible labels from 50 to 48. M2 Structure and Full each hide one label. Node, header/frame and label overlaps are zero. This comparison uses initial dataset projections.
- Native browser acceptance used a separate storage key seeded from the existing user workspace. Pinning changed confirmation status; undo restored confirmation, redo restored the pin, and refresh retained it. Every rendered SVG path remained identical through pinning and hidden-edge selection. The original storage record stayed byte-identical throughout acceptance.
- In the inherited browser copy of M2 Full, 10 labels are visible and three hidden, with zero measured node/header or label collisions. Keyboard selection of hidden 出队 opens its complete connection details, leaves the capsule hidden and preserves all SVG paths. This is a different saved geometry from the initial-projection comparison.
- Library/browser TypeScript checks, library build/dist validation (166 artifacts), playground build (258 modules) and diff whitespace checks passed.
- Native screenshots, fixture source and metric reports are preserved under the protected `.scratch/runs/2026-11-04-label-layout/` run. Temporary playground fixture files were removed. The normal preview is open at `http://127.0.0.1:5199/`. No commit or push.

Final review also isolated preview pins from the active view and resolved protected label coordinates from their stored world/owner space, including when a pinned path temporarily falls back to another path. Invalid stored label positions remain hidden. Library/browser types and both builds passed again after these integration adjustments.

## Ownership and stability correction intent

Owner approved the follow-up repair after the source audit. Enforce a very strong preference for on-path or tightly attached labels; omit floating labels instead of showing detached fallback positions. Separate routing output, unified labeling and explicit workspace label constraints. Automatic label positions are disposable caches and do not participate in authored three-way merge. Preserve current routing policy and existing path snapshots while eliminating Group label-to-route scoring feedback. Match previous attachment geometry onto updated paths without segment array identities, then apply an explicit switching hysteresis before candidate optimization. Capture node/path/label snapshots from a consistent committed scene after final fitting. Validate continuous movement, bend insertion/removal, release/refresh, aggregation identity and view/stage inheritance in addition to static collisions. Earlier card changes and unrelated AGENTS edits remain intact.


## Ownership and stability correction result

Legacy and Group now generate path geometry without label placement or label-to-route score feedback. Unified final labeling ignores old router label fields. Labels must lie along their owning segment or remain within a 2-world-unit capsule-edge gap; detached candidates and pins hide. Prior geometric attachments project onto compatible new segments before search, with a 20-point improvement threshold for switching. Segment-array indices do not identify attachments. React render drafts fork the committed cache and adopt it only after commit.

Automatic label caches carry semantic endpoint/member identity, route geometry and policy stamps. They are excluded from authored history, confirmation comparison and three-way merges. Independent pins carry canonical endpoint/port fingerprints; obsolete constraints are invalidated while historical confirmations remain literal. Path-only locked snapshots restore without requiring a label.

Final node geometry, paths and labels are captured from one committed frame. Drag release fits parent frames before transaction completion; view/stage navigation and confirm/undo/redo wait for that frame. Constraint changes invalidate old caches before saving. Browser acceptance also found that normalized frames were not written back on first view entry; the committed cache publication now captures the matching node content as well.

Verification: 155 focused tests passed, including real M1/M2 Overview/Structure/Full projections, tight attachment/hiding, projection/hysteresis, abandoned render isolation, pin identity, stage inheritance, route retention and frozen/path-only restore. Both TypeScript checks passed. Library build and dist validation passed (168 artifacts), and playground production build passed. Logs are under .scratch/runs/2026-11-04-label-stability/logs/. The earlier 77-to-zero comparison belongs to the first-wave historical run and is not a current before/after measurement.

Native browser acceptance used a separately keyed copy of the original workspace. After child drag, saved parent geometry and every SVG path matched the rendered frame; reload restored exact geometry, paths and label transforms. Small moves preserved label attachment without side jumps; existing alignment snapping remains active. Undo/redo restored node positions. Zoom preserved world-space paths and labels. Full View normalized geometry and final labels matched saved content and survived reload exactly. The original workspace stayed byte-identical throughout isolated gestures. Old console hook-order errors came from intermediate development hot-reload edits; final clean reload is checked separately. Evidence is under .scratch/runs/2026-11-04-label-stability/reports/ and screenshots/. Temporary fixture sources were archived there and removed from playground after closing their tab. No commit or push.
