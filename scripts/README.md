Owner: `scratch.mjs`, `browser-session.mjs`

# Scratch lifecycle

`.scratch/` holds disposable work. Each task owns one run directory:

```text
.scratch/
├── runs/<task-id>/
│   ├── manifest.json
│   ├── logs/
│   ├── scripts/
│   ├── screenshots/
│   ├── reports/
│   └── agents/<agent-id>/
├── cache/
│   ├── profiles/       temporary browser profiles
│   └── persistent/     explicitly named persistent profiles
└── quarantine/         cleanup staging, never auto-deleted
```

Start a run before writing task artifacts:

```sh
pnpm scratch start --task 2026-11-03-example --title "Example investigation" --source HEAD --agent explore
```

`manifest.json` records `id`, `title`, `createdAt`, `updatedAt`, `status`, `sourceCommit`, `cleanAfter`, `protected`, `recoveryPoints`, and `agents`.

## Cleanup rules

- `active` and `review` runs are never cleaned automatically.
- A run with `protected: true` or any `recoveryPoints` is never cleaned automatically.
- Only `complete` or `expired` runs with a `cleanAfter` date on or before today are eligible.
- `clean` is a dry run by default. `--apply` moves eligible runs to `quarantine/`; `--purge` is required to delete them.
- Top-level legacy scratch directories are not scanned. Move rollback files, stage snapshots, and manual acceptance evidence into a run and protect that run before changing the legacy layout.

Mark manual acceptance evidence protected:

```sh
pnpm scratch update --task 2026-11-03-example --status review --protected
pnpm scratch update --task 2026-11-03-example --recovery .scratch/runs/2026-11-03-example/reports/acceptance.json
```

## Browser acceptance

Use `withEdgePage` from `scripts/browser-session.mjs`. It creates a temporary profile under `cache/profiles`, closes the browser process tree, and removes the profile in a `finally` block, including callback failures.

```js
import { withEdgePage } from '../scripts/browser-session.mjs';

await withEdgePage({ url: 'http://127.0.0.1:5199', settleMs: 1500 }, async ({ evaluate, profile }) => {
  console.log(await evaluate('document.title'));
  console.log(profile);
});
```

- A failed run that needs the complete browser state: create a run first, pass `{ taskId, keepProfile: true }`, and attach the profile path to the run's `recoveryPoints`. The profile is kept for inspection.
- A test that needs persistent login state: pass `{ persistentProfile: 'name' }`. Persistent profiles live under `cache/persistent` and are never removed by `profiles` cleanup.
- After a crash or forced termination, run `pnpm scratch profiles --legacy` first. It checks process command lines and skips occupied profiles. Use `--apply --purge` only after reviewing the report.
- Temporary profiles are removed by the helper; `pnpm scratch profiles` is the recovery path for profiles left by an interrupted process.
