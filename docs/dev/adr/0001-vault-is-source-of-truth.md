# ADR-0001: Vault Is the Source of Truth

**Status:** Accepted
**Date:** 2026-02-14
**Participants:** Maintainers

## Context

The plugin links notes to external folders. Both the vault and the external root can be moved,
partially synced, or unavailable on some machines. A single authoritative source is required.

## Decision Drivers

- Deterministic behavior across machines and sync setups
- Avoid unsafe “guessing” based on filesystem state
- Keep external-root operations derived and reversible
- Reduce need for watchers/automation in MVP

## Decision

The vault is authoritative for identity mapping.

- Notes store a UUID in frontmatter (`exf: <uuid>`)
- The external root reflects vault state for notes that have bound folders; notes without bound
  folders and unavailable external roots are expected, not errors
- External state is derived and may be incomplete: missing bound folders are informational
  (Unavailable), not failures

## Alternatives Considered

### A. External root is source of truth
- Pros: External structure could be treated as canonical; could “rebuild” vault associations
- Cons: Requires mutating vault, introduces deletion semantics, fails if external root unavailable
- Why rejected: Violates trust boundary and increases ambiguity/risk

### B. Dual-authoritative model
- Pros: Bidirectional updates possible
- Cons: Complex conflicts, unclear precedence, hard to test safely
- Why rejected: Too complex/risky for MVP

## Consequences

### Positive
- Stable, predictable behavior
- External unavailability is survivable
- MVP can avoid watchers and background mutation

### Negative / Trade-offs
- Some external-only reorganizations require manual user action
- Plugin will not “magically” fix external drift without reconcile

## Non-Goals

- Bidirectional syncing between vault and external root

## Future Considerations

If bidirectional features are ever added, they must begin as read-only suggestions and must not
auto-delete vault content.
