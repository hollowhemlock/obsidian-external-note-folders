# External Note Folders

This is a plugin for [Obsidian](https://obsidian.md/) that associates Obsidian vault notes with lazily created folders under an external root using UUIDs, preserving stable associations across moves and reorganizations.

## What It Does

External Note Folders links a markdown note to an external folder by storing a canonical UUID in the note's `exf` frontmatter field and writing the same UUID to a `.exf` marker file in the external folder.

Phase 0 supports:

- Assigning an external folder identifier to the active note.
- Opening the note's bound external folder.
- Creating a bound external folder on first open when no binding exists.
- Verifying vault and external-root integrity.

Phase 0 does not rename, move, delete, or reconcile existing external folders after a note is renamed or moved. Reconcile is planned for a later phase and must remain explicit.

## Commands

- `Assign external folder identifier`: Adds an `exf` UUID to the active markdown note if one is missing. It never creates or changes external folders.
- `Open external folder`: Ensures the active note has an `exf` UUID, creates the derived external folder when needed, writes its `.exf` marker, and opens the folder in the system file manager.
- `Verify external folders`: Scans vault frontmatter and the configured external root, then shows grouped `OK`, `Unavailable`, `Warning`, and `Error` results.

## Safety Model

- The vault is the source of truth for note identity.
- Missing external folders are normal and are reported as `Unavailable`, not as integrity errors.
- Duplicate UUIDs, malformed `.exf` markers, invalid `exf` frontmatter, external-root access failures, and occupied target paths block mutating commands.
- The plugin does not delete vault files, external folders, or `.exf` markers.
- The plugin does not auto-rename folders to resolve conflicts.
- External-root scans skip symlinks, junctions, and reparse points by default.

## Known Limitations

- Reconcile is not implemented in Phase 0, so external folders are not moved when notes are renamed or reorganized.
- Concurrent UUID assignment across unsynced devices can create orphan external folders.
- Sync tool conflicts in note frontmatter or external marker files are outside the plugin's repair scope; `Verify external folders` surfaces the resulting state.

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
- `npm run test:integration`
- `npm run test:watch`
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
  is open in Obsidian.
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
