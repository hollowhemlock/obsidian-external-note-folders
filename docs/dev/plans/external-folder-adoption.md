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
- Existing correctly bound expected folders open without a full external-root
  scan.
- If the expected folder is not already bound, the command scans the external
  root for the note UUID before creating or adopting anything.
- If the UUID is found elsewhere, the command opens that actual bound folder and
  warns that it is drifted.
- If no UUID binding exists elsewhere and the expected folder is missing, the
  command creates the folder, writes `.exnf`, and opens it.
- If no UUID binding exists elsewhere and the expected folder already exists
  without `.exnf`, the command shows a confirmation modal. Confirmation
  revalidates the folder and writes only `.exnf`.
- Mismatched or malformed expected markers block unless the matching UUID was
  found elsewhere and opened as drifted.

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
- Full external-root scans remain possible on `Open external folder`, but only
  after the exact expected-folder fast path fails for a note that already has
  `exnf`.
