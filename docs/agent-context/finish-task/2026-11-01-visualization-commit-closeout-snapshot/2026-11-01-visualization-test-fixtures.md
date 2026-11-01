# Visualization test fixtures migration

Intent: Move the former visualization example baselines and recursive fixture to `packages/visualization/tests/fixtures`, update their imports, TypeScript include lists, and the package README. Preserve the sample graph and its test coverage; the active project dataset and Playground entry remain separate.

Verification: run the visualization package tests, core and web typechecks, and the library and Playground builds; check that no active imports reference the retired directory.

Result: Moved both sample modules to `tests/fixtures`, updated all four test imports, removed the retired examples includes, and updated the package README. Visualization tests passed 216/216; core and web typechecks passed; no active retired imports remain and git diff --check passed. Library and site builds were not rerun because this migration changes only test fixtures, test imports and TypeScript file selection.

Archive: `docs/agent-context/finish-task/2026-11-01-visualization-test-fixtures-snapshot/README.md`; the original task record remains in current-task.
