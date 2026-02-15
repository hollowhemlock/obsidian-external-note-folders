# ADR 0007: UUID Regeneration and Manual UUID Edits

**Status:** Accepted  
**Date:** 2026-02-14

## Context

Users may accidentally duplicate UUIDs (copy/paste), or intentionally want to re-associate a note to
a different external folder. Users may also manually edit frontmatter.

## Decision Drivers

- Provide escape hatch without destructive operations
- Support intentional re-association
- Keep behavior explicit and safe
- Avoid implicit deletes or renames

## Decision

Provide a Regenerate UUID command with modes:

- **Re-associate:** generate a new UUID and treat as a new association. If an old bound folder exists, it becomes an orphan.
- **Safe abort mode:** if a bound folder exists for the current UUID, abort regeneration unless the user explicitly confirms re-association.

Manual UUID edits are treated as re-association, but must be surfaced via Verify/Reconcile reporting.

Duplicate UUIDs in the vault are integrity errors.

## Alternatives Considered

### A. Disallow manual edits / regeneration entirely
- Pros: Simpler; fewer edge cases
- Cons: No recovery path; users will edit anyway
- Why rejected: Too rigid; harms usability

### B. Auto-migrate external folder on regeneration
- Pros: Keeps continuity
- Cons: Can be destructive/ambiguous; increases risk
- Why rejected: Violates explicit-change approach; not MVP

## Consequences

### Positive
- Users can recover from mistakes
- Re-association is supported safely

### Negative / Trade-offs
- Orphans may accumulate
- Requires clear reporting UX

## Non-Goals

- Automatic cleanup or migration of old associations

## Future Considerations

Later versions may add explicit “adopt existing bound folder” flows, but must remain non-destructive.
