# External Note Folders

This is a plugin for [Obsidian](https://obsidian.md/) that associates Obsidian vault notes with lazily created folders under an external root using UUIDs, preserving stable associations across moves and reorganizations.

## What It Does

External Note Folders links a markdown note to an external folder by storing a canonical UUID in the note's `exnf` frontmatter field and creating an empty `<uuid>.exnf` marker file in the external folder. The canonical filename is the marker's complete identity; its contents are never read. Legacy fixed `.exnf` markers are read during the 2.0.0 migration window and should be migrated with the explicit migration command.

External folder paths normally mirror the vault-relative note path without `.md`. Folder-note layouts collapse to the parent folder, so `Projects/Alpha/Alpha.md` uses `Projects/Alpha/` instead of `Projects/Alpha/Alpha/`.

The current release supports:

- Assigning an external folder identifier to the active note.
- Setting up and opening an external folder for the active note in one command.
- Opening the note's bound external folder.
- Creating a bound external folder on first open for an already-identified note when no binding exists.
- Adopting exact note/folder matches from mixed existing external roots.
- Suggesting equivalently named unassigned notes and external folders whose relative paths have diverged.
- Scoped safety preflights before external-root mutations.
- Reporting drift between note-derived paths and existing bound external folders.
- Explicitly reconciling existing bound external folders after note renames or moves.

Reconcile is never automatic. The command builds a dry-run plan first and moves folders only after explicit confirmation. It moves existing bound folders to their current note-derived paths, writes a journal entry for each attempted move, never deletes folders or marker files, and stops on the first execution failure.

## Commands

- `Assign external folder identifier`: Adds an `exnf` UUID to the active markdown note if one is missing. It never creates or changes external folders.
- `Set up external folder`: The recommended one-command workflow. It creates and opens a missing expected folder immediately, confirms before binding an existing unmarked folder, and can explicitly restore one unique imported exact-path marker identity after a complete uniqueness scan.
- `Open external folder`: Requires an existing valid `exnf` UUID and never assigns note identity. It opens the expected folder immediately when its marker matches; otherwise it runs an active-note recovery scan for fallback cases where the expected folder is missing, unmarked, malformed, or bound to another UUID.
- `Adopt exact-path external folders`: Builds a leaf-first dry-run plan for exact derived-path matches from notes that do not already have `exnf` identity. When exact candidates overlap, only the deepest candidates are eligible, and targets overlapping an already-identified note or marked folder are blocked, so adoption never creates nested identities or bound folders. After confirmation, the command writes `<uuid>.exnf` markers first and note frontmatter second. The legacy command ID remains unchanged so existing hotkeys continue to work.
- `Suggest moved external folder matches`: Builds a read-only report of unassigned notes and unmarked external folders with identical literal names but divergent relative paths. Only names that are unique among checked eligible paths are suggested; ambiguous names are summarized, and ignored or skipped subtrees are explicitly unchecked. This command never assigns UUIDs, writes markers, moves folders, or adopts a suggestion.
- `Report external folder drift`: Read-only report that compares current note-derived external folder paths against existing external folders, highlights integrity errors, missing/orphaned/unexpected/occupied paths, and suggests likely matches.
- `External folder status`: Opens or focuses the shared status tree for the active vault and external root. Defaults to scanning and showing all folders. Command-specific settings optionally exclude branches from scanning. Inspect exact-path, YAML, and marker evidence; preview adoption or a selected binding repair before confirming. Refresh explicitly to rescan; Cancel retains the previous result. The existing command ID and hotkeys remain unchanged.
- `Resume folder adoption…`: Lists pending single-folder operations, even when their markers hide them from the unmarked report. Revalidates before resuming. An uncertain rename requires manual inspection of note locations and links before verifying completion.
- `Reconcile external folders`: Builds a dry-run move plan and, only after explicit confirmation, moves existing bound external folders to their current note-derived paths. It never deletes folders or marker files and stops on first failure.
- `Migrate legacy marker files`: Builds a dry-run plan that renames legacy fixed `.exnf` markers to `<uuid>.exnf` and executes only after explicit confirmation.

Every report and dry-run plan begins with the absolute active-vault path and configured external-root path. The same context is prepended to its copyable text so captured reports can be traced to the filesystem roots they describe.

When Open external folder cannot confirm the expected folder immediately, its
search popup explains why and shows the note, full expected folder path, external
root being searched, and matching `<uuid>.exnf` filename. Recovery also checks
legacy markers and folders with the expected name. The results explain whether a
match was opened, duplicates need resolution, no match was found, or scan errors
blocked recovery. Same-name candidates require review before association, and
warnings disclose ignored or skipped folders that were not checked.

## Pragmatic Solution

Normal setup checks only the active note, its expected path, path ancestors, and
an existing target subtree. It does not verify an unrelated broad external root.
Restoring an imported marker is different: the plugin scans the complete
non-ignored root because the UUID could also exist in another folder.

For canonical `<uuid>.exnf` markers, the filename is the whole identity. Marker
contents are opaque and may be empty or contain arbitrary data; the plugin never
reads or rewrites them. Legacy fixed `.exnf` markers still require a strict UUID
payload because their filename carries no identity.

Delayed synchronization can place multiple UUID marker files in one folder.
The plugin preserves every marker. If the note's marker is present, opening
succeeds with a warning about the additional UUIDs; setup never overwrites or
chooses among competing identities. Explicit exact-path restoration is a
user-confirmed recovery action, not automatic reverse reconciliation.

## Open the Bound Note from an External Folder

The plugin does not add shortcuts or Markdown launchers to external folders. If
you want terminal navigation in the other direction, add an `exnf-open` helper
to your shell profile. The helper reads the canonical `<uuid>.exnf` marker in
the current directory, searches the configured vault for the matching `exnf`
property, and opens the single matching note through the official Obsidian CLI.
It does not modify the note, marker, or external folder.

This requires Obsidian 1.12.7 or newer with **Settings -> General -> Command
line interface** enabled. Set `EXNF_VAULT` to the vault name or vault ID. The
Obsidian app can already be running; otherwise, the CLI starts it.

### PowerShell

Add this to your PowerShell profile (for example, `$PROFILE`):

```powershell
$env:EXNF_VAULT = 'Your Vault Name'

function Open-ExnfNote {
    $vault = $env:EXNF_VAULT
    if ([string]::IsNullOrWhiteSpace($vault)) {
        throw 'Set EXNF_VAULT to an Obsidian vault name or ID.'
    }

    $uuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.exnf$'
    $markerFiles = @(Get-ChildItem -LiteralPath (Get-Location) -File |
        Where-Object { $_.Name -clike '*.exnf' })
    if ($markerFiles.Count -ne 1) {
        throw "Expected exactly one .exnf marker file; found $($markerFiles.Count)."
    }
    if ($markerFiles[0].Name -cnotmatch $uuidPattern) {
        throw "Marker filename is not a canonical UUID: $($markerFiles[0].Name)"
    }

    $uuid = [IO.Path]::GetFileNameWithoutExtension($markerFiles[0].Name)
    $notes = @(& obsidian "vault=$vault" search "query=[exnf:$uuid]" |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($LASTEXITCODE -ne 0) {
        throw 'Obsidian CLI search failed.'
    }
    if ($notes.Count -ne 1) {
        throw "Expected exactly one note with exnf $uuid; found $($notes.Count)."
    }

    & obsidian "vault=$vault" open "path=$($notes[0])"
}

Set-Alias exnf-open Open-ExnfNote
```

### Bash (Linux and macOS)

Add this to `~/.bashrc` (Linux) or your Bash profile on macOS:

```bash
export EXNF_VAULT='Your Vault Name'

exnf-open() {
    if [[ -z "${EXNF_VAULT:-}" ]]; then
        echo 'Set EXNF_VAULT to an Obsidian vault name or ID.' >&2
        return 1
    fi

    local marker name uuid output
    local -a marker_files=() notes=()
    for marker in ./*.exnf; do
        [[ -e "$marker" ]] || continue
        marker_files+=("$marker")
    done
    if (( ${#marker_files[@]} != 1 )); then
        echo "Expected exactly one .exnf marker file; found ${#marker_files[@]}." >&2
        return 1
    fi

    marker=${marker_files[0]}
    name=${marker#./}
    if [[ ! $name =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.exnf$ ]]; then
        echo "Marker filename is not a canonical UUID: $name" >&2
        return 1
    fi

    uuid=${marker#./}
    uuid=${uuid%.exnf}
    if ! output=$(obsidian "vault=$EXNF_VAULT" search "query=[exnf:$uuid]"); then
        echo 'Obsidian CLI search failed.' >&2
        return 1
    fi
    if [[ -n $output ]]; then
        while IFS= read -r note; do
            notes+=("$note")
        done <<< "$output"
    fi
    if (( ${#notes[@]} != 1 )); then
        echo "Expected exactly one note with exnf $uuid; found ${#notes[@]}." >&2
        return 1
    fi

    obsidian "vault=$EXNF_VAULT" open "path=${notes[0]}"
}
```

From a bound external folder, run `exnf-open`. The helper deliberately refuses
to guess when the directory has no marker, has a legacy or malformed marker,
has more than one `*.exnf` file, or the vault search returns zero or multiple
notes. It only checks the current directory; run it from the bound folder that
contains the marker.

See the [Obsidian CLI documentation](https://obsidian.md/help/cli) for CLI
installation and platform-specific setup.

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
- A single leading `/` anchors the pattern to the external root. `/Users/alice/foo/` means `Users/alice/foo/` under the external root, not filesystem path `/Users/alice/foo/`.
- Windows drive paths such as `C:/...` and UNC paths such as `//server/share/...` are rejected.
- `!` negation is not supported in v1.
- Matching is case-insensitive on Windows/macOS defaults and case-sensitive on Linux.
- Symlink and junction paths are matched by the walked link path, but scans still do not traverse them.

Starter patterns for this repository layout:

```gitignore
projects/software/obsidian/by_plug/mine/obsidian-external-note-folders/
projects/software/00-general/docs-as-contracts/docs-as-contracts-main/.tmp/
```

Pattern semantics follow Git's ignore rules where supported and are implemented
with the [`ignore`](https://github.com/kaelzhang/node-ignore) package. See also
the [Git gitignore documentation](https://git-scm.com/docs/gitignore) and
[ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md).

## Safety Model

- The vault is the source of truth for note identity.
- Missing external folders are normal and are reported as `Unavailable`, not as integrity errors.
- Duplicate UUIDs, malformed marker filenames or legacy marker contents, invalid `exnf` frontmatter, configured-root access failures, invalid ignore patterns, and occupied target paths block affected mutating commands.
- The plugin does not delete vault files, external folders, or marker files.
- The plugin does not auto-rename folders to resolve conflicts.
- External-root scans skip symlinks, junctions, and reparse points by default.
- Unreadable descendant directories under the external root are grouped as warnings and skipped, not treated as global integrity errors. Adoption blocks any candidate that contains or falls inside a skipped subtree.
- Ignored folders are reported as ignored/unchecked when a known note identity points at them; they are not treated as healthy, missing, drifted, or reconciled.

## Failure Mode Reference

| Situation | `Open external folder` behavior | Whole-root report/reconcile behavior | References |
| --- | --- | --- | --- |
| Active note has no `exnf` | Stops and directs the user to `Set up external folder`. | Not treated as an external-folder binding. | [ADR-0001](docs/dev/adr/0001-vault-is-source-of-truth.md), [ADR-0023](docs/dev/adr/0023-open-external-folder-does-not-assign-identity.md), [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Unassigned note and expected folder is missing | `Set up external folder` creates an empty canonical marker, writes note identity marker-first through a setup journal, then opens the folder. | Missing unassigned paths are not bindings. | [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Unassigned note and expected folder is unmarked | Setup scans the target topology and requires confirmation before binding it. | Exact-path adoption remains available for bulk work. | [ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md), [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Unassigned note and expected folder has one imported UUID identity | Setup scans the complete non-ignored root and offers confirmation only when the UUID is unique and unused in the vault. Skipped evidence blocks restoration; configured ignores are disclosed as unchecked. | The marker remains orphan evidence until restored. | [ADR-0008](docs/dev/adr/0008-no-reverse-reconciliation.md), [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Active note has invalid `exnf` | Stops before touching the external root. | Reported as an integrity error. | [ADR-0007](docs/dev/adr/0007-uuid-regeneration-and-manual-edits.md), [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0014](docs/dev/adr/0014-exnf-marker-format-and-validation.md) |
| Expected folder has matching marker | Opens without a root scan. Additional UUID markers in that folder produce a warning and are never overwritten. | Reported as current plus stale/orphan/misplaced evidence. | [ADR-0015](docs/dev/adr/0015-external-folder-path-derivation.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| Canonical marker contains arbitrary or unreadable data | Content is not read; the canonical filename supplies identity. | Classified from the filename. | [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| Expected folder is missing | Runs the active-note recovery scan before offering create/open actions. | Can report a missing expected folder or an unexpected off-path folder if one exists. | [ADR-0002](docs/dev/adr/0002-missing-external-is-normal.md), [ADR-0015](docs/dev/adr/0015-external-folder-path-derivation.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md) |
| Expected folder exists without marker | Runs recovery scan and may offer explicit marker adoption after revalidation. | Reported as an occupied target path when a bound folder is expected there. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| Expected folder has a malformed marker filename, malformed legacy marker content, or a different marker UUID | Does not open the expected path; runs recovery scan and shows the expected-path problem. | Reported as an integrity error or occupied target. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| Same UUID is bound somewhere else | If expected fast path failed, one off-path match can open with a persistent modal; duplicates block auto-open. | Reported as unexpected drift and can be reconciled explicitly. | [ADR-0006](docs/dev/adr/0006-reconcile-is-explicit.md), [ADR-0022](docs/dev/adr/0022-reconcile-planner-and-execution-contract.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md) |
| Marker has no matching vault note | Only shown by open recovery when it is an exact-name candidate or active-note-relevant warning. | Reported as an orphan bound folder. | [ADR-0008](docs/dev/adr/0008-no-reverse-reconciliation.md), [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md), [ADR-0027](docs/dev/adr/0027-uuid-named-marker-files.md) |
| External root or expected path is inaccessible, outside root, or crosses a symlink/reparse point | Root/expected-path validation stops fail-closed; skipped descendant directories become recovery warnings. | Root access failures are errors; descendant unreadable directories are warnings and skipped. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0013](docs/dev/adr/0013-filesystem-boundary-and-path-identity.md), [ADR-0025](docs/dev/adr/0025-active-note-open-recovery-scan.md) |
| External root ignore pattern matches a folder | Ignored folders are invisible to recovery scans unless the expected folder itself is ignored, in which case expected-folder actions are disabled. | Ignored folders are not traversed; linked ignored folders are ignored/unchecked rather than healthy or missing. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0013](docs/dev/adr/0013-filesystem-boundary-and-path-identity.md), [ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md) |
| Ignore settings contain `!`, Windows drive paths, or UNC paths | Invalid settings block the scan-dependent command with a clear error. | Invalid settings are global blockers because scan evidence would be ambiguous. | [ADR-0009](docs/dev/adr/0009-status-model.md), [ADR-0026](docs/dev/adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md) |
| Folder or marker arrives during setup execution | Execution-time inspection treats the plan as stale and does not overwrite the new evidence. | Later reports show the resulting evidence. | [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Setup journal stops before `folder-create` | Resume revalidates the path and creates only an absent target, or accepts the empty folder created by the interrupted run. | The journaled UUID is retained; unexpected content blocks resume. | [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Setup journal stops before `marker-write` | Resume requires the newly created target to remain empty and unmarked, or the confirmed existing target to retain compatible evidence. | The marker is written exclusively; payload and competing markers are never overwritten. | [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Setup journal stops before `frontmatter-write` | Resume requires the matching journaled marker, then writes that same UUID to the still-unassigned note. | A conflicting note identity or changed marker blocks resume. | [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |
| Setup journal is complete but opening fails | The binding stays complete and the opener error is reported separately. | Rerunning setup follows the normal bound-folder open path. | [ADR-0031](docs/dev/adr/0031-pragmatic-active-note-setup.md) |

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
- Bulk adoption is strict, partial, and leaf-first: it only adopts deepest exact derived-path matches whose individual target row is safe. Existing bindings and planned leaves are pruned from a compact residual-tree summary; malformed, duplicate, and skipped evidence remains visible as grouped warnings or blocked candidates, while configured ignores appear as notices. Residual directories are informational and are never modified.
- `Report external folder drift` is read-only and can be used before reconcile to inspect missing, orphaned, unexpected, occupied, and likely moved folders without changing the vault or external root.
- `Open external folder` does not assign note identity. Use `Set up external folder` for the one-command workflow or `Assign external folder identifier` when identity should exist before a folder.
- ADR-0025 recovery scans are active-note scoped, not a substitute for full drift reporting. Long-running commands show a start/progress modal, but scan caps, cancellation, and cached indexes are intentionally out of scope until performance requires them.
- Concurrent UUID assignment across unsynced devices can create orphan external folders.
- Sync tool conflicts in note frontmatter or external marker files are outside the plugin's repair scope; `Report external folder drift` surfaces the resulting state.
- Fixed `.exnf` markers are deprecated legacy evidence during the 2.0.0 migration window. New writes create empty `<uuid>.exnf` files; run `Migrate legacy marker files` to rename old markers.
- New UUID-named markers are empty because their canonical filename carries the folder identity. Existing UUID-named marker contents are opaque and ignored. Legacy fixed `.exnf` markers still carry their UUID in their content during the migration window.

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
- `npm run test:integration` (requires Obsidian 1.12.7+ with the CLI enabled and able to reload the
  sandbox vault)
- `npm run test:watch`
- `npm run release:update-versions`
- `npm run release:check-versions`
- `npm run release:check-assets`
- `npm run fixtures:new-sandbox`

### Standalone read-only adoption audit

From this repository in PowerShell, run:

```powershell
npx --no-install jiti scripts/audit-adoption.ts `
  --vault 'C:\Users\ryanh\ship\cabin' `
  --external-root 'C:\Users\ryanh\ship\hangar' `
  --output '.\tmp'
```

These are also the default source roots; the default output parent is this
repository's ignored `tmp` directory. Each run writes a fresh timestamped directory
and prints its absolute path. The command uses the locally installed `jiti` and
`yaml` packages from the current dependency tree; it does not install packages or
require a running Obsidian instance. Use `--help` for options.

The audit reads actual files recursively, without using Obsidian's cache or plugin
ignore settings. Under `cabin`, it reads markdown files and parses top-level YAML
`exnf` properties. Under `hangar`, it inventories directories and marker files.
Hidden folders, repositories, dependencies, and fixtures are included. The external
root itself is scan context, not a row in the descendant-folder inventory; markers
directly in that root are still inspected. Links and junctions are not followed.
The source files, folders, and markers are never changed.

| Report | Contents |
| --- | --- |
| `markdown-files.csv` | Absolute paths of all discovered markdown files. |
| `markdown-with-exnf.csv` | Parsed top-level `exnf` properties, values, UUIDs, and validation status, including empty or invalid values. |
| `external-folders.csv` | Absolute paths of discovered external directories. |
| `exnf-files.csv` | Marker and folder paths, UUIDs, formats, and validation status. |
| `correctly-adopted.csv` | Unambiguous note–folder UUID matches, expected/actual paths, and path drift. |
| `possibly-missing.csv` | Missing counterparts, adoption candidates/blocks, unassigned items, conflicts, migration needs, and unchecked evidence. |
| `unmarked-leaf-folders.csv` | Absolute and root-relative leaf-folder paths with no `.exnf` marker in the leaf or any ancestor through the external root. |
| `folder-status.csv` | Physical and virtual paths, exact/YAML/marker evidence, binding status, confidence, associated notes, and explanations. |
| `summary.md` | Source roots, coverage, counts, and report links. |
| `report.html` | Offline searchable folder-status tree, with optional expected paths and CSV downloads. |

The CSV files use UTF-8 with a BOM and quoted fields for Windows spreadsheet import.
Canonical marker contents are ignored; legacy `.exnf` contents follow the plugin's
strict parsing rules. Matching UUIDs establish current binding state, not historical
proof of adoption. A matching UUID at a different path is retained with a drift flag.
Candidate selection reuses the plugin's path and deepest exact-match adoption rules.
Unassigned notes and unmarked folders are review items, not automatic errors.

For `unmarked-leaf-folders.csv`, a leaf is a descendant directory with no subfolders;
it may contain ordinary files. Every `.exnf` or `*.exnf` file counts as a marker,
including malformed files and uppercase extensions. A marker in a sibling branch
does not disqualify the leaf. A marker directly in the external root disqualifies
all descendants. Unreadable directories and leaves with uninspected children are
excluded, as are paths with skipped marker links. Unrelated scan gaps, including
vault YAML problems, do not disqualify locally checked branches; the list may still
omit leaves in unscanned areas.

Unreadable paths, skipped links, and unparseable YAML are reported as unchecked.
When identity coverage is incomplete, otherwise matching pairs are listed as
provisional bindings instead of confirmed adoptions, and absence claims are
provisional. Invalid YAML cannot reliably establish whether an `exnf` property is
present; those files remain in the markdown inventory and unchecked findings.
This is a live scan, not an atomic filesystem snapshot; rerun if files change during
the scan. Exit codes are `0` for a complete scan (which may have findings), `2` for
incomplete coverage with reports, and `1` for a command/output failure.

### External folder status

Open `report.html` offline or run **External folder status** in Obsidian. Keep
HTML and sibling CSV files together. Both hosts use the same status analysis.
Obsidian additionally offers explicit adoption and repair actions.

The default tree shows all scanned folders, including generated/internal paths,
ordered naturally by name. **Most leaves** sorts by checked physical leaf totals.
Category filters and the unmarked-leaves view change display only. Selection,
expansion, keyboard navigation, and virtualized rendering are retained. Search
matches folder paths and exact/UUID-associated notes. Same-name candidates appear
separately in details and are never treated as proof of a binding.

Click a different row to select it and inspect its details without expanding or
collapsing it. Click an already selected branch to toggle its expansion. Keyboard
Left/Right controls still collapse/expand directly; Enter/Space selects the row.

Every row shows `exact` (plugin-derived note path), `yaml` (valid associated note
identity), and `marker` (contains .exnf marker) columns. Cells show their column
name for found evidence, stay blank for absent evidence, and show `?` for
unchecked or `⚠` for invalid evidence.
The legend and cell tooltips explain each state. The details panel shows associated
notes and actual evidence without repeating the column definitions. The separate status distinguishes matching bindings,
path drift, adoption candidates, orphan markers, conflicts, and uncertainty.
Three populated columns do not prove that UUIDs match. Ancestor markers are shown
separately; a child does not itself contain its ancestor's marker. Missing YAML
is labeled **YAML exnf not found**, or **No associated note** when no note exists.

Local markers make folder names prominent. The subtle `↑` indicator means a
marker exists higher in the path; it does not activate the child's local marker
tag. Details name the nearest marked ancestor, its distance, marker certainty,
and associated note. **Select marked ancestor** temporarily reveals and focuses
that ancestor without changing filters or counts. **Back to selected folder**
restores the prior selection, expansion, and scroll position. Sorting and a
cancelled/failed refresh preserve this inspection; selecting another folder,
changing filters, or a completed refresh ends it. Root markers are inspected
through **Inspect external root**, without adding a folder row or adoption target.

Parents above confirmed bindings are labeled **Contains bound subfolders**.
When descendant markers exist without a confirmed binding, the label is
**Contains descendant markers**. These replace misleading unassigned/adoption
candidate labels without overriding local conflicts or unchecked evidence.
An identified parent without a local marker retains **Marker absent here** and
its orange review indicator, including membership in that status filter.
Tooltips, selected-folder details, and CSV explanations include descendant
counts and explain why adopting the entire parent would create a nested binding.
The parent can remain an ordinary container; its local `marker` tag stays absent.
The adoption restrictions list names the affected paths and offers navigation.

Search and Refresh stay visible. **View** contains sorting and display filters;
**Export** contains downloads. Escape closes either disclosure and returns focus.
Active filters are summarized beside **Clear filters**. Display choices last only
for the current tab; reopening starts with all folders and natural name sorting.
**Scan details** lists exclusions, skipped links, and read failures in pages.

**Needs review** narrows the current filters to orange/red rows. **Previous issue**
and **Next issue** visit those matches in tree order using the current sibling
sort, including collapsed branches and rows beyond the rendered page. Navigation
does not wrap or change filters; unavailable directions are disabled. Context-only
ancestors and temporary reveals are not issues. The position indicator counts
issues in the current filters, whether Needs review is on or off.

Exact-path evidence uses discovered vault paths independently of external scan
gaps. An unreadable note still has a usable path, but its YAML identity is
unchecked. An unreadable marker does not make inspected child directories
unreadable or remove their known leaf counts. Identity uniqueness remains
provisional when scan gaps could conceal duplicate UUIDs.

The details panel leads with the relationship and available actions. Adoption
stays visible but disabled for known restrictions, naming local, ancestor, or
descendant markers and excluded, linked, or unreadable paths. Pending operations
offer recovery; stale results offer Refresh. **Choose a note to check adoption**
means no blocker is established by the snapshot; the adoption preview and fresh
execution checks remain authoritative. Associated notes, same-name suggestions,
other marked ancestors, and technical/scan details start expanded; each section
can be collapsed. Same-name suggestions remain separate from confirmed associations.
Scan details and the View/Export controls outside the selected-folder panel
continue to start closed.

A compact sticky header keeps the selected folder, status, and navigation visible.
Binding relationships and actions precede note suggestions and technical records.
Actual/expected paths have labeled copy controls. Sorting, filtering, and refresh
preserve the same folder's section expansion, scroll position, and keyboard focus;
selecting another folder starts at the top with sections expanded.

Drag the separator between the tree and details to resize them. With the separator
focused, Left/Right adjust the width and Home/End select the limits. Each pane stays
at least 320px wide; **Reset pane width** restores the initial 60/40 split. At report
widths of 800px or less the panes stack and the divider is hidden. The split is
remembered only for the current tab/page session and returns when widened.

Compact 28px rows align folder names, physical leaf quantities, descriptors, and
evidence in separate columns. Indentation affects only the name column. Leaf
quantities show matching/known totals when filters hide leaves. Column headings
stay visible while scrolling; narrow panes scroll horizontally to retain the
columns. Details text can be selected and copied normally, alongside the existing
Copy path buttons.

Solid full-row colors communicate attention level. Light mode uses `#1A1A1A` text on
pale backgrounds; dark mode uses white text on deep backgrounds. Normal and
hover backgrounds use the verified equal-lightness palette, with separate
foreground colors for legend and details indicators. The selected row has
a solid inset outline, and keyboard focus has a dashed outline. Evidence has
three aligned columns headed `exact`, `yaml`, and `marker`; absent cells are
blank to reduce noise. Hover explanations and screen-reader labels preserve
the meaning of every cell, including absent, unchecked, and invalid states.
The matching legend and text labels retain meaning without relying on color alone. Blue
identifies physical branches and leaves with no known adoption blocker, even
without note matches. It means **Choose a note to check adoption**, not approval;
the preview still checks the selected note and operation. Scanning temporarily
disables actions without recoloring the previous completed result.

| Color | Meaning | Examples |
| --- | --- | --- |
| Gray | Informational | Blocked containers, content subfolders, intentionally excluded paths and skipped links |
| Green | Healthy binding | Confirmed binding at the expected path |
| Blue | Optional action | Branches or leaves with no known adoption blocker, including unassigned folders |
| Orange | Review recommended | Drift, unreadable local evidence, unmatched markers, provisional bindings, changes awaiting refresh |
| Red | Conflict / recovery | Invalid identities, duplicate UUIDs, conflicting bindings, pending operations |

| Attention | Light row / hover | Dark row / hover | Light / dark indicator |
| --- | --- | --- | --- |
| Informational | `#FFFFFF` / `#F7F7F7` | `#1A1A1A` / `#232323` | `#58677B` / `#A2ADBB` |
| Healthy green | `#D0F3D0` / `#C6ECC6` | `#273F28` / `#2F4A30` | `#278733` / `#80CD82` |
| Optional blue | `#D7EAFF` / `#C8E3FF` | `#233A51` / `#2B445F` | `#0F74C5` / `#7CBDFF` |
| Review orange | `#FFE2CB` / `#FFD7B7` | `#4B321C` / `#583B23` | `#A75C00` / `#F4A25C` |
| Conflict red | `#FFDFDC` / `#FFD4CF` | `#4F2D2B` / `#5C3633` | `#B94642` / `#FF958D` |

Obsidian's selected theme takes precedence over the operating system preference.
Offline HTML follows the operating system theme. Indicator colors use the
palette's foreground marks, avoiding its light-mode accent bars that fall below
3:1 against highlighted rows. Row colors are opaque, with no transparency blending.

**Contains bound subfolders** remains informational: being unable to adopt the
parent is an expected restriction. Descendant problems retain their own row
indicators and appear in the parent's detailed restrictions. Partial-root virtual
paths do not become warnings solely because the expected folder is absent.
Missing-marker and conflict states take precedence over adoption availability.
If session operations overlap, pending recovery takes precedence over completed
changes. Refresh retains pending recovery indications until the operation is
reported completed through the existing recovery flow.

**Include expected paths from identified notes** adds virtual expected paths.
These are informational: they cannot be adopted or opened as existing folders.
A partial external root can intentionally omit them. A UUID found elsewhere is
reported as drift, while excluded or unreadable locations remain unchecked.

Settings under **External folder status — this command only** are independent
of normal external-root ignore settings. **Ignored folder patterns** defaults to
`.git/`, `node_modules/`, `build/`, `dist/`, `.cache/`, `__pycache__/`, and `.venv/`.
**Skip scanning ignored folders** is off by default. Enabling it skips matching
external branches on the next refresh; vault notes are still fully scanned.
Turn it off to search for unexpectedly misplaced markers in those branches.
Excluded branches remain labeled placeholders. Incomplete coverage makes
uniqueness and absence provisional. Standalone audits continue to scan fully.

**Export filtered status** and **Export all status** write `filtered-folder-status.csv`
and `folder-status.csv`, including evidence, confidence, note paths, and explanations.
Filtered exports include matching folders in collapsed branches, but exclude
contextual tree ancestors and temporary navigation reveals. Displayed-folder
counts likewise count actual filter matches. All-status exports include virtual
expected paths. Existing audit CSVs and unmarked-leaf exports retain their meanings.
Status fields describe the captured scan. If session mutations affect filtering,
status exports append that context to the existing explanation field; they do not
replace captured evidence with an assumed post-mutation state.

For a unique drifted binding, selected-folder details offer **Move external folder
to match note** or **Move note to match external folder**. Both require a preview
and explicit confirmation, fresh full scans, safe destinations, and mutation-lock
checks. Folder moves include their subtree. Note moves relocate only the selected
markdown file to `<external-relative-folder-path>.md`, preserve its UUID, and use
Obsidian link updates and alias preservation. Legacy markers must be migrated
before a note move. Neither direction overwrites occupied destinations.
Interrupted note moves use the existing adoption recovery journal; uncertain
renames require inspection rather than automatic retry. External move failures
show the reconcile journal for inspection. No absent-folder creation or automatic
conflict repair is offered.

In Obsidian, **Adopt this folder…** in the selected folder details binds that directory and its
entire subtree to one note, including content hidden by filters. It opens a
dialog; nothing changes until **Confirm adoption**. Suggestions include exact
derived paths, matching filenames, and aliases. Search the vault for other
notes in the autocomplete field and choose a suggestion, or enter an exact vault-relative
note path (the `.md` extension is optional). Empty input selects **Create new note**;
a valid existing note enables **Bind without moving** and **Move note to match folder**.
Unresolved input disables adoption until corrected or cleared. The three action buttons
stay visible, with only the selected mode highlighted. **Clear** returns to creation.

The wider dialog checks the preview automatically after input settles. Review the
note, folder, changes, and warnings, then use **Confirm adoption** in the permanent
footer. Confirmation stays disabled while checking, for invalid input, or until
required descendant-note acknowledgment is checked. Technical identity details can
be expanded. **Retry checks** repeats failed validation without adopting anything;
an interrupted write instead offers the existing recovery flow. **Open note** inspects
the resolved note without adopting it; the return notification restores the choices
and triggers fresh checks.

New notes default to the matching path (`Projects/Example.md`) and contain only
`exnf` frontmatter. Existing notes default to **Bind without moving**. The preview
shows the future reconcile destination and known occupancy blockers. Alternatively,
**Move note to match this folder** explicitly relocates or renames the note,
preserving its old basename as an alias. Obsidian may ask whether to update links.
External folders never move during adoption. Future reconciliation remains
note-driven. Hidden vault paths and paths that cannot round-trip through the
plugin's path rules cannot be new-note or move destinations.

Adoption respects ignore settings and checks the entire selected subtree for
markers and unsafe evidence, including physically present ignored descendants.
Existing bindings prevent nested adoption. Matching unassigned child notes require
acknowledgment; they remain unchanged but cannot have separate nested bindings.
An existing UUID is reused only after fresh uniqueness checks. Alias problems,
identity conflicts, destination collisions, and changed previews fail closed.

Writes are serialized and journaled: marker first, note identity and aliases next,
then an optional note move. Journals under the plugin's `journal/group-adoption`
directory include note content for recovery checks; they are not audit exports.
Failures preserve completed effects and provide a journal path. **Resume folder
adoption…** remains available after closing the report or restarting Obsidian.
Resume checks saved note content before writing markers or note properties. Edited
source notes block further writes. Newly discovered descendant notes are listed
in the recovery dialog and require acknowledgment before resuming; further
additions require acknowledgment again.
An interrupted rename is never blindly repeated. Once the note is at the intended
destination and links have been checked manually, **I checked links — verify
completion** validates the binding and finishes the journal without another move.
No rollback deletes notes, directories, or markers.

After adoption, stay in the report and use **Open note** if desired. Affected
folders are marked adopted or pending recovery. Counts and exports remain a
historical snapshot, with a stale warning until **Refresh**. Standalone HTML has
no adoption controls. Single-folder writes avoid creating unwanted notes, but
safety checks can still require full-root scans.

The tab labels its scope **Full physical audit — ignore patterns not applied**.
This audit explicitly permits raw, read-only filesystem reads of the active vault;
it does not use cached frontmatter. Vault adapters without an absolute filesystem
root are unsupported. Existing commands keep their vault adapters, ignore rules,
and mutation safeguards. The report runs outside the mutation lock and displays
**Results may not reflect in-progress mutations** if mutation activity overlaps
the scan. Snapshots and review decisions are not persisted.

In Obsidian, export asks for an existing writable absolute destination directory.
The destination is remembered only for that tab session. Each export creates a
fresh timestamped child directory and displays its location. Full audit tables are
computed only when selected for export, from the same captured snapshot. Exported
summaries retain scan coverage, unchecked-item counts, and any mutation-overlap
warning, including filtered and all-leaf exports. Cancelled
or failed exports can leave a partial output directory; existing reports are never
overwritten. Closing the tab cancels report work; an already-started adoption is
owned by the plugin and retains its journal independently of the tab.

The shared implementation separates pure audit models, classification, leaf
analysis, and CSV serialization in `src/core/` from the physical scanner and writer
in `src/storage/`. Browser-safe query logic imports no Node or Obsidian modules.
The standard DOM interface in `src/ui/` has mount/update/dispose lifecycle methods;
the standalone HTML builder and Obsidian tab provide host actions. Scheduled
generators share computation with synchronous wrappers and allow cancellation
between batches. Full scans remain live observations, not atomic snapshots.

Run `npx --no-install jiti scripts/audit-performance.ts` for a disposable physical
fixture with 20,000 leaves and notes. It records scan event-loop delay, analysis and
CSV slice durations, and export time in `tmp/audit-performance.json`. The sandbox
integration suite also measures shared-interface rendering and filtering with
20,000 leaves. Performance varies with hardware, path depth, and file sizes;
one filesystem response or individual YAML document cannot be interrupted midway.

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
`main` using conventional commit messages, conventional PR and merge titles, and
matching `.release-intent/*.md` files for patch, minor, or breaking changes.
Release Please opens or updates a separate release PR with the package and
manifest version bump plus changelog.

Release PRs must also keep `versions.json` current. CI runs
`npm run release:check-versions`; the `release-versions` workflow updates and
commits `versions.json` automatically on Release Please PR branches.

Release intent files are review and recovery evidence for release-relevant
normal PRs. If Release Please does not propose a release after a release-relevant
merge, inspect the Release Please workflow logs and use `.release-intent/`
entries as the source for recovery instead of accepting a silent skip.

Review and merge the release PR only when you intend to publish a release. After
that merge, Release Please creates the GitHub release and tag. The release asset
workflow then builds the plugin with Node 24, validates the tag and manifest
version, and uploads `main.js`, `styles.css`, and `manifest.json` to the
release. The same workflow can be run manually for an existing tag if release
asset publishing needs to be retried.

For real-vault testing before a stable release, run the `publish-beta` workflow
from `main`. Supply the exact branch, tag, or commit to build and a new semantic
prerelease version such as `2.0.1-beta.2`. The workflow tests, lints, and builds
that ref, creates a prerelease whose tag points to the resolved commit, and
uploads BRAT-compatible assets. It changes the copied release manifest only;
tracked version files remain owned by Release Please. Prerelease tags are
immutable inputs to this workflow and are never overwritten.

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
- Agent autonomy policy: `docs/dev/agent/autonomy-policy.md`
- TDD workflow: `docs/dev/procedures/tdd-workflow.md`
- MVP implementation workflow: `docs/dev/procedures/mvp-implementation-workflow.md`
- Review gate policy: `docs/dev/procedures/commit-pull-request-merge-review-gate.md`
- MVP validation: `docs/dev/procedures/mvp-validation.md`
- ADR index: `docs/dev/adr/README.md`

## Installation

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

### Beta versions

To install a beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/hollowhemlock/obsidian-external-note-folders).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

BRAT installs the plugin files attached to the GitHub prerelease. Pin a specific
beta version when validating behavior that must remain reproducible.

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
- Run `npm run fixtures:new-sandbox` to create
  `sandbox/vault-plugin-external-note-folders-sandbox` and `sandbox/external-root`
  from committed fixture data, open the sandbox vault if needed, then reload Obsidian with that
  vault as the CLI target.
- Sandbox reset and Obsidian CLI integration commands must run from the primary Git checkout.
  Linked worktrees fail before building, mutating sandbox files, or controlling Obsidian.
- The reset is always a full replacement, including
  `sandbox/vault-plugin-external-note-folders-sandbox/.obsidian`. If Windows still holds a lock after
  retries, close Obsidian and rerun the command.
- `npm run test:integration` builds the plugin, fully resets the sandbox, installs the plugin
  artifacts, reloads Obsidian, and runs the integration tests. The GitHub integration workflow is
  manual-only and requires an online self-hosted runner labeled `obsidian-cli`.
- Formal semantic fixture scenarios live under
  `test/fixtures/fixture/{vault-plugin-external-note-folders-fixture,external-root}/<domain>/<scenario-slug>`
  with expected JSON under
  `test/fixtures/fixture/expected/<domain>/<scenario-slug>.json`. Workflow fixtures that
  intentionally assert user-visible command paths may use
  `test/fixtures/fixture/{vault-plugin-external-note-folders-fixture,external-root}/tests/<domain>/...`.
- Integration tests are split by workflow under `test/integration/<domain>.integration.test.ts`.
- Run `npm run vault:open -- fixture`, `npm run vault:open -- sandbox`, or
  `npm run vault:open -- <vault-path>` to open a vault directly in Obsidian.
- `scripts/dev.ts` targets
  `test/fixtures/sandbox/vault-plugin-external-note-folders-sandbox/.obsidian` as the default dev vault.
- Sandbox reset, development, installation, opening, and CLI integration commands run only from
  the primary Git checkout. Worktrees remain suitable for editing and headless validation.

Environment support for additional Obsidian config folders is available in `scripts/dev.ts`:

- `OBSIDIAN_CONFIG_FOLDER` for one extra `.obsidian` path
- `OBSIDIAN_CONFIG_FOLDERS` for a comma-separated list of extra `.obsidian` paths

Example values are in `.env.example`.

## License

© [Ryan](https://github.com/hollowhemlock/)
