---
status: "Accepted"
date: "2026-05-10"
decision-makers: "Maintainers"
tags: "external-root, safety, status-model"
when_to_read: "Before changing active-note open fallback or recovery behavior."
---

# Active-Note Open Recovery Scan

## Context and Problem Statement

`Open external folder` must stay fast when the active note's expected folder is
already correctly bound, but the failure path needs enough context to avoid
creating duplicate folders when the note's existing marker was moved or
renamed outside the expected path.

Marker filename details in the original version of this ADR were superseded by
[ADR-0027](0027-uuid-named-marker-files.md). The recovery flow still applies:
the fast path opens a matching expected marker, and the fallback scan enumerates
the marker contract currently accepted by ADR-0027.

The previous accepted behavior kept `Open external folder` local to the expected
path only. That avoided expensive scans, but it also made a common recovery case
too blunt: if the expected folder was missing or conflicted, the command could
not show the user whether the current note's UUID already existed elsewhere or
whether exact-name candidate folders were available for adoption.

## Decision Drivers

- Preserve the zero-scan fast path for correctly bound expected folders
- Keep identity creation explicit; opening must never create note `exnf`
- Recover active-note drift without showing unrelated orphan folders
- Detect duplicate current-UUID markers caused by copied marker files

## Considered Options

* Expected-folder-only open behavior
* Full drift report inside `Open external folder`
* Active-note recovery scan after expected-folder failure
* Rename markers to `{uuid}.exnf` (superseded by ADR-0027)

## Decision Outcome

`Open external folder` uses this model:

1. Inspect the active note's derived expected folder.
2. If the expected folder has a matching marker, open immediately and do not
   scan the external root.
3. If expected-folder inspection is anything other than matching bound, run an
   active-note recovery scan across the external root.
4. The recovery scan is complete for that invocation. It does not stop at the
   first current-UUID marker because copied marker files can create duplicate
   bindings.
5. The recovery scan collects only active-note-relevant data:
   - folders whose marker equals the active note UUID
   - exact normalized-basename candidate folders for the expected folder name
   - marker status for those candidates
   - owner vault note when a candidate is bound to a UUID known in vault
     metadata
   - skipped descendant-directory warnings
   - ignored descendant-directory summaries from external-root ignore settings
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
- use ADR-0013 path identity for case sensitivity: compare according to the
  configured external root's filesystem probe result, defaulting to
  case-insensitive only when the probe is inconclusive
- do not use fuzzy, suffix, tree-tail, or similarity matching

### Marker Format

This ADR no longer owns marker filename selection. [ADR-0027](0027-uuid-named-marker-files.md)
changes the marker filename contract to `<uuid>.exnf` and defines the legacy
`.exnf` migration window. The active-note recovery rule remains unchanged:
open immediately when the expected folder has the active note's marker, and
scan only after expected-folder inspection fails.

### Relationship to Ignore Patterns

External-root ignore pattern semantics are governed by
[ADR-0026](0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md).
Ignored folders are not traversed and do not contribute marker evidence to the
active-note recovery scan. If the expected folder itself is ignored, recovery can
still explain that state but safe create/adopt actions for that ignored target
are disabled.

### Out of Scope

- Scan caps, cancellation, cache/indexing, or background indexing
- Full drift classification from within `Open external folder`
- Changing marker payload schema

## Consequences

### Positive

- Correctly bound notes still open without external-root traversal
- Failure paths can find moved/renamed active-note folders
- Duplicate copied markers are visible before auto-opening
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
- Why rejected: Too little recovery information for real migrated roots

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
- Why accepted: Best fit for active-note recovery without broad report noise

### Rename markers to `{uuid}.exnf`

- Original outcome: Rejected for this ADR's recovery-scan feature.
- Superseded by: ADR-0027 later accepted `<uuid>.exnf` for concurrent assignment
  safety, not as a recovery-scan performance optimization.

## More Information

### References

- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0009](0009-status-model.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
- [ADR-0014](0014-exnf-marker-format-and-validation.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [ADR-0023](0023-open-external-folder-does-not-assign-identity.md)
- [ADR-0026](0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md)
- [ADR-0027](0027-uuid-named-marker-files.md)
- [docs/dev/plans/open-external-folder-recovery.md](../plans/open-external-folder-recovery.md)
