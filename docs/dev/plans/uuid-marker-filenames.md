# UUID Marker Filename Design Notes

Date: 2026-05-15
Status: Working notes (pre-ADR)
Scope: Marker filename scheme, concurrent UUID assignment, and related drift
model implications.

> This document is historical working design material. The accepted follow-up is
> [ADR-0027](../adr/0027-uuid-named-marker-files.md). Current implementation
> still reads and writes fixed `.exnf` marker files until ADR-0027 is
> implemented.
>
> ADR-0027 treats the marker filename change as a breaking marker-contract
> change targeting a future `2.0.0` release. Fixed `.exnf` markers are
> deprecated in favor of `<uuid>.exnf`; this document does not bump package or
> manifest versions.

## Related Decisions

- [ADR-0005](../adr/0005-bound-folder-marker.md) defines the current
  fixed `.exnf` marker-file discovery model.
- [ADR-0014](../adr/0014-exnf-marker-format-and-validation.md) defines the
  current `.exnf` marker-file format and validation rules.
- [ADR-0013](../adr/0013-filesystem-boundary-and-path-identity.md) defines
  path identity and filesystem boundary handling.
- [ADR-0027](../adr/0027-uuid-named-marker-files.md) accepts the UUID-named
  marker filename contract for the future 2.0.0 implementation.
- [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) defines
  active-note recovery scan behavior.
- [ADR-0026](../adr/0026-safe-partial-exact-adoption-with-ignore-patterns.md)
  defines partial exact adoption and external-root ignore behavior.

## Context

### Plugin Goal

External Note Folders provides a cross-platform binding between Obsidian vault
notes and external folders that survives renames and reorganizations on either
side. Identity is currently anchored to a UUID stored in both the note's `exnf`
frontmatter and a `.exnf` marker file in the bound external folder.

### Why Path-Based Linking Does Not Suffice

Plain file paths such as `file:///...`, raw paths, or `\\wsl.localhost\...` are
OS-specific. A vault synced across Windows, macOS, Linux, and mobile cannot rely
on a single absolute path. A relative path from a configurable external root
helps cross-platform use, but still breaks when either the vault note or the
external folder is renamed.

UUID-based binding decouples identity from name and location, at the cost of
additional plugin machinery: marker files, drift detection, reconciliation, and
adoption.

### Target User Profile

The UUID design is justified for users who:

- Reorganize folders frequently and experience rename fatigue.
- Sync the vault across multiple operating systems.
- Want links to resolve correctly even after a folder moves.

For users without this profile, simpler schemes such as relative paths plus
manual updates have lower operational cost.

### Primary User Workflow

The primary workflow is hotkey-driven `Open external folder` against the active
note. The user's core questions are:

1. Is the bound folder where it is expected?
2. If not, is it anywhere else under the configured external root?

This maps to the current fast-path-then-recovery-scan behavior in ADR-0025.

## Problem: Concurrent UUID Assignment

### Scenario

1. `Projects/Alpha.md` exists in the vault with no `exnf` frontmatter.
2. Device A goes offline. The user runs `Assign external folder identifier`.
   UUID `aaa-111` is written to frontmatter and to the marker file at
   `external/Projects/Alpha/`.
3. Device B was offline at the same pre-assignment vault state. The user runs
   assign on B. UUID `bbb-222` is written to frontmatter and marker.
4. Both devices come online and sync.

The UUID examples above are abbreviated for readability. Actual marker content
continues to require canonical lowercase UUIDs under the current contract.

### Resulting Conflicts

| Layer | Behavior |
| --- | --- |
| Vault frontmatter | Standard sync conflict on the note. Resolution depends on the sync tool: winner-takes-all or conflict copy. |
| External root, synced | Two different marker writes target the same `.exnf` path. The sync tool picks one or creates conflict-renamed siblings such as `.exnf.conflict-20260515`, `.exnf 2`, or similar. |
| External root, not synced | Each device has its own marker. Neither device knows about the other. One device's frontmatter no longer matches its local marker. |

### Severity

This is a visible, recoverable inconsistency rather than silent corruption. The
existing drift report and active-note recovery scan can surface the state for
manual user resolution.

However, under the current fixed `.exnf` filename scheme, the failure mode can
be destructive at the marker-discovery layer. A sync-conflict rename can move
the useful marker content into a filename that the plugin does not consider
canonical.

## Proposal Captured by ADR-0027: `<uuid>.exnf` Marker Filenames

Rename the marker file from a fixed `.exnf` to `<uuid>.exnf`, for example
`550e8400-e29b-41d4-a716-446655440000.exnf`, where the UUID in the filename
matches the UUID written inside the file and in the note's `exnf` frontmatter.

Current implementation still reads and writes fixed `.exnf` marker files.
ADR-0027 accepts `<uuid>.exnf` as the future marker contract. Fixed `.exnf`
markers are treated as deprecated legacy markers during migration, not as the
long-term marker contract.

### Properties

| Property | Current `.exnf` | Proposed `<uuid>.exnf` |
| --- | --- | --- |
| Discovery | `stat .exnf` | glob `*.exnf` |
| Filename collision under concurrent assign | Yes | No |
| Sync-conflict survivability | Sync tool may rename the marker away from the canonical filename | Distinct marker filenames can coexist |
| Multiple markers in one folder | Special-case integrity error | Normal drift evidence: one current marker, other stale or misplaced markers |
| Visibility in file managers | Hidden on Unix-like systems | Visible |
| Format migration | Not applicable | Required once, with a deprecation window |

### Resolution Rule

The note's frontmatter UUID remains authoritative. For a folder containing one
or more `*.exnf` files:

