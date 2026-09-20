---
status: "Accepted"
date: "2026-02-14"
decision-makers: "Maintainers"
---

# No Reverse Reconciliation (External Does Not Drive Vault)

## Context and Problem Statement

External folders can be moved/deleted/edited outside Obsidian. If the plugin lets external state
mutate vault content, it introduces deletion semantics and significant ambiguity about intent.

## Decision Drivers

- Avoid vault mutation based on external state
- Avoid watchers and background operations in MVP
- Preserve safety/trust boundary
- Keep vault authoritative

## Considered Options

* Reverse reconcile: external → vault
* Bidirectional model

## Decision Outcome

External state never automatically drives vault changes.

ADR-0032 adds explicit, confirmed single-folder adoption from the report: users may
create a matching note or move a selected note to the matching location. This does
not change the direction of reconciliation or permit automatic synchronization.

ADR-0031 adds one explicit exception: an unassigned note may restore the unique UUID marker identity
from its exact expected folder after a complete non-ignored-root scan and user confirmation. This is
not automatic reconciliation and does not create, move, rename, or delete notes.

The External folder status window also permits an explicit, confirmed move of one
already-bound note to match its external folder. It preserves the UUID, uses fresh
full identity checks and journaled Obsidian rename/recovery, and never moves a vault
folder or performs automatic synchronization.

Outside these explicit workflows, the plugin does not:
- Create notes from external folders
- Move notes based on external changes
- Delete notes when external folders disappear

External changes are reported by explicit read-only reports. The ADR-0031 restoration exception is
available only through `Set up external folder`.

### Consequences

### Positive
- Trust boundary preserved
- Predictable behavior even when external root unavailable

### Negative / Trade-offs
- Users must manage external-only reorganizations manually

## Pros and Cons of the Options

### Reverse reconcile: external → vault
- Pros: Could “rebuild” vault mapping from external structure
- Cons: Requires watchers; ambiguous; deletion semantics; surprising
- Why rejected: Too risky and complex

### Bidirectional model
- Pros: Full mirroring
- Cons: Hard conflicts; unclear precedence; high support burden
- Why rejected: Not MVP; violates safety goals

## More Information

### Non-Goals

- Automatically reflecting external changes into vault

Explicit exact-path identity restoration is governed by [ADR-0031](0031-pragmatic-active-note-setup.md).

### Future Considerations

If ever added, it must start as read-only suggestions and must never auto-delete vault content.

### References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
