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

The command also needs to stay fast in large external roots. Full-root scans can
surface unrelated orphan folders and permission errors when the configured
external root contains other projects.

## Decision Drivers

- Keep note identity creation explicit and reviewable
- Avoid surprising frontmatter mutation from a command named "open"
- Preserve fast open behavior when the expected folder is already correctly
  bound
- Keep open latency proportional to the active note's expected folder, not the
  size of the external root

## Considered Options

* Keep implicit assignment inside `Open external folder`
* Split identity assignment from opening
* Make `Open external folder` read-only forever
* Scan the external root from `Open external folder` to find drifted bindings

## Decision Outcome

`Open external folder` must never create note identity. If the active note has no
valid `exnf`, it stops and directs the user to an explicit assignment or adoption
flow.

For notes that already have a valid `exnf`, the command uses this order:

1. Inspect the derived expected folder.
2. Open immediately if the expected folder has a matching `.exnf`.
3. If the expected folder is missing, create it, write `.exnf`, and open it.
4. If the expected folder exists without `.exnf`, prompt before writing the
   marker.
5. If the expected folder has a mismatched or malformed marker, block.

The command does not scan the external root to find off-path `.exnf` markers.
Drift discovery belongs to explicit verify, drift report, and reconcile
commands.

Earlier versions of this decision allowed a fallback scan before create/adopt to
avoid duplicate folders when a matching UUID was already bound elsewhere. That
was rejected because it made a navigation command traverse the whole external
root, surface unrelated orphan folders, and report unrelated descendant access
errors.

### Consequences

### Positive

- Opening no longer mutates note frontmatter unexpectedly
- Explicit assignment and adoption flows own identity creation
- Opening does not scan unrelated external-root descendants
- Expected-folder validation remains local to the active note

### Negative / Trade-offs

- Users must run one extra explicit command before opening a folder for a note
  without identity
- A drifted `.exnf` marker elsewhere in the external root is not discovered by
  `Open external folder`
- If a note's expected folder is missing while its marker exists elsewhere,
  opening can create a new expected folder; users should run drift report or
  reconcile when they suspect drift

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

### Scan the external root from `Open external folder` to find drifted bindings

- Pros: Avoids duplicate folder creation when the note's UUID is already bound
  somewhere else
- Cons: Makes opening proportional to external-root size; surfaces unrelated
  orphan markers and permission errors from unrelated descendants
- Why rejected: Explicit drift commands are the right place for whole-root
  analysis; a navigation command must remain fast and local

## More Information

### References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0002](0002-missing-external-is-normal.md)
- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [docs/dev/plans/external-folder-adoption.md](../plans/external-folder-adoption.md)
