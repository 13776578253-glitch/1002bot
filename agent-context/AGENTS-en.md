# AGENTS.md

This document defines how work is done in this repository. If a request conflicts with this document, state the conflict before building.

## 1. Design stance

Before changing an agent's prompts, tools, memory, or context handoff, apply these rules:

- **Design toward the frontier.** A mechanism that exists only to work around a current model limitation is a fallback and must be written, named, and documented as one.
- **Minimal priors.** Prefer semantic instructions that the agent applies with judgment over hard-coded control flow. Reserve control flow for genuinely mechanical work and for cases where a wrong judgment is unrecoverable.

## 2. Repository management

1. **Do not delete history:**
   - Never delete, overwrite, or empty historical records in this document directory.
   - This applies to historical records under `agent-context/`: task records (`current-task/`, `finish-task/`), historical documents (`history/`), and schema snapshots.
   - It does not apply to the directory structure itself, superseded drafts whose results have been recorded (such as old plan files), or content whose deletion is explicitly requested by the repository owner.
2. **Keep records synchronized:**
   - Before changing code, record the intended logic, impact, and verification method in the current task record. Do not put task records in `AGENTS.md`.
   - After changing code, append an update to the task record under `agent-context/current-task/`.

### Documentation requirements for `agent-context`

- Store new content and records of major changes in `current-task/`.
- Store task records by appending. When correcting an existing conclusion, append a correction instead of overwriting the original record.
- When `current-task/` has more than 20 entries, or the repository owner explicitly requests migration, copy the task records to `finish-task/`, verify the copy, and mark the originals as archived. Migration must not lose history.
- Put plans in `plans/`. After completion, copy them to `history/plans/` and mark the archive location in the original plan.

## 3. Writing

These rules apply to comments, documents, commit messages, and reports to the operator. Keep a sentence only when it carries a fact the reader needs and cannot obtain from the code.

- State the conclusion first, then the mechanism.
- State invariants rather than runtime stories or the negotiation that produced them. History belongs in git.
- Do not manufacture contrasts such as “A, not B” when nobody proposed B. Do not paraphrase the request that produced the code. Do not add issue, decision, or section numbers.
- Do not name the bot; write “bot” when a referent is unavoidable.
- A field comment covers one topic in one or two sentences. Put the contract on the interface and the architecture in the module header or owning document.
- Do not add defensive code for states ruled out by the types or caller contract. Validate at real boundaries only.
- Do not test that a mock was called with a constant. Test behavior against real or realistic fake components; when call count is the behavior, say so in the test name.

### Operator-facing milestone reports

Follow [the operator report standard](面向负责人的阶段汇报规范.md) for human-facing milestone progress and architecture reports. Present scope, a simplified overview, component ownership, structural changes from the previous milestone when applicable, separate detailed views, focused mechanism reports, remaining structure when applicable, verification, and scope boundaries in that order. Anchor each major change in the overview and expand that part locally. Keep existing requirements for plans, agent handoffs, logs, review records, documentation owners, and append-only history.

### AI verbosity checklist

Review UI copy, prompts, documentation, code comments, commit messages, and operator reports sentence by sentence. Prefer deleting redundant prose. Preserve factual content, trace vague claims to their implementation, and keep comments only when they explain facts that cannot be inferred from code.

- [ ] **Obvious information:** Remove common knowledge and instructions already evident from the UI.
- [ ] **UI narration:** Remove descriptions of cards, groups, buttons, and layout. Show state in status labels.
- [ ] **Long narratives:** Reduce “this happens here, so you can...” to the necessary behavior, condition, or result.
- [ ] **Manufactured contrast:** Remove “not A but B”, rhetorical turns introduced with dashes, and emphasis without a real distinction.
- [ ] **Jargon and metaphors:** Use ordinary terms for concrete objects and actions. Define necessary terms before using them and follow project naming conventions.
- [ ] **Vague actions:** State what an operation changes and when it takes effect. Replace phrases such as “touches the disk” or “finishes up” with actual behavior.
- [ ] **Hype and reassurance:** Remove praise, subjective modifiers such as “quietly” or “reliably”, and unsupported assurances such as “rest assured”.
- [ ] **Incident history:** Remove incident accounts, fixes, defenses of old designs, and precautionary lectures. Express continuing constraints as current rules.
- [ ] **Layer boundaries:** Keep platform details in their World. Shared entry points must not describe the internals of a particular World, Persona, or bot.
- [ ] **Misplaced information:** Put operational information in the UI, contracts at interfaces, architecture in modules or documentation, and history in git.
- [ ] **Repeated explanations:** State each fact only where needed. Check duplicate copy and other language versions during cleanup.
- [ ] **Accuracy after editing:** Verify retained behavior, conditions, units, and boundaries. Necessary consequences, error causes, and recovery steps must remain accurate and specific.

## 4. Tests

