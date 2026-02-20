# ADR-0013: Filesystem Boundary and Path Identity Policy

**Status:** Accepted
**Date:** 2026-02-19
**Participants:** Maintainers

## Context

External root scanning and reconcile path derivation are sensitive to symlinks/junctions, path normalization,
case-insensitive filesystems, and Unicode/canonicalization differences across operating systems.
Without explicit boundary rules, scanning can escape root or misclassify collisions.

## Decision Drivers

- Prevent root escape during scan and mutation
- Maintain cross-platform path correctness
- Make collision behavior deterministic
- Keep no-delete and explicit-mutation guarantees meaningful

## Decision

All external paths must be canonicalized and validated against external-root boundary policy.

- Resolve and normalize candidate paths before use.
- Enforce invariant: all scan and mutation targets must remain within canonical external root.
- Default scan policy: do not traverse symlinks/junctions/reparse points.
- Path comparison policy:
  - use canonical absolute paths for identity
  - apply case-insensitive comparison only where filesystem behavior requires it
  - normalize Unicode to NFC before path-derived naming and comparison
- Conflict policy must include both ancestor and descendant bound-folder marker conflicts.
- If canonicalization or boundary checks fail, classify as `Error` and block mutation.

## Alternatives Considered

### A. Follow links by default during scan
- Pros: More complete traversal in some setups
- Cons: Root escape risk; cycle risk; hard-to-predict behavior
- Why rejected/accepted: Rejected for MVP safety posture

### B. Best-effort path normalization without strict boundary enforcement
- Pros: Simpler implementation
- Cons: Silent corruption and escape risk on edge cases
- Why rejected/accepted: Rejected; safety invariants must be strict

## Consequences

### Positive
- Stronger guarantee that plugin actions stay inside configured root
- More deterministic behavior across Windows/macOS/Linux

### Neutral
- Some user setups relying on links require explicit future support decisions

### Negative / Trade-offs
- Additional path-handling complexity and test coverage burden
- More edge cases surfaced as blocking errors rather than implicit behavior

## Non-Goals

- Full support for every symlink/junction topology in MVP
- Automatic repair of user-created link-based path graphs

## Future Considerations

If optional link traversal is added, it must be explicit opt-in with cycle detection, boundary controls,
and clear UI warnings.

## References

- [ADR-0004](0004-single-external-root.md)
- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0009](0009-status-model.md)
