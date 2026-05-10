# External Folder Adoption Plan

## Summary

Implement external-root adoption in two PRs. PR 1 makes `Open external folder`
safer by requiring explicit note identity and explicit marker adoption for
already-populated expected folders. PR 2 adds strict, exact-match bulk adoption
for pristine external roots.

## PR 1: Safer Open External Folder

- `Open external folder` never creates note identity. If the active note has no
  valid `exnf`, it stops and directs the user to explicit assignment or
  adoption.
- Existing correctly bound expected folders open immediately without a recovery
  scan.
- If expected-folder inspection does not find a matching `.exnf`, the proposed
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
- Normal execution requires pristine identity state: no note `exnf`, no external
  `.exnf`, no malformed markers, no duplicate UUIDs, no root access errors, and
  no skipped directories.
- Blocked plans still show cleanup details; execution is disabled.
- Adoptable rows are exact one-to-one matches between note-derived external
  paths and existing external directories. Folder-note collapse applies, so
  `A/B/B.md` matches external folder `A/B`.
- No suffix, basename, or fuzzy tree-tail inference is used.
- Collisions, duplicate normalized folder identities, unmatched notes, and
  unmatched folders are reported but not adopted.
- Apply re-runs preflight, generates one UUID per adopted row, journals each row,
  writes `.exnf` first, writes note frontmatter second, and stops on first
  failure.
- Resume is allowed only from adoption-owned incomplete journals whose recorded
  state still matches the current vault and external root.

## Adoption Journal Contract

- Adoption journals live under the existing plugin journal root in an
  `adoption/` subdirectory.
- Journals are append-only audit history, not source of truth. Completed
  journals never block a new pristine adoption run, even if their corresponding
  markers/frontmatter are later manually removed.
- Multiple incomplete journals block resume and require manual inspection.
- Failure stages are `preflight`, `marker-write`, and `frontmatter-write`.
- `frontmatter-write` failures may be resumed by writing the missing note
  frontmatter only when the marker state still matches the journal.

## Known Limitations

- Marker atomicity is best effort on remote or synced volumes. Temp-file plus
  same-directory rename is reliable on a local filesystem, but sync providers may
  expose intermediate states.
- Strict pristine adoption is conservative. Partially assigned roots require
  manual cleanup or reconcile before bulk adoption.
- Active-note open recovery may traverse the external root after expected-path
  failure. Ignore rules, scan caps, progress UI, cancellation, and cached indexes
  are out of scope until performance requires them.
