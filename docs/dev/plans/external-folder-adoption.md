# External Folder Adoption Plan

## Summary

Implement external-root adoption in two PRs. PR 1 makes `Open external folder`
safer by requiring explicit note identity and explicit marker adoption for
already-populated expected folders. PR 2 adds strict, exact-match bulk adoption
for mixed external roots.

## PR 1: Safer Open External Folder

- `Open external folder` never creates note identity. If the active note has no
  valid `exnf`, it stops and directs the user to explicit assignment or
  adoption.
- Existing correctly bound expected folders open immediately without a recovery
  scan.
- If expected-folder inspection does not find a matching marker, the
  active-note recovery scan runs as specified in
  [open-external-folder-recovery.md](open-external-folder-recovery.md) and
  [ADR-0025](../adr/0025-active-note-open-recovery-scan.md).
- Recovery scan is scoped to the active note: current UUID matches, exact-name
  candidates, candidate marker status, owner note where known, skipped
  directories, and malformed-marker warning summaries.
- Safe modal actions revalidate before writing and never overwrite existing
  markers.

## PR 2: Bulk Adopt Existing External Folders

- Add an `Adopt existing external folders` command with dry-run, copyable
  report, and explicit confirm.
- Whole-root pristine state is not required. Root-level scan failures and invalid
  ignore settings are global blockers; unrelated existing identities, markers,
  malformed markers, skipped directories, and ignored directories are reported
  as warnings.
- Notes that already appear in the vault identity scan, including duplicate UUID
  note paths, are not adoption candidates.
- Blocked rows still show cleanup details; safe unrelated rows can execute.
- Adoptable rows are exact one-to-one matches between note-derived external
  paths and existing external directories. Folder-note collapse applies, so
  `A/B/B.md` matches external folder `A/B`.
- No suffix, basename, or fuzzy tree-tail inference is used.
- Collisions, duplicate normalized folder identities, unmatched notes, and
  unmatched folders are reported but not adopted.
- Parent folders that only contain bound, blocked, or adoptable external folders
  are structural containers and are omitted from unmatched folder rows.
- Candidate targets are blocked when they are ignored, inside skipped
  directories, marked, malformed, already bound, overlapped by ancestor or
  descendant marker evidence, or duplicated by normalized path identity.
- Apply re-runs preflight, generates one UUID per adopted row, journals each row,
  writes `<uuid>.exnf` first, writes note frontmatter second, and stops on first
  failure.
- Resume is allowed only from adoption-owned incomplete journals whose recorded
  state still matches the current vault and external root.

## External Root Ignore Contract

- Ignore patterns are user-configured and default to empty.
- Patterns are slash-normalized and matched relative to the canonical external
  root.
- A single leading `/` is root-anchored relative to the external root, not a
  filesystem-absolute path.
- Windows drive paths and UNC paths are rejected.
- `!` negation is rejected in v1.
- Directory pruning happens before descendant `readdir`, so ignored temp folders
  do not produce EPERM warnings and markers inside ignored subtrees are
  invisible to adoption, verify, drift, reconcile, and open recovery fallback
  scans.
- Existing note identities whose expected folder is ignored are reported as
  ignored/unchecked, not missing or healthy.

## Adoption Journal Contract

- Adoption journals live under the existing plugin journal root in an
  `adoption/` subdirectory.
- Journals are append-only audit history, not source of truth. Completed
  journals never block a new adoption run, even if their corresponding
  markers/frontmatter are later manually removed.
- Multiple incomplete journals block resume and require manual inspection.
- Failure stages are `preflight`, `marker-write`, and `frontmatter-write`.
- `frontmatter-write` failures may be resumed by writing the missing note
  frontmatter only when the marker state still matches the journal.

## Known Limitations

- Marker atomicity is best effort on remote or synced volumes. Temp-file plus
  same-directory rename is reliable on a local filesystem, but sync providers may
  expose intermediate states.
- Adoption proves row-local coherence, not whole-root coherence. Mixed roots may
  still contain unrelated warnings after a successful adoption run.
- Active-note open recovery may traverse the external root after expected-path
  failure. Long-running commands show a start/progress modal, but scan caps,
  cancellation, and cached indexes are out of scope until performance requires
  them.
