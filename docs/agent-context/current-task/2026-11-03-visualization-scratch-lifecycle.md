# Scratch lifecycle and browser profile cleanup

## Intent

Clean Edge profiles left by completed browser acceptance runs. Make browser teardown deterministic for ordinary runs, retain complete profiles only for failed acceptance evidence, and keep persistent login-state profiles outside automatic cleanup. Replace ad-hoc scratch output with manifest-bearing task runs that protect rollback files, stage snapshots, and manual acceptance artifacts.

## Result

- Added `scripts/browser-session.mjs`. `withEdgePage` creates a temporary profile under `.scratch/cache/profiles`, closes the Edge process tree, and removes the profile in `finally`, including callback failures and SIGINT/SIGTERM. `keepProfile` stores a profile inside an existing run; `persistentProfile` stores a named profile under `.scratch/cache/persistent`, which cleanup never scans.
- Added `scripts/scratch.mjs`: `start`, `update`, `list`, `clean`, and `profiles`. Runs use `runs/<task-id>/{logs,scripts,screenshots,reports,agents}` plus `manifest.json` with task ID, title, timestamps, status, source commit, `cleanAfter`, `protected`, `recoveryPoints`, and agent IDs.
- `clean` is a dry run unless `--apply`; it only considers `complete`/`expired` runs with an elapsed `cleanAfter`, and never touches `active`, `review`, protected, or recovery-bearing runs. Top-level legacy scratch directories are not scanned.
- `profiles` scans temporary profiles and, with `--legacy`, top-level `edge-profile-*`. It skips profiles referenced by a running Edge/Chrome command line. `--apply --purge` is explicit.
- Added `scripts/README.md`; updated `docs/agent-context/AGENTS-en.md` section 6 and `package.json` (`pnpm scratch`). Added local rules in `.scratch/README.md`.
- P0 cleanup: inspected six top-level profiles (`p1`, `p3`, `p41`, `p42`, `p5`, `scale`), confirmed no process used them, and purged them. Report: `.scratch/runs/2026-11-03-scratch-lifecycle/reports/profile-cleanup.json`. Freed 1,515,018,110 bytes across 10,052 files. `visualization-browser/` is an old test app, not a browser profile, and was left untouched. Legacy rollback, stage-snapshot, and acceptance directories were not modified.
- Patched the legacy `.scratch/viz-cdp-probe.mjs` to kill Edge and delete its temporary profile in `finally`.

## Verification

- `node --check scripts/scratch.mjs` and `node --check scripts/browser-session.mjs` passed.
- `pnpm scratch --help` and `pnpm scratch profiles --legacy` (dry run) passed; the dry run reported six unoccupied profiles and no errors.
- After cleanup `.scratch` held 863 files / 16.72 MB. `visualization-backups`, `port-candidates-before`, `visualization-legacy-html-backup-2026-10-21-0911`, and `visualization-validation-bin` remained present and were not scanned by cleanup.
- No automated tests were run.
- No commit or push.

## Migration

- External backup: `D:\Desktop\code\bot\1002bot-scratch-backup-20261103-213844.zip`; SHA-256 `19dfa91472071c8a74bbeb46f616b8467aebe24fba47eed33e6b222051f8deca`; 877 zip entries.
- Moved all legacy top-level artifacts into `.scratch/runs/2026-11-03-legacy-archive/` with 425 initial moves and no errors, then moved the migration script there. The archive is `protected` and its `reports/legacy-migration.json` records every source/destination pair and the backup.
- Top-level `.scratch` now contains only `README.md`, `runs/`, `cache/`, and `quarantine/`. The archive contains 863 files / 17.70 MB; rollback, snapshots, validation, manual evidence, scripts, logs, screenshots, and reports were preserved.
- Recursive byte measurement of old directories hit Windows long-path limits; top-level directory moves themselves succeeded. The migration report marks directory byte sizes as null and records file sizes.