- The `<frontmatter-uuid>.exnf` file, if present, is the current binding for
  that note.
- Any other `*.exnf` files in the folder are stale, orphaned, or misplaced
  markers.
- Stale or orphaned markers should surface in drift reports as cleanup
  candidates, not as global integrity errors.

## Rationale

### Why This Beats Documentation-Only Mitigation

Documenting that users should avoid running assignment on devices with unsynced
vaults is weaker than handling the case. Distributed systems handle conflicts;
they do not rely only on rules telling users to avoid them. The plugin's value
proposition is that UUID identity survives moves, so the design should also
handle UUIDs generated in parallel.

### Why This Beats Conflict-Sibling Detection

A middle ground would keep `.exnf` canonical and teach the plugin to recognize
sync-conflict siblings such as `.exnf.conflict-*`, `.exnf~`, or `.exnf 2`. This
is fragile:

- Conflict naming varies by sync tool and version.
- Recognition becomes pattern matching against an open set of strings.
- The filename collision still happens; the plugin only recovers afterward.

Using `<uuid>.exnf` avoids the conflict at the file level.

### Accepted Costs If Adopted

- Discovery changes from a direct `.exnf` stat to an `*.exnf` scan in each
  candidate folder.
- Marker files become visible in file managers.
- Existing users need a one-time migration from `.exnf` to `<uuid>.exnf`.

## Implications

### Drift Model Simplification

The "multiple markers in one folder" state changes from a special
concurrent-assignment edge case into a normal drift category. A drift report can
categorize each `*.exnf` marker as:

- Current: UUID matches a vault note's frontmatter and the folder's expected
  path.
- Stale or orphaned: UUID matches no vault note, or matches a note bound
  elsewhere.
- Misplaced: UUID matches a vault note, but the folder is not the note's
  derived path.

### Frontmatter Conflict Handling Remains Separate

The marker filename change does not solve vault-side conflicts on the note's
frontmatter. For example, Obsidian Sync may produce
`Alpha.conflict-2026-05-15.md` with a different `exnf` value.

That remains the sync tool's responsibility, but the plugin should treat it as
a first-class drift category with clear remediation:

- Detect when a note's `exnf` UUID resolves to no marker, but a marker exists in
  the expected folder with a different UUID.
- Offer explicit rebind options such as adopting the folder's UUID into the
  note, or moving the folder under the note's UUID.
- Never auto-resolve frontmatter conflicts.

### Migration

A future migration should be drift-style and explicit:

1. Scan the external root for old-format `.exnf` files.
2. Read each file's contained UUID.
3. Plan a rename from `<folder>/.exnf` to `<folder>/<uuid>.exnf`.
4. Show a dry-run plan.
5. Require explicit confirmation.
6. Execute with journaling consistent with existing reconcile/adoption patterns.

During a backward-compatibility window, the plugin could read both formats while
refusing to write old-format markers. The intended deprecation direction is:

- Read old fixed `.exnf` markers only for migration and compatibility.
- Write only new `<uuid>.exnf` markers after the marker-contract change lands.
- Provide an explicit migration command before removing old-marker read support.
- Release the marker-contract change as `2.0.0` because existing marker files
  and any user automation around them are affected.

## Considered and Rejected

### Documentation-Only Mitigation

Rejected because it puts the burden on users to avoid a realistic distributed
sync conflict. Recoverable errors with explicit remediation build more trust
than rules that require users not to trigger the conflict.

### Marker Filename Includes UUID as Suffix: `.exnf-<uuid>`

Functionally similar and keeps the leading dot for invisibility. Rejected in
this working design in favor of `<uuid>.exnf` for cleaner glob semantics and
conventional extension placement.

### Central Registry at External Root

Rejected because a per-folder marker is what lets binding survive folder moves
outside Obsidian's awareness. A central registry reintroduces path stability as
a core dependency.

## Open Items

### Scan Performance at Scale

The README currently notes that ignore rules, scan caps, progress UI,
cancellation, and cached indexes are out of scope until performance requires
them. Active-note recovery scan is the first command likely to hit this cliff
when the external root contains many folders.

### Sync-Supported Configurations

Cross-platform use is a stated goal, so a documented supported-sync setup would
close a product gap without code. This should cover common combinations such as
Obsidian Sync, Syncthing, iCloud, and separately synced external roots.

### Marker Files in Non-Owned Folders

`<uuid>.exnf` files appearing inside cloned git repos, work projects, or other
shared folders may create friction. Options to consider:

- Document a recommended global gitignore entry.
- Provide an opt-out list of paths where markers should not be written, with a
  corresponding loss of binding for those paths.
- Accept the marker visibility as part of the feature's operating model.

## Future ADR Candidates

These decisions should be lifted into ADRs before implementation:

- Marker filename change from `.exnf` to `<uuid>.exnf`.
- Migration and deprecation behavior for old `.exnf` markers.
- Drift categories for multiple markers in one folder.
- Vault-side frontmatter conflict remediation.
- Supported sync configurations and documented sync assumptions.
- Release/versioning policy for the breaking marker-contract change, including
  the `2.0.0` target.

## Concrete Changes If Adopted Later

| Change | Effort | Risk | Priority |
| --- | --- | --- | --- |
| Marker filename changes to `<uuid>.exnf` | Medium | Low with a clean migration path | High |
| Migration command from `.exnf` to `<uuid>.exnf` | Small | Low | High |
| Drift category for vault-side frontmatter conflicts | Medium | Low | Medium |
| Documented sync configurations | Low | None | Medium |
| Scan caps or cached index | Larger | Medium | Defer until needed |
| Marker-file gitignore guidance | Low | None | Low |
