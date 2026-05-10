---
status: "Proposed"
date: "2026-05-10"
decision-makers: "Maintainers"
tags: "external-root, safety, status-model"
when_to_read: "Before changing active-note open fallback or recovery behavior."
---

# Active-Note Open Recovery Scan

## Context and Problem Statement

`Open external folder` must stay fast when the active note's expected folder is
already correctly bound, but the failure path needs enough context to avoid
creating duplicate folders when the note's existing `.exnf` marker was moved or
renamed outside the expected path.

The previous accepted behavior kept `Open external folder` local to the expected
path only. That avoided expensive scans, but it also made a common recovery case
too blunt: if the expected folder was missing or conflicted, the command could
not show the user whether the current note's UUID already existed elsewhere or
whether exact-name candidate folders were available for adoption.

## Decision Drivers

- Preserve the zero-scan fast path for correctly bound expected folders
- Keep identity creation explicit; opening must never create note `exnf`
- Recover active-note drift without showing unrelated orphan folders
- Detect duplicate current-UUID markers caused by copied `.exnf` files
- Keep marker format stable and avoid migration work before the feature is
  proven

## Considered Options

* Expected-folder-only open behavior
* Full drift report inside `Open external folder`
* Active-note recovery scan after expected-folder failure
* Rename markers to `{uuid}.exnf`

## Decision Outcome

This ADR is proposed until the first implementation validates the UX and
performance. If accepted, `Open external folder` will use this model:

1. Inspect the active note's derived expected folder.
2. If the expected folder has a matching `.exnf`, open immediately and do not
   scan the external root.
3. If expected-folder inspection is anything other than matching bound, run an
   active-note recovery scan across the external root.
4. The recovery scan is complete for that invocation. It does not stop at the
   first current-UUID marker because copied `.exnf` files can create duplicate
   bindings.
5. The recovery scan collects only active-note-relevant data:
   - folders whose `.exnf` marker equals the active note UUID
   - exact normalized-basename candidate folders for the expected folder name
   - marker status for those candidates
   - owner vault note when a candidate is bound to a UUID known in vault
     metadata
   - skipped descendant-directory warnings
6. If exactly one off-path folder is bound to the active note UUID, the command
   opens that folder and shows a persistent recovery modal.
7. If multiple folders are bound to the active note UUID, the command does not
   auto-open. The recovery modal shows the duplicate markers and requires manual
   decision or cleanup.
8. If no active-UUID marker is found elsewhere, the modal shows exact-name
   candidates and actions for safe creation/adoption.

### Candidate Matching

Candidate matching is exact normalized basename equality only:

- derive the expected folder basename from ADR-0015 path derivation
- normalize Unicode to NFC
- compare case-insensitively on Windows and macOS platform defaults, matching
  the current path identity policy
- do not use fuzzy, suffix, tree-tail, or similarity matching

### Marker Format

The marker remains `.exnf` with a strict UUID payload. Renaming markers to
`{uuid}.exnf` is rejected for this feature because it still requires directory
tree traversal when markers can exist anywhere, exposes UUIDs in filenames, and
adds migration cost without solving the dominant performance cost.

### Out of Scope

- Ignore rules for backups, archives, build outputs, or unrelated projects
- Scan caps, progress UI, cancellation, cache/indexing, or background indexing
- Full drift classification from within `Open external folder`
- Changing `.exnf` marker format or adding marker filename variants

## Consequences

### Positive

- Correctly bound notes still open without external-root traversal
- Failure paths can find moved/renamed active-note folders
- Duplicate copied `.exnf` markers are visible before auto-opening
- Users get persistent recovery context instead of transient notices
- Full drift/orphan noise remains in explicit report/reconcile commands

### Negative / Trade-offs

- Failure paths may traverse the whole external root
- Duplicate current-UUID markers block auto-open unless the expected folder was
  already valid
- Exact-name candidates may miss plausible but renamed folders
- Future ignore/caching decisions may be needed if large roots make recovery
  scans too slow

## Pros and Cons of the Options

### Expected-folder-only open behavior

- Pros: Fastest and simplest
- Cons: Cannot find active-note markers moved elsewhere; may create duplicate
  expected folders
- Why rejected/proposed to supersede: Too little recovery information for real
  migrated roots

### Full drift report inside `Open external folder`

- Pros: Complete root diagnostics
- Cons: Surfaces unrelated orphans and broad integrity state during a navigation
  command
- Why rejected: Open should recover the active note, not become a root-wide
  drift report

### Active-note recovery scan after expected-folder failure

- Pros: Finds relevant moved folders and duplicates while keeping the common
  path fast
- Cons: Still traverses the root on failure paths
- Why proposed: Best fit for active-note recovery without broad report noise

### Rename markers to `{uuid}.exnf`

- Pros: Could identify UUID from filename once the file is encountered
- Cons: Still requires traversal; exposes UUID in names; requires migration and
  coexistence policy
- Why rejected: Not enough performance benefit for the migration cost

## More Information

### References

- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0009](0009-status-model.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
- [ADR-0014](0014-exnf-marker-format-and-validation.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [ADR-0023](0023-open-external-folder-does-not-assign-identity.md)
- [docs/dev/plans/open-external-folder-recovery.md](../plans/open-external-folder-recovery.md)