- Assert the contract rather than incidental values: compare with the exported default, not a hard-coded literal.
- Use real components: real Git repositories, real ports, and a real event store. Script only the LLM.
- Test fixtures and documentation examples must not name real vendors or models. The model behind an endpoint is a deployment fact. The shipped default endpoint and extension package names are exceptions because they must name real objects to work.
- Tests must not access the network. Real-service checks belong in `scripts/` and are run manually.

### Test types and locations

Use two testing layers. Place each test according to the scope of the behavior it verifies:

| Test type | Location |
| --- | --- |
| Unit tests for a function, class, or module | Alongside the module under test |
| Collaboration among multiple modules in one package | `tests/integration/` |
| Collaboration across multiple packages | `tests/integration/` |
| End-to-end tests | `tests/e2e/` |
| Architecture-boundary tests | `tests/architecture/` |
| Shared test fixtures | `tests/fixtures/` |
| Test utilities | `tests/helpers/` |
| Third-party provider or external-system tests | A separate location appropriate to the scope |
| Tests for a specific World or environment | A separate dedicated directory |

Do not interpret `__tests__/` as the directory where every test must live. It indicates direct, local verification for the code in that directory. The repository-level `tests/` directory is the system-wide test suite.

## 5. Commands

- Before every commit, `pnpm test` and `pnpm run typecheck` must pass. Check browser code with `pnpm typecheck:web`.
- After changing `src/web/client/`, `src/web/shared/`, or any `console/client.ts`, run `pnpm build:web`. Do not run it while a bot process is alive on this machine because the running console serves the bundle being overwritten.
- Never start a real bot to verify a change. Use tests, `pnpm dev:console` with fake data, or a script under `scratch/`.
- `pnpm logq` queries run logs; `pnpm check:extension <dir>` validates an extension package; `pnpm audit:release` runs the release audit.

## 6. Scratch

Put disposable work such as probes, one-off scripts, dumps, and experiments under `scratch/`. Promote it deliberately only when it becomes a tool.

## 7. Documentation

- Every page under `docs/` and every README for a code unit must name, in its first line, the file or interface it shadows, called its owner. A commit that changes the owner must also change the page.
- Text without a code owner, such as plans, migration records, and decision history, lives in `scratch/` while active and in `deprecated/` when retired. Both are gitignored.
- `PHILOSOPHY.md` is exempt because it is written for first-time readers and may repeat other files.

## 8. Git

- Commit once per milestone: describe the change in one sentence and leave `pnpm test && pnpm run typecheck` green. A commit should be smaller than a feature and larger than one file; an additive step and its migration are separate commits.
- Stage explicit paths. Other sessions may have uncommitted work in this tree, so never use `git add -A`, `git add .`, or `git commit -a`.
- Committing is not pushing. Push, open pull requests, or rewrite published history only when asked.

### Message format

Use Conventional Commits: `<type>(<scope>): <description>`. Type and scope are always lowercase ASCII. Commits made before this rule do not need to follow it and are not rewritten.

| Type | Covers |
| --- | --- |
| `feat` | A capability the operator, Persona, or extension author did not have |
| `fix` | Wrong behavior; the body names the root cause and what proves it gone |
| `refactor` | Same behavior, different shape: renames, extractions, and deletions |
| `perf` | A measured change; the body carries the before and after |
| `docs` | `docs/`, a README, `AGENTS.md`, `PHILOSOPHY.md`, or comments alone |
| `test` | Tests alone |
| `build` | package.json, the lockfile, tsconfig, or bundling |
| `ci` | `.github/` |
| `chore` | What the list above misses and a reader needs nothing from; rare |
| `revert` | The subject repeats the reverted subject; the body is `This reverts commit <sha>.` |

The scope is the unit where the change lives, written as its path with `src/` dropped: `core`, `worlds/pvz`, `providers/llamacpp`, `extensions`, `bots/cortiv`, or `console` for `src/web/`. A one-file change may use the file name itself. Omit the scope only for a repository-wide change; a change needing two scopes is two commits.

The description says what changed and why. Keep the whole subject line under 72 characters with no trailing period. Its language is free; type and scope remain English. Body bullets carry what the diff does not show: the rejected alternative, the invariant relied on, and what the tests now cover.

A change to an on-disk layout, a config key, or the meaning of already-written content requires `!` before the colon and a `BREAKING CHANGE:` footer naming the migration shipped with it.

### Commit information in task records

The following fields may describe a change in a task record; they are not a Git commit-message format:

- `Time`: `YYYY-MM-DD HH:mm`
- `Change`: describe the changed logic and implementation
- `Open issues`: write “none” when there are none
- `Commit suggestion`: use `<type>(<scope>): <description>`

```
feat(core)!: hardTokens moves to the Core config

BREAKING CHANGE: persona.hardTokens is read from core.hardTokens. scripts/migrate-hard-tokens.ts
rewrites a deployment's config in place; dry run by default, backup before writing.
```
