# External Note Folders

This is a plugin for [Obsidian](https://obsidian.md/) that associates Obsidian vault notes with lazily created folders under an external root using UUIDs, preserving stable associations across moves and reorganizations.

## What It Does

External Note Folders links a markdown note to an external folder by storing a canonical UUID in the note's `exnf` frontmatter field and writing the same UUID to a `.exnf` marker file in the external folder.

External folder paths normally mirror the vault-relative note path without `.md`. Folder-note layouts collapse to the parent folder, so `Projects/Alpha/Alpha.md` uses `Projects/Alpha/` instead of `Projects/Alpha/Alpha/`.

The current release supports:

- Assigning an external folder identifier to the active note.
- Opening the note's bound external folder.
- Creating a bound external folder on first open for an already-identified note when no binding exists.
- Adopting exact note/folder matches from a pristine existing external root.
- Integrity preflights before mutating commands.
- Reporting drift between note-derived paths and existing bound external folders.
- Explicitly reconciling existing bound external folders after note renames or moves.

Reconcile is never automatic. The command builds a dry-run plan first and moves folders only after explicit confirmation. It moves existing bound folders to their current note-derived paths, writes a journal entry for each attempted move, never deletes folders or marker files, and stops on the first execution failure.

## Commands

- `Assign external folder identifier`: Adds an `exnf` UUID to the active markdown note if one is missing. It never creates or changes external folders.
- `Open external folder`: Requires an existing valid `exnf` UUID, checks only the active note's expected external folder, opens it when its `.exnf` marker matches, creates it when it is missing, or prompts before adopting it when it already exists without `.exnf`.
- `Adopt existing external folders`: Builds a dry-run plan for a pristine vault/external-root pair and, after confirmation, writes `.exnf` markers first and note frontmatter second for exact one-to-one derived-path matches.
- `Report external folder drift`: Read-only report that compares current note-derived external folder paths against existing external folders, highlights integrity errors, missing/orphaned/unexpected/occupied paths, and suggests likely matches.
- `Reconcile external folders`: Builds a dry-run move plan and, only after explicit confirmation, moves existing bound external folders to their current note-derived paths. It never deletes folders or marker files and stops on first failure.

## Open Behavior and Drift

`Open external folder` is intentionally local and fast. It does not scan the
external root for the current note's UUID in other `.exnf` markers. If a note's
external folder may have been manually renamed or moved, run `Report external
folder drift` or `Reconcile external folders` before opening.

The external root should ideally be dedicated to this plugin. If it contains
unrelated projects, explicit whole-root commands may report orphan `.exnf`
markers or permission warnings from unrelated descendant directories.

## Safety Model

- The vault is the source of truth for note identity.
- Missing external folders are normal and are reported as `Unavailable`, not as integrity errors.
- Duplicate UUIDs, malformed `.exnf` markers, invalid `exnf` frontmatter, configured-root access failures, and occupied target paths block mutating commands.
- The plugin does not delete vault files, external folders, or `.exnf` markers.
- The plugin does not auto-rename folders to resolve conflicts.
- External-root scans skip symlinks, junctions, and reparse points by default.
- Unreadable descendant directories under the external root are reported as warnings and skipped, not treated as global integrity errors.

## Failure Mode Reference

| Situation | `Open external folder` behavior | Whole-root report/reconcile behavior | References |
| --- | --- | --- | --- |
| Active note has no `exnf` | Stops and directs the user to explicit assignment or adoption. | Not treated as an external-folder binding. | [ADR-0001](docs/dev/adr/0001-vault-is-source-of-truth.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md), [ADR-0024](docs/dev/adr/0024-strict-exact-adoption-with-journaled-marker-first-writes.md) |
| Active note has invalid `exnf` | Stops before touching the external root. | Reported as an integrity error. | [ADR-0007](docs/dev/adr/0007-uuid-regeneration-and-manual-edits.md), [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0014](docs/dev/adr/0014-exnf-marker-format-and-validation.md) |
| Expected folder has matching `.exnf` | Opens the expected folder without a whole-root scan. | Reported as OK. | [ADR-0005](docs/dev/adr/0005-bound-folder-marker.md), [ADR-0015](docs/dev/adr/0015-external-folder-path-derivation.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md) |
| Expected folder is missing | Creates the expected folder, writes `.exnf`, and opens it; it does not search for the UUID elsewhere first. | Can report a missing expected folder or an unexpected off-path folder if one exists. | [ADR-0002](docs/dev/adr/0002-missing-external-is-normal.md), [ADR-0015](docs/dev/adr/0015-external-folder-path-derivation.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md) |
| Expected folder exists without `.exnf` | Prompts before writing `.exnf`; confirmation revalidates and never overwrites an existing marker. | Reported as an occupied target path when a bound folder is expected there. | [ADR-0005](docs/dev/adr/0005-bound-folder-marker.md), [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md) |
| Expected folder has malformed or mismatched `.exnf` | Blocks opening through that expected path. | Reported as an integrity error or occupied target. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0014](docs/dev/adr/0014-exnf-marker-format-and-validation.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md) |
| Same UUID is bound somewhere else | Not discovered by `Open external folder`. | Reported as unexpected drift and can be reconciled explicitly. | [ADR-0006](docs/dev/adr/0006-reconcile-is-explicit.md), [ADR-0022](docs/dev/adr/0022-reconcile-planner-and-execution-contract.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md) |
| `.exnf` marker has no matching vault note | Not relevant to the active-note open path. | Reported as an orphan bound folder. | [ADR-0008](docs/dev/adr/0008-no-reverse-reconciliation.md), [ADR-0009](docs/dev/adr/0009-status-model.md) |
| External root or expected path is inaccessible, outside root, or crosses a symlink/reparse point | Stops fail-closed. | Root access failures are errors; descendant unreadable directories are warnings and skipped. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0013](docs/dev/adr/0013-filesystem-boundary-and-path-identity.md) |

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
- Bulk adoption is strict: it requires no existing `exnf` frontmatter or `.exnf` markers and only adopts exact derived-path matches.
- `Report external folder drift` is read-only and can be used before reconcile to inspect missing, orphaned, unexpected, occupied, and likely moved folders without changing the vault or external root.
- `Open external folder` does not assign note identity. Run `Assign external folder identifier` first for notes without `exnf`.
- `Open external folder` does not search for off-path `.exnf` markers. Use drift report or reconcile when manual moves or renames may have happened.
- Concurrent UUID assignment across unsynced devices can create orphan external folders.
- Sync tool conflicts in note frontmatter or external marker files are outside the plugin's repair scope; `Report external folder drift` surfaces the resulting state.

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
- `npm run test:integration` (requires a prepared Obsidian CLI environment)
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
