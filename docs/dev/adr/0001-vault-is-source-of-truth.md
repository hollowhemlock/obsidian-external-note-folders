---
status: "Accepted"
date: "2026-02-14"
decision-makers: "Maintainers"
---

# Vault Is the Source of Truth

## Context and Problem Statement

The plugin links notes to external folders. Both the vault and the external root can be moved,
partially synced, or unavailable on some machines. A single authoritative source is required.

## Decision Drivers

- Deterministic behavior across machines and sync setups
- Avoid unsafe “guessing” based on filesystem state
- Keep external-root operations derived and reversible
- Reduce need for watchers/automation in MVP

## Considered Options

* External root is source of truth
* Dual-authoritative model

## Decision Outcome

The vault is authoritative for identity mapping.

- Notes store a UUID in frontmatter (`exnf: <uuid>`)
- The external root reflects vault state for notes that have bound folders; notes without bound
  folders and unavailable external roots are expected, not errors
- External state is derived and may be incomplete: missing bound folders are informational
  (Unavailable), not failures

### Consequences

### Positive
- Stable, predictable behavior
- External unavailability is survivable
- MVP can avoid watchers and background mutation

### Negative / Trade-offs
- Some external-only reorganizations require manual user action
- Plugin will not “magically” fix external drift without reconcile

## Pros and Cons of the Options

### External root is source of truth
- Pros: External structure could be treated as canonical; could “rebuild” vault associations
- Cons: Requires mutating vault, introduces deletion semantics, fails if external root unavailable
- Why rejected: Violates trust boundary and increases ambiguity/risk

### Dual-authoritative model
- Pros: Bidirectional updates possible
- Cons: Complex conflicts, unclear precedence, hard to test safely
- Why rejected: Too complex/risky for MVP

## More Information

### Non-Goals

- Bidirectional syncing between vault and external root

### Future Considerations

If bidirectional features are ever added, they must begin as read-only suggestions and must not
auto-delete vault content.
