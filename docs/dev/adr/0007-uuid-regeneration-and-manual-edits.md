# ADR-0007: UUID Regeneration and Manual UUID Edits

**Status:** Accepted
**Date:** 2026-02-14
**Participants:** Maintainers

## Context

Users may accidentally duplicate UUIDs (copy/paste), or intentionally want to re-associate a note to
a different external folder. Users may also manually edit frontmatter.

## Decision Drivers

- Provide escape hatch without destructive operations
- Support intentional re-association
- Keep behavior explicit and safe
- Avoid implicit deletes or renames

## Decision

Provide a Regenerate UUID command with the following behavior:

- By default, if a bound folder exists for the current UUID, abort and prompt the user to confirm
  re-association before proceeding.
- On confirmed re-association: generate a new UUID, write it to the note's frontmatter, and treat
  the note as a new unbound association. The old bound folder is not moved or deleted; it becomes
  an orphan.
- If no bound folder exists for the current UUID, regeneration proceeds without confirmation.

Manual UUID edits to frontmatter are treated as re-association: the old UUID's bound folder
becomes an orphan. Manual edits must be surfaced in Verify/Reconcile output.

A vault-side `exf` frontmatter value that is not a valid RFC 4122 UUID is classified as an
`Error` (per ADR-0009) and blocks mutation operations for that note.

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

## References

- [ADR-0003](0003-no-deletions.md)
- [ADR-0009](0009-status-model.md)
