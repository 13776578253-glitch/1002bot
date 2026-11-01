# Project data and authored M0 layout

Replace the report catalog as the active Playground input with a versioned project. Preserve the report catalog and a byte-identical backup, and keep its workspace key untouched.

Source stages contain component, relation and contract facts with references. Each stage declares upserts and removals against its explicit predecessor. Source records contain no positions or React state.

Views select source components, assign their display hierarchy, authored frames and ports, and define overview/detail relations with explicit refinement and expansion visibility. A detail is enabled only by its view rule. Raw relation identity remains traceable through sourceRelationIds.

The project workspace stores each stage's overrides, container states, draft, confirmed snapshot and confirmation checkpoints. Use a project-specific persistence adapter to bridge the existing canvas contract. Historical keys are not overwritten or implicitly migrated into the new empty stage.

Manual mode requires a frame for every displayed node. Initialization, container toggles, stage navigation and dragging preserve authored or saved geometry; no grid, gap search, neighbor displacement or automatic container growth runs for this mode. Missing geometry fails at the project boundary. Automatic line routing remains available until explicitly retained by the user.

Start with M0 only; its initial content follows the owner's clarification. Do not infer M1-M6 facts into the new stages. Keep the prior report adapter usable for the archived dataset.

Verify non-empty nested fixtures in addition to M0: source delta inheritance, view/source separation, overview/detail exclusivity, required coordinates, manual geometry stability, overrides and container restoration, repeated confirmation checkpoints, storage isolation, package tests/types/build, root tests/types and native browser restoration.
