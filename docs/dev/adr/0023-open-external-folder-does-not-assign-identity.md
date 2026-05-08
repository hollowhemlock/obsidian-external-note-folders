---
status: "Accepted"
date: "2026-05-07"
decision-makers: "Maintainers"
---

# Open External Folder Does Not Assign Identity

## Context and Problem Statement

`Open external folder` previously had two responsibilities: open the active
note's external folder and, when the note had no `exnf`, create note identity as
a side effect. That made a navigation command mutate vault frontmatter and could
create bindings before the user had explicitly chosen to assign or adopt an
external folder.

The command also needs to avoid creating duplicate expected folders when the
same UUID is already bound somewhere else under the external root.

## Decision Drivers

- Keep note identity creation explicit and reviewable
- Avoid surprising frontmatter mutation from a command named "open"
- Preserve fast open behavior when the expected folder is already correctly
  bound
- Avoid duplicate folder creation when a drifted binding already exists

## Considered Options

* Keep implicit assignment inside `Open external folder`
* Split identity assignment from opening
* Make `Open external folder` read-only forever

## Decision Outcome

`Open external folder` must never create note identity. If the active note has no
valid `exnf`, it stops and directs the user to an explicit assignment or adoption
flow.

For notes that already have a valid `exnf`, the command uses this order:

1. Inspect the derived expected folder.
2. Open immediately if the expected folder has a matching `.exnf`.
3. If the expected folder is not already bound, scan the external root for the
   UUID before creating or adopting anything.
4. If that UUID is found elsewhere, open the actual bound folder and warn that
   it is drifted.
5. If no binding exists and the expected folder is missing, create it, write
   `.exnf`, and open it.
6. If no binding exists and the expected folder exists without `.exnf`, prompt
   before writing the marker.
7. If the expected folder has a mismatched or malformed marker and no matching
   UUID exists elsewhere, block.

### Consequences

### Positive

- Opening no longer mutates note frontmatter unexpectedly
- Explicit assignment and adoption flows own identity creation
- Drifted existing bindings are preferred over duplicate folder creation
- Correctly bound expected folders still use a fast path without a full scan

### Negative / Trade-offs

- Users must run one extra explicit command before opening a folder for a note
  without identity
- Some open attempts perform a full external-root scan after the expected-folder
  fast path fails

## Pros and Cons of the Options

### Keep implicit assignment inside `Open external folder`

- Pros: Fewer clicks for new notes
- Cons: Surprising mutation; makes adoption behavior harder to reason about
- Why rejected: Identity creation is too durable to hide inside an open command

### Split identity assignment from opening

- Pros: Clear user intent, safer recovery, smaller mutation surface
- Cons: Adds an explicit step for unassigned notes
- Why accepted: Best fit for a data-safety-oriented plugin

### Make `Open external folder` read-only forever

- Pros: Very simple command semantics
- Cons: Would remove useful lazy folder creation for already-assigned notes
- Why rejected: Creating a missing expected folder is safe after identity already
  exists and no binding exists elsewhere

## More Information

### References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0002](0002-missing-external-is-normal.md)
- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [docs/dev/plans/external-folder-adoption.md](../plans/external-folder-adoption.md)
