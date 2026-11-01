# Snapshot interface refinement

Time: 2026-11-01
Intent: Simplify the snapshot dialog from the five browser annotations: English management heading and single blue Delete entry, remove creator and detail metrics, use a stage select, and remove the new-snapshot rail button. Keep stage selection local and destructive actions reserved; no workspace or source mutations.
Impact: Snapshot presentation, compact action props and their owning documentation only.
Verification: Package tests/types/builds, required root tests/types, native side-browser visual and keyboard checks. Preserve other sessions' work and staged changes.

Result: Removed creator metadata, source counts, detail metrics/inventory, save/restore entries and new-snapshot button. Added a native stage select using available baseline IDs/labels with dialog-local state. Management uses the reference English heading and a themed blue Delete pill with reserved disabled semantics.
Verification: Package tests 216/216; package typecheck (including web), library build (126 artifacts) and site build passed. Root typecheck passed; root tests 242/242 passed outside the restricted sandbox after the first run hit local fake-service/temp-Git restrictions. Native side-browser checks covered light/dark appearance, the stage dropdown, forward/reverse focus wrapping and Escape restoring trigger focus. Screenshots: .scratch/snapshot-refinement-light.png and .scratch/snapshot-refinement-dark.png.
Open issues: none for this presentation scope. Stage transitions and destructive snapshot actions remain deferred.
Commit suggestion: feat(visualization): simplify snapshot detail controls
