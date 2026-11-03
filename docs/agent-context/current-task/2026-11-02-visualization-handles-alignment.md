# Canvas handles and authored-layout alignment

## Intent

Hide routing handles during ordinary node selection and hover. Restore drag alignment in authored project layouts using the existing six-screen-pixel edge/centre snap rule. Preserve neighbour geometry, locked nodes, container bounds, multi-selection relative positions, route protection, history and persistence. Keep Legacy default; defer routing performance work.

Share snap calculation between automatic and authored movement. Verify zoom thresholds, nested world coordinates, multi-selection, rejected snaps and saved geometry with package tests, types and native browser dragging. Inspect Source/View/Workspace boundaries to outline the next real-data slice without replacing the dataset in this UI change.

## Result

- Removed the selected/hovered card rule exposing every physical routing handle. Handles stay mounted and transparent.
- Extracted edge/centre snap calculation in constraints.ts. Authored dragging now uses it with the same six-screen-pixel threshold, world-space targets and uniform movable-root displacement. Hidden nodes, moving descendants and ancestors are excluded; locked nodes remain anchors. Illegal snaps fall back to a legal unsnapped move; rejected movement clears guides.
- Added four integration cases covering zoom, unchanged neighbours and frames, persistence round trip, nested world coordinates, hidden targets, multiple selection, lock protection, overlap and bounds.
- Native browser: dragged World from local (909.396, 619.45) to (936.048, 620.38); Provider remained (517.153, 620.38), all other node transforms unchanged. Selected/hovered handles visible count was zero. One undo restored all original transforms; reload preserved that restored layout. Final selection screenshot: .scratch/alignment-ui-final.png. User geometry restored after verification.
- Package tests 315/315; root tests 242/242; package/browser and root types pass; library build verified 154 artifacts; web build and whitespace check pass. The first sandboxed root run failed local test transports/temp Git access; the unrestricted repository-test rerun passed.
- UI skill search could not run because Python is not installed; applied the skill's general progressive-disclosure guidance and verified the observable result directly.

## Next real-data slice

The current M0 view already references the historical M1 report. Keep its six-block overview and add one reviewed M1 detail slice at a time, starting with Runtime. Source facts need report/implementation references and stable IDs; Stage selects facts, View defines mutually exclusive overview/detail mappings and authored frames, Workspace saves user arrangement. Keep State and protocol contracts in Source unless a particular view needs them. Review each source relation and its displayed meaning before advancing to later stages. This change does not bulk-import the old report fixture or change either routing engine.

## Archive

Byte-identical record copy: docs/agent-context/finish-task/2026-11-02-visualization-handles-alignment-snapshot/2026-11-02-visualization-handles-alignment.md. SHA-256 is recorded in MANIFEST.json.

Commit suggestion: fix(visualization): hide port slots and restore drag alignment

## Follow-up: guide endpoints

Owner feedback shows a short guide protruding beyond the outer card. Remove the 12px endpoint extension from the shared alignment calculation; keep card/label clipping and snap positions unchanged. Per owner instruction, do not run automated tests for this adjustment. The earlier archive remains the completed first-change snapshot.

Removed both horizontal and vertical endpoint extensions. No automated checks run; this follow-up is left uncommitted.

## Follow-up regression

Owner requested a regression for the guide endpoint change. `src/react/model/__tests__/alignment-guides.test.ts` asserts both axes terminate at the card-bound union, without the former 12px exterior. Package tests pass 334/334; package typecheck passes.
