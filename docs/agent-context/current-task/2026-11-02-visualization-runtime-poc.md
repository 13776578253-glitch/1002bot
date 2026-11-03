# M1/M2 Runtime architecture slice

## Intent

Build a separately registered project from the historical M1 and M2 reports, retaining the existing M0 project and workspace. Model components and independently collaborating entities as nodes; keep Runtime's M1 Event loop, lifecycle and write barriers as expandable responsibility blocks. M2 adds Console, InputChannel and InputRun while retaining the direct Event compatibility path outside FIFO. Author all geometry in external View JSON.

Extend generic contracts only for responsibility content, relationship semantics and ownership/lifecycle types. Stage selection owns applicability; presentation rules own mutually exclusive overview/detail edges. Use sourceRelationIds/refines to preserve provenance. Render expanded responsibility cards without fake children and include their full geometry in routing obstacles. Keep routing engines and performance work unchanged.

Verify type/build boundaries and inspect the real data in the native browser: M1/M2 switching, nested expansion, actual endpoints, compatibility path and persistence. Do not include the pre-existing guide follow-up or deleted historical screenshots in this change.

## Implementation

- Registered runtime-evolution as the default preview project. Existing 1002bot M0 files and its project-specific storage key remain separate. Source is split into Runtime, collaborators and contracts catalogs; Stages and Views are separate external JSON assets.
- M1 selection 16d69bf0 has 11 view nodes; M2 selection b7762c73 has 14. M2 adds Console, InputChannel and InputRun, replaces TestAgent with ConversationAgent, and retains direct Event execution. Source implementation references for M2 point to git:750bc45 paths, verified against historical Runtime and ConversationAgent code.
- Source details become expandable in-card responsibility blocks, with no child entity IDs. Actual children use recursive structures. View details may select the responsibilities shown at a stage. Header geometry, clipping, bounds and protected-route checks include responsibility rows.
- Added dependency/interaction semantics and distinct ownership, implementation and lifecycle relation kinds. Stage selection owns applicability. View sourceRelationIds/refines/visibility preserve facts and switch overview/detail edges exclusively. Dependency edges use dashed lines and explicit dependency labels. Stable overview mappings remain inherited when new facts extend their previous member set; new input detail edges are added. Component previousId identifies the Agent implementation replacement.
- Workspace restore retains positions and per-stage saved shapes. Introducing real children to an expanded responsibility card uses the target authored container dimensions. Same-stage restoration keeps user geometry.

## Review and verification

- Read-only source review confirmed Runtime/InputChannel/InputRun ownership, final versus process writes, and old Event bypassing FIFO. Corrected InputRun's history wording: it reads Session facts; ConversationAgent chooses successful complete turns. Interface/implementation relationships use implementation rather than ownership.
- Native browser verified M1→M2→M1→M2; M1 Runtime remains one card with six responsibility blocks. Agent and its TestAgent child expand independently. M2 Runtime contains InputChannel/InputRun; their responsibility cards and collaborator containers expand recursively.
- Refresh retained M2 nested expansion. Collapsed M2 shows history-dependency as a dashed relation; expanding Runtime removes it and restores actual Runtime/InputRun storage and Agent endpoints. M2 console submit/output, channel dispatch, final write and legacy Event edges remained present together.
- Full M1 view: 11 visible nodes and no conflict/blocked-route notice. Full M2 view: 14 visible nodes, 13 display relations, no conflict/blocked-route notice. Screenshots: .scratch/runtime-poc-m1.png and .scratch/runtime-poc-m2.png. The side browser remains on M2 for annotation.
- Package and browser typechecks, snapshot-id check, library build (154 artifacts), site build and whitespace check passed. No automated test suites or scale benchmarks were run in this round. No Git commit was made; prior guide edits and pre-existing historical screenshot deletions remain outside this task's scope.

## Archive

Byte-identical task record: docs/agent-context/finish-task/2026-11-02-visualization-runtime-poc-snapshot/2026-11-02-visualization-runtime-poc.md. MANIFEST.json records its SHA-256.
