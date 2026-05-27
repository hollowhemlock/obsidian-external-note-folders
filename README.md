# External Note Folders

This is a plugin for [Obsidian](https://obsidian.md/) that associates Obsidian vault notes with lazily created folders under an external root using UUIDs, preserving stable associations across moves and reorganizations.

## What It Does

External Note Folders links a markdown note to an external folder by storing a canonical UUID in the note's `exnf` frontmatter field and writing the same UUID to a `<uuid>.exnf` marker file in the external folder. Legacy fixed `.exnf` markers are read during the 2.0.0 migration window and should be migrated with the explicit migration command.

External folder paths normally mirror the vault-relative note path without `.md`. Folder-note layouts collapse to the parent folder, so `Projects/Alpha/Alpha.md` uses `Projects/Alpha/` instead of `Projects/Alpha/Alpha/`.

The current release supports:

- Assigning an external folder identifier to the active note.
- Opening the note's bound external folder.
- Creating a bound external folder on first open for an already-identified note when no binding exists.
- Adopting exact note/folder matches from mixed existing external roots.
- Integrity preflights before mutating commands.
- Reporting drift between note-derived paths and existing bound external folders.
- Explicitly reconciling existing bound external folders after note renames or moves.

Reconcile is never automatic. The command builds a dry-run plan first and moves folders only after explicit confirmation. It moves existing bound folders to their current note-derived paths, writes a journal entry for each attempted move, never deletes folders or marker files, and stops on the first execution failure.

## Commands

- `Assign external folder identifier`: Adds an `exnf` UUID to the active markdown note if one is missing. It never creates or changes external folders.
- `Open external folder`: Requires an existing valid `exnf` UUID and never assigns note identity. It opens the expected folder immediately when its marker matches; otherwise it runs an active-note recovery scan for fallback cases where the expected folder is missing, unmarked, malformed, or bound to another UUID.
- `Adopt existing external folders`: Builds a dry-run plan for exact one-to-one derived-path matches from notes that do not already have `exnf` identity and, after confirmation, writes `<uuid>.exnf` markers first and note frontmatter second. Unrelated existing identities and markers are warnings; only unsafe rows or root-level scan problems block execution.
- `Report external folder drift`: Read-only report that compares current note-derived external folder paths against existing external folders, highlights integrity errors, missing/orphaned/unexpected/occupied paths, and suggests likely matches.
- `Reconcile external folders`: Builds a dry-run move plan and, only after explicit confirmation, moves existing bound external folders to their current note-derived paths. It never deletes folders or marker files and stops on first failure.
- `Migrate legacy marker files`: Builds a dry-run plan that renames legacy fixed `.exnf` markers to `<uuid>.exnf` and executes only after explicit confirmation.

## Open Behavior and Drift

`Open external folder` must not assign note identity. The recovery behavior keeps
the expected-folder fast path: if the expected folder has a matching marker, it
opens immediately and does not search elsewhere. If expected-folder inspection
fails, the command runs an active-note-scoped recovery scan that can find the
current UUID elsewhere, list exact-name candidates, and show a persistent
copyable modal.

The recovery scan is not a full drift report. It is scoped to the active note and
its exact-name candidates; full root-wide diagnosis still belongs to `Report
external folder drift` and `Reconcile external folders`.

Detailed behavior lives in
[`docs/dev/plans/open-external-folder-recovery.md`](docs/dev/plans/open-external-folder-recovery.md)
and [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md).

The external root can be broad, but broad roots should use ignore patterns for
unrelated source checkouts, fixtures, and temp folders. Ignored folders are not
scanned and do not contribute marker evidence.

## External Root Ignore Patterns

The `External root ignore patterns` setting accepts one pattern per line. The
syntax is a practical `.gitignore`-style subset, relative to the configured
external root:

| Pattern | Meaning |
| --- | --- |
| `temp` | Ignore files or directories named `temp` at any depth. |
| `temp/` | Ignore directories named `temp` at any depth. |
| `/temp/` | Ignore the root-level `temp` directory only. |
| `foo/bar/` | Ignore any `foo/bar` directory subtree. |

Rules:

- Backslashes are normalized to `/`, so pasted Windows paths are accepted.
- A single leading `/` anchors the pattern to the external root. `/Users/ryanh/foo/` means `Users/ryanh/foo/` under the external root, not filesystem path `/Users/ryanh/foo/`.
- Windows drive paths such as `C:/...` and UNC paths such as `//server/share/...` are rejected.
- `!` negation is not supported in v1.
- Matching is case-insensitive on Windows/macOS defaults and case-sensitive on Linux.
- Symlink and junction paths are matched by the walked link path, but scans still do not traverse them.

Starter patterns for this repository layout:

```gitignore
projects/software/obsidian/by_plug/mine/obsidian-external-note-folders/
projects/software/00-general/docs-as-contracts/docs-as-contracts-main/.tmp/
projects/software/00-general/docs-as-contracts/docs-as-contracts-main/.codex-tmp/
```

Pattern semantics follow Git's ignore rules where supported and are implemented
with the [`ignore`](https://github.com/kaelzhang/node-ignore) package. See also
the [Git gitignore documentation](https://git-scm.com/docs/gitignore) and
[ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md).

## Safety Model

- The vault is the source of truth for note identity.
- Missing external folders are normal and are reported as `Unavailable`, not as integrity errors.
- Duplicate UUIDs, malformed marker files, invalid `exnf` frontmatter, configured-root access failures, invalid ignore patterns, and occupied target paths block affected mutating commands.
- The plugin does not delete vault files, external folders, or marker files.
- The plugin does not auto-rename folders to resolve conflicts.
- External-root scans skip symlinks, junctions, and reparse points by default.
- Unreadable descendant directories under the external root are reported as warnings and skipped, not treated as global integrity errors.
- Ignored folders are reported as ignored/unchecked when a known note identity points at them; they are not treated as healthy, missing, drifted, or reconciled.

## Failure Mode Reference

| Situation | `Open external folder` behavior | Whole-root report/reconcile behavior | References |
| --- | --- | --- | --- |
| Active note has no `exnf` | Stops and directs the user to explicit assignment or adoption. | Not treated as an external-folder binding. | [ADR-0001](docs/dev/adr/0001-vault-is-source-of-truth.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md), [ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md) |
| Active note has invalid `exnf` | Stops before touching the external root. | Reported as an integrity error. | [ADR-0007](docs/dev/adr/0007-uuid-regeneration-and-manual-edits.md), [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0014](docs/dev/adr/0014-exnf-marker-format-and-validation.md) |
| Expected folder has matching marker | Opens the expected folder without a recovery scan. Fast path wins even if duplicate markers exist elsewhere. | Reported as OK unless whole-root checks find unrelated integrity issues. | [ADR-0015](docs/dev/adr/0015-external-folder-path-derivation.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| Expected folder is missing | Runs the active-note recovery scan before offering create/open actions. | Can report a missing expected folder or an unexpected off-path folder if one exists. | [ADR-0002](docs/dev/adr/0002-missing-external-is-normal.md), [ADR-0015](docs/dev/adr/0015-external-folder-path-derivation.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md) |
| Expected folder exists without marker | Runs recovery scan and may offer explicit marker adoption after revalidation. | Reported as an occupied target path when a bound folder is expected there. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| Expected folder has malformed or mismatched marker | Does not open the expected path; runs recovery scan and shows the expected-path problem. | Reported as an integrity error or occupied target. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| Same UUID is bound somewhere else | If expected fast path failed, one off-path match can open with a persistent modal; duplicates block auto-open. | Reported as unexpected drift and can be reconciled explicitly. | [ADR-0006](docs/dev/adr/0006-reconcile-is-explicit.md), [ADR-0022](docs/dev/adr/0022-reconcile-planner-and-execution-contract.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md) |
| Marker has no matching vault note | Only shown by open recovery when it is an exact-name candidate or active-note-relevant warning. | Reported as an orphan bound folder. | [ADR-0008](docs/dev/adr/0008-no-reverse-reconciliation.md), [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| External root or expected path is inaccessible, outside root, or crosses a symlink/reparse point | Root/expected-path validation stops fail-closed; skipped descendant directories become recovery warnings. | Root access failures are errors; descendant unreadable directories are warnings and skipped. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0013](docs/dev/adr/0013-filesystem-boundary-and-path-identity.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md) |
| External root ignore pattern matches a folder | Ignored folders are invisible to recovery scans unless the expected folder itself is ignored, in which case expected-folder actions are disabled. | Ignored folders are not traversed; linked ignored folders are ignored/unchecked rather than healthy or missing. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0013](docs/dev/adr/0013-filesystem-boundary-and-path-identity.md), [ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md) |
| Ignore settings contain `!`, Windows drive paths, or UNC paths | Invalid settings block the scan-dependent command with a clear error. | Invalid settings are global blockers because scan evidence would be ambiguous. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md) |

## Obsidian Boundary

Vault note reads use Obsidian's metadata cache, and `exnf` frontmatter writes use
Obsidian's file manager. External-root scans, folder creation, marker writes,
and file-manager launches use Node filesystem/process APIs because they operate
outside the vault.

The plugin does not register vault event handlers or background watchers.
Commands perform fresh scans at command time and serialize mutating work, so
re-entrant vault events are not used to trigger automatic repair or
reconciliation.

## Known Limitations

- Reconcile only moves already-bound external folders to note-derived paths. It does not infer new bindings, repair invalid markers, relink folders, delete folders, or resolve conflicts automatically.
- Bulk adoption is strict but partial: it only adopts exact derived-path matches whose individual target row is safe. Unrelated identities, markers, skipped directories, and ignored directories are reported without suppressing unrelated safe rows.
- `Report external folder drift` is read-only and can be used before reconcile to inspect missing, orphaned, unexpected, occupied, and likely moved folders without changing the vault or external root.
- `Open external folder` does not assign note identity. Run `Assign external folder identifier` first for notes without `exnf`.
- ADR-0025 recovery scans are active-note scoped, not a substitute for full drift reporting. Long-running commands show a start/progress modal, but scan caps, cancellation, and cached indexes are intentionally out of scope until performance requires them.
- Concurrent UUID assignment across unsynced devices can create orphan external folders.
- Sync tool conflicts in note frontmatter or external marker files are outside the plugin's repair scope; `Report external folder drift` surfaces the resulting state.
- Fixed `.exnf` markers are deprecated legacy evidence during the 2.0.0 migration window. New writes create `<uuid>.exnf`; run `Migrate legacy marker files` to rename old markers.

## Contributor Guide

### Project structure

- `src/`: plugin source (entrypoint `main.ts`, core plugin classes, UI samples, editor extensions, styles)
- `scripts/`: local development helpers
- `test/fixtures/`: committed fixture data and disposable sandbox data
- `docs/dev/adr/`: architecture decision records
- `docs/dev/procedures/`: development and release procedures
- `dist/`: build output (generated)

### Build, test, and development commands

- `npm run dev`
- `npm run build`
- `npm run build:clean`
- `npm run lint`
- `npm run format:check`
- `npm run test`
- `npm run test:integration` (fails unless Obsidian CLI is installed, enabled, and connected to a
  running Obsidian runtime)
- `npm run test:watch`
- `npm run release:update-versions`
- `npm run release:check-versions`
- `npm run release:check-assets`
- `npm run fixtures:new-sandbox`
- `npm run fixtures:refresh-sandbox`

### Commit conventions

Use format: `<type>: <description>`
Local enforcement uses Husky `commit-msg` hook (installed by `npm install` via `prepare`).

| Prefix | Purpose | Typical Impact |
| --- | --- | --- |
| `feat` | Add a new feature | Minor (unless `!`) |
| `fix` | Fix a bug | Patch (unless `!`) |
| `docs` | Documentation-only changes | None / internal |
| `style` | Formatting (whitespace, lint formatting), no behavior change | None / internal |
| `refactor` | Code change that neither fixes a bug nor adds a feature | None / internal |
| `perf` | Performance improvement | Patch/Minor (depends) |
| `test` | Add or adjust tests | None / internal |
| `build` | Build system or external dependencies | None / internal (or release tooling) |
| `ci` | CI configuration/scripts | None / internal |
| `chore` | Maintenance tasks, misc changes | None / internal |
| `revert` | Revert a previous commit | Patch (usually) |

### Local git hooks

- Hook manager: Husky
- Installed automatically on `npm install` via `npm run prepare`
- Commit messages are validated locally by `.husky/commit-msg`
- To reinstall hooks manually: `npm run prepare`
- CI also enforces the same rule in `.github/workflows/commit-message-lint.yml`

### Release process

Feature and fix PRs should not manually update `package.json`, `manifest.json`,
`CHANGELOG.md`, or `versions.json` for versioning. Merge normal work into
`main` using conventional commit messages; Release Please opens or updates a
separate release PR with the package and manifest version bump plus changelog.

Release PRs must also keep `versions.json` current. CI runs
`npm run release:check-versions`; the `release-versions` workflow updates and
commits `versions.json` automatically on Release Please PR branches.

Review and merge the release PR only when you intend to publish a release. After
that merge, Release Please creates the GitHub release and tag. The release asset
workflow then builds the plugin with Node 24, validates the tag and manifest
version, and uploads `main.js`, `styles.css`, and `manifest.json` to the
release. The same workflow can be run manually for an existing tag if release
asset publishing needs to be retried.

Release automation requires a `RELEASE_PLEASE_TOKEN` repository secret backed by
a maintainer-owned PAT or GitHub App token. The token must be able to write
contents, write pull requests, create releases, and trigger follow-up workflows.
The default `GITHUB_TOKEN` is intentionally not used because bot-authored
release PR updates and releases can otherwise fail to trigger CI or asset
publishing. Repository Actions workflow permissions must also allow read/write
access and GitHub Actions pull request creation.

`versions.json` represents published Obsidian-compatible releases and is updated
in reviewed release PRs, not by the post-release asset workflow. See
`docs/dev/procedures/release.md` for the full release checklist and recovery
steps.

### Development policy references

- Product intent: `docs/dev/product/intent.md`
- TDD workflow: `docs/dev/procedures/tdd-workflow.md`
- MVP implementation workflow: `docs/dev/procedures/mvp-implementation-workflow.md`
- Review gate policy: `docs/dev/procedures/commit-pull-request-merge-review-gate.md`
- MVP validation: `docs/dev/procedures/mvp-validation.md`
- ADR index: `docs/dev/adr/README.md`

## Installation

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/hollowhemlock/obsidian-external-note-folders).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

The plugin writes command outcomes and verification summaries to the Obsidian DevTools console with
the prefix `[external-note-folders]`. Normal outcome logs use `console.debug`, so enable `Verbose`
logs in the console settings to see them. Warnings and errors are always shown by default.

To inspect logs, open `Developer Tools` in Obsidian and filter the console for:

```text
[external-note-folders]
```

The plugin does not use `window.DEBUG`.

## Development Fixtures

- Fixture layout lives in `test/fixtures`.
- Run `npm run fixtures:new-sandbox` to create `sandbox/vault` and `sandbox/external-root`
  from committed fixture data.
- Run `npm run fixtures:refresh-sandbox` to refresh note/external-root content while preserving
  `sandbox/vault/.obsidian`.
- `npm run test:integration` uses `fixtures:refresh-sandbox` so it can run while the sandbox vault
  is open in Obsidian. The GitHub integration workflow is manual-only and requires an online
  self-hosted runner labeled `obsidian-cli`.
- Formal semantic fixture scenarios live under
  `test/fixtures/fixture/{vault,external-root}/<domain>/<scenario-slug>` with expected JSON under
  `test/fixtures/fixture/expected/<domain>/<scenario-slug>.json`. Workflow fixtures that
  intentionally assert user-visible command paths may use
  `test/fixtures/fixture/{vault,external-root}/tests/<domain>/...`.
- Integration tests are split by workflow under `test/integration/<domain>.integration.test.ts`.
- Run `npm run fixtures:open-fixture` or `npm run fixtures:open-sandbox` to open either test vault
  directly in Obsidian.
- Run `npm run vault:open -- <vault-path>` to open a specific vault path.
- `scripts/dev.ts` targets `test/fixtures/sandbox/vault/.obsidian` as the default dev vault.

Environment support for additional Obsidian config folders is available in `scripts/dev.ts`:

- `OBSIDIAN_CONFIG_FOLDER` for one extra `.obsidian` path
- `OBSIDIAN_CONFIG_FOLDERS` for a comma-separated list of extra `.obsidian` paths

Example values are in `.env.example`.

## License

© [Ryan](https://github.com/hollowhemlock/)
