---
status: "Superseded"
date: "2026-05-07"
decision-makers: "Maintainers"
superseded_by: "ADR-0026"
---

# Strict Exact Adoption with Journaled Marker-First Writes

Superseded by [ADR-0026](0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md).
The marker-first, journaled execution contract remains; the whole-root pristine
precondition was replaced with row-local exact adoption for mixed roots.

## Context and Problem Statement

Existing external roots may contain many folders whose relationship to vault
notes is ambiguous. The plugin needs a future bulk adoption path that can safely
bind obvious matches without guessing, overwriting, deleting, or leaving users
without an audit trail after partial failure.

Bulk adoption also crosses two identity stores: vault note frontmatter and
external markers. The write order and resume policy must be explicit
before implementation.

## Decision Drivers

- Never infer identity from fuzzy folder-name similarity
- Keep adoption auditable and recoverable after partial failure
- Avoid mutating mixed or already-assigned roots without deliberate cleanup
- Preserve platform-aware path identity while keeping original path casing for
  display and writes

## Considered Options

* Fuzzy or suffix-based adoption
* Strict exact adoption without resume
* Strict exact adoption with journaled marker-first writes

## Decision Outcome

Bulk adoption uses strict exact matching and journaled marker-first writes.

The adoption command requires pristine identity state before normal execution:
no note `exnf`, no external markers, no malformed markers, no duplicate UUIDs,
no root access errors, and no skipped directories. It adopts only exact
one-to-one matches between note-derived expected external paths and existing
external directories. Folder-note collapse applies, so `A/B/B.md` matches
external folder `A/B`.

Path identity is compared using normalized absolute identities:

- normalize separators and dot segments
- normalize Unicode to NFC
- case-fold on Windows and macOS platform defaults
- preserve original casing and spelling for display and writes

Apply re-runs preflight, generates one UUID per adopted row, writes the external
marker first, then writes note frontmatter second. Each row is journaled.
Execution stops on the first failure.

Resume is allowed only from adoption-owned incomplete journals whose recorded
state still matches the current vault and external root. Journals are append-only
audit history, not source of truth. Completed journals never block a new
pristine adoption run, even if their corresponding markers or frontmatter are
later manually removed.

Failure stages are:

- `preflight`: no adoption write should have been committed
- `marker-write`: marker commit failed or could not be confirmed
- `frontmatter-write`: marker committed, note frontmatter still pending

`frontmatter-write` failures may resume by writing the missing note frontmatter
only when the marker state still matches the journal.

### Consequences

### Positive

- Adoption avoids ambiguous ownership guesses
- Marker-first ordering leaves the more visible orphan if the second write fails
- Journals give users and maintainers a concrete partial-failure trail
- Resume has a narrow contract instead of replaying arbitrary mixed state

### Negative / Trade-offs

- Mixed or partially assigned roots require cleanup before bulk adoption
- Some folders that are probably related will remain unmatched unless the path
  is exact
- Journal and resume logic add implementation complexity
- Marker atomicity is best effort on remote or synced volumes

## Pros and Cons of the Options

### Fuzzy or suffix-based adoption

- Pros: May match more real-world folders on the first run
- Cons: Can silently bind the wrong folder to a note
- Why rejected: Wrong adoption is worse than no adoption

### Strict exact adoption without resume

- Pros: Simpler implementation
- Cons: A partial failure can leave users with manual cleanup and no structured
  recovery path
- Why rejected: Bulk adoption is rare and high-stress; failure reporting and
  resume matter

### Strict exact adoption with journaled marker-first writes

- Pros: Conservative, auditable, and recoverable for the expected failure shape
- Cons: More code and stricter preconditions
- Why accepted: Best balance between safety and useful onboarding

## More Information

### References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [docs/dev/plans/external-folder-adoption.md](../plans/external-folder-adoption.md)
