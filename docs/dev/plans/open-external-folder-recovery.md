# Open External Folder Recovery Spec

## Summary

`Open external folder` has a fast path and a recovery path. The fast path opens
the expected folder when it is already correctly bound. The recovery path runs
only when expected-folder inspection fails to find a matching `.exnf`; it scans
for active-note-relevant recovery data and presents a persistent modal.

This spec is canonical for the recovery modal UX. README tables summarize this
behavior but should not add extra modal behavior.

## Command Flow

1. Require an active Markdown note.
2. Require valid `exnf` frontmatter on the active note. Missing or invalid
   identity stops before external-root inspection.
3. Resolve and validate the configured external root.
4. Inspect the active note's expected external folder.
5. If the expected folder has matching `.exnf`, open immediately. Do not scan
   for duplicate markers elsewhere.
6. If expected-folder inspection is anything else, run the active-note recovery
   scan.
7. If recovery scan finds exactly one off-path active-UUID marker, open that
   folder and show the recovery modal.
8. If recovery scan finds multiple active-UUID markers, do not auto-open. Show
   the recovery modal with duplicate rows.
9. If recovery scan finds no active-UUID marker, show the recovery modal with
   exact-name candidates and safe actions.

## Recovery Scan Contract

The recovery scan traverses the configured external root for this invocation and
collects only active-note-relevant data:

- all folders whose `.exnf` marker equals the active note UUID
- exact-name candidate folders whose normalized basename equals the expected
  folder basename
- candidate marker status: unmarked, bound to active UUID, bound to another
  UUID, malformed, or inaccessible/skipped
- owner vault note path when a bound candidate UUID exists in vault metadata
- skipped descendant directory warnings
- non-candidate malformed marker warnings as summarized diagnostics

Candidate matching uses exact normalized basename equality:

- derive the expected folder basename through the existing path derivation rule
- normalize Unicode to NFC
- compare according to ADR-0013 path identity, using the configured external
  root's filesystem case-sensitivity probe and falling back to case-insensitive
  only when the probe is inconclusive
- do not use fuzzy, suffix, tree-tail, or similarity matching

The scan does not build full Drift Report or Reconcile plans. It does not report
unrelated orphan folders except where a folder is an exact-name candidate or an
active-note UUID match.

## Recovery Modal

The modal must be persistent and copyable. It should include:

- active vault file
- active note UUID
- expected external folder
- expected folder status
- active UUID marker matches
- exact-name candidate folders
- skipped-directory and malformed-marker warnings relevant to scan confidence
- available safe actions

Actions:

- Open a selected folder that is already bound to the active UUID.
- Create expected folder and write `.exnf`, only when the expected path is
  missing.
- Write `.exnf` to the expected folder, only when it exists and is unmarked.
- Write `.exnf` to a selected exact-name candidate, only when that candidate is
  unmarked.
- Cancel.

Display-only rows:

- candidate bound to another UUID
- candidate with malformed marker
- candidate under skipped/inaccessible subtree
- duplicate active-UUID rows when more than one marker exists

All mutating modal actions must revalidate the target before writing and must
never overwrite an existing marker.

## Failure Modes

| Situation | Open behavior | Recovery modal behavior | References |
| --- | --- | --- | --- |
| No active Markdown note | Stop before external-root access. | None. | [ADR-0023](../adr/0023-open-external-folder-does-not-assign-identity.md) |
| Active note has no `exnf` | Stop and direct user to explicit assignment/adoption. | None. | [ADR-0001](../adr/0001-vault-is-source-of-truth.md), [ADR-0023](../adr/0023-open-external-folder-does-not-assign-identity.md) |
| Active note has invalid `exnf` | Stop before touching external root. | None. | [ADR-0009](../adr/0009-status-model.md), [ADR-0014](../adr/0014-exnf-marker-format-and-validation.md) |
| External root unset, relative, missing, or unreadable | Stop fail-closed. | None. | [ADR-0009](../adr/0009-status-model.md), [ADR-0013](../adr/0013-filesystem-boundary-and-path-identity.md) |
| Expected folder has matching `.exnf` | Open immediately; do not scan elsewhere. | None. | [ADR-0005](../adr/0005-bound-folder-marker.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Expected folder missing | Run recovery scan. | Show active UUID matches, exact-name candidates, and create-expected action. | [ADR-0002](../adr/0002-missing-external-is-normal.md), [ADR-0015](../adr/0015-external-folder-path-derivation.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Expected folder exists without `.exnf` | Run recovery scan. | Show expected-folder adoption action plus recovery rows. | [ADR-0005](../adr/0005-bound-folder-marker.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Expected folder has malformed `.exnf` | Run recovery scan; do not open expected folder. | Show malformed expected marker as blocking expected-path status. | [ADR-0009](../adr/0009-status-model.md), [ADR-0014](../adr/0014-exnf-marker-format-and-validation.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Expected folder has `.exnf` for another UUID | Run recovery scan; do not open expected folder. | Show mismatched expected marker as blocking expected-path status. | [ADR-0009](../adr/0009-status-model.md), [ADR-0014](../adr/0014-exnf-marker-format-and-validation.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| One off-path folder has active note UUID | Open that folder by default. | Show persistent drift details and available cleanup actions. | [ADR-0005](../adr/0005-bound-folder-marker.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Multiple folders have active note UUID | Do not auto-open. | Show duplicate active-UUID rows and require manual decision/cleanup. | [ADR-0009](../adr/0009-status-model.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Exact-name candidate is unmarked | Do not mutate automatically. | Candidate can be selected for `.exnf` adoption after confirmation. | [ADR-0005](../adr/0005-bound-folder-marker.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Exact-name candidate is bound to active UUID | Openable/selectable. | Show as active UUID match and candidate. | [ADR-0005](../adr/0005-bound-folder-marker.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Exact-name candidate is bound to another UUID | Display-only. | Show owning vault note when known. | [ADR-0001](../adr/0001-vault-is-source-of-truth.md), [ADR-0009](../adr/0009-status-model.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Exact-name candidate has malformed marker | Display-only. | Show malformed status; do not offer overwrite/adoption. | [ADR-0009](../adr/0009-status-model.md), [ADR-0014](../adr/0014-exnf-marker-format-and-validation.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Descendant directory is unreadable | Skip that subtree. | Show warning; do not treat as global open blocker. | [ADR-0009](../adr/0009-status-model.md), [ADR-0013](../adr/0013-filesystem-boundary-and-path-identity.md) |
| Symlink, junction, or reparse-point descendant | Skip traversal. | No automatic action through the skipped path. | [ADR-0013](../adr/0013-filesystem-boundary-and-path-identity.md) |
| Non-candidate malformed marker found during traversal | Do not block active-note recovery by itself. | Show warning summary and direct full diagnosis to Drift Report/Reconcile. | [ADR-0009](../adr/0009-status-model.md), [ADR-0014](../adr/0014-exnf-marker-format-and-validation.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Duplicate active UUID exists elsewhere while expected folder is valid | Not searched. | None; fast path wins. | [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |

## Validation Expectations

Implementation PRs should include unit coverage for recovery scan classification
and command-level coverage for the fast path, single off-path match, duplicate
active UUID, and unmarked exact-name candidate flows.
