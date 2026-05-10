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

The command can still create or adopt external-root folders for notes that
already have identity, but note identity creation itself is durable vault state.
That boundary must be explicit because later open-recovery behavior may inspect
the external root without changing vault frontmatter.

## Decision Drivers

- Keep note identity creation explicit and reviewable
- Avoid surprising frontmatter mutation from a command named "open"
- Preserve fast open behavior when the expected folder is already correctly
  bound
- Leave active-note recovery scan policy to a separate decision

## Considered Options

* Keep implicit assignment inside `Open external folder`
* Split identity assignment from opening
* Make `Open external folder` read-only forever
* Allow active-note recovery after identity already exists

## Decision Outcome

`Open external folder` must never create note identity. If the active note has no
valid `exnf`, it stops and directs the user to an explicit assignment or adoption
flow.

For notes that already have a valid `exnf`, the command may inspect and mutate
external-root state only to open, create, or explicitly adopt an external folder
for that existing note identity. It must not generate a UUID, write note
frontmatter, or otherwise make the active note identified as a side effect of
opening.

Fast-path and recovery-scan behavior for already-identified notes is owned by
[ADR-0025](0025-active-note-open-recovery-scan.md). This ADR only owns the note
identity boundary.

### Consequences

### Positive

- Opening no longer mutates note frontmatter unexpectedly
- Explicit assignment and adoption flows own identity creation
- Open recovery can evolve without weakening the note identity contract
- External marker/folder changes remain tied to an existing note UUID

### Negative / Trade-offs

- Users must run one extra explicit command before opening a folder for a note
  without identity
- `Open external folder` can still mutate external-root state for an
  already-identified note, so callers must distinguish note identity assignment
  from folder marker adoption
- Recovery-scan cost and modal behavior are decided separately and may change
  while ADR-0025 is proposed

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
- Why rejected: Creating a missing expected folder is useful after identity
  already exists; whole-root drift checks remain available through explicit
  commands

### Allow active-note recovery after identity already exists

- Pros: Avoids duplicate folder creation when the note's UUID is already bound
  somewhere else; gives users a focused path out of expected-folder drift
- Cons: Can make fallback opening proportional to external-root size; requires
  careful modal and warning design
- Why deferred: This ADR is about identity assignment. Active-note recovery is
  specified separately in ADR-0025.

## More Information

### References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0002](0002-missing-external-is-normal.md)
- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [ADR-0025](0025-active-note-open-recovery-scan.md)
- [docs/dev/plans/external-folder-adoption.md](../plans/external-folder-adoption.md)
- [docs/dev/plans/open-external-folder-recovery.md](../plans/open-external-folder-recovery.md)
