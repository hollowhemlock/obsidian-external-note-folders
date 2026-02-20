# ADR-0004: Single External Root

**Status:** Accepted
**Date:** 2026-02-14
**Participants:** Maintainers

## Context

Multiple external roots significantly increase configuration complexity and ambiguity in reconcile
and collision handling. MVP should be minimal and deterministic.

## Decision Drivers

- Keep configuration simple and discoverable
- Avoid ambiguous “which root owns this UUID?”
- Reduce collision/edge-case surface area
- Likely sufficient long-term

## Decision

Support exactly one configured External Root (absolute path).

## Alternatives Considered

### A. Multiple external roots
- Pros: Flexibility; per-project storage policies
- Cons: Complex config, reconcile ambiguity, more support burden
- Why rejected: Not worth complexity for MVP (and likely ever)

### B. Per-note root in frontmatter
- Pros: Portable per-note configuration
- Cons: Harder to manage; increases drift and confusion
- Why rejected: Encourages fragmented config; complicates tooling

## Consequences

### Positive
- Deterministic behavior
- Simple settings UI

### Negative / Trade-offs
- Users needing multiple roots must manage it outside the plugin

## Non-Goals

- Per-note external root selection

## Future Considerations

If multi-root is ever revisited, it must include a clear precedence model and robust conflict tools.
