# ADR-0009: Explicit Status Model (OK / Unavailable / Warning / Error)

**Status:** Accepted
**Date:** 2026-02-14
**Participants:** Maintainers

## Context

The plugin must distinguish between normal absence and true integrity problems. External folders may
be missing intentionally or temporarily.

## Decision Drivers

- External root may be partial/unavailable
- Avoid false “broken” signals
- Make errors actionable and rare
- Keep reconcile behavior deterministic

## Decision

Define these statuses:

- **OK:** UUID present in vault, matching bound folder exists in external root
- **Unavailable (Informational):** UUID present in vault, no matching bound folder exists
- **Warning:** Orphan bound folder exists (external UUID not present in vault)
- **Error (Integrity):**
  - Duplicate UUIDs in vault
  - Duplicate UUIDs in external root
  - `.exf` malformed/unreadable
  - UUID mismatch collisions (e.g., target path has different UUID)
  - Vault-side `exf` frontmatter value that is not a valid UUID
  - External root directory absent or inaccessible (blocks all mutations)

Errors abort the entire reconcile run; no further moves are attempted after the first error is
encountered. See ADR-0011 for execution semantics.

## Alternatives Considered

### A. Binary valid/invalid
- Pros: Simple
- Cons: Treats normal absence as failure; noisy; misleading
- Why rejected: External missing is normal

### B. Auto-fix on detection
- Pros: Fewer warnings
- Cons: Implicit mutation; risks creating unwanted folders
- Why rejected: Violates explicit-change model; not MVP

## Consequences

### Positive
- Clear diagnostics for users
- Stable expectations across machines

### Negative / Trade-offs
- Slightly more reporting complexity

## Non-Goals

- Automatically “correcting” Unavailable or Warning states

## Future Considerations

If bulk creation or cleanup is added later, it must be explicit, opt-in, and preserve these semantics.

## References

- [ADR-0002](0002-missing-external-is-normal.md)
- [ADR-0003](0003-no-deletions.md)
- [ADR-0011](0011-reconcile-execution-safety-model.md)
