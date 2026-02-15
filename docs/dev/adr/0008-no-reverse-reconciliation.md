# ADR 0008: No Reverse Reconciliation (External Does Not Drive Vault)

**Status:** Accepted  
**Date:** 2026-02-14

## Context

External folders can be moved/deleted/edited outside Obsidian. If the plugin lets external state
mutate vault content, it introduces deletion semantics and significant ambiguity about intent.

## Decision Drivers

- Avoid vault mutation based on external state
- Avoid watchers and background operations in MVP
- Preserve safety/trust boundary
- Keep vault authoritative

## Decision

External state never drives vault changes.

The plugin does not:
- Create notes from external folders
- Move notes based on external changes
- Delete notes when external folders disappear

External changes are reported by Verify only.

## Alternatives Considered

### A. Reverse reconcile: external → vault
- Pros: Could “rebuild” vault mapping from external structure
- Cons: Requires watchers; ambiguous; deletion semantics; surprising
- Why rejected: Too risky and complex

### B. Bidirectional model
- Pros: Full mirroring
- Cons: Hard conflicts; unclear precedence; high support burden
- Why rejected: Not MVP; violates safety goals

## Consequences

### Positive
- Trust boundary preserved
- Predictable behavior even when external root unavailable

### Negative / Trade-offs
- Users must manage external-only reorganizations manually

## Non-Goals

- Automatically reflecting external changes into vault

## Future Considerations

If ever added, it must start as read-only suggestions and must never auto-delete vault content.
