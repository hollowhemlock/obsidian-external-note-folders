---
status: "Accepted"
date: "2026-02-14"
decision-makers: "Maintainers"
---

# Single External Root

## Context and Problem Statement

Multiple external roots significantly increase configuration complexity and ambiguity in reconcile
and collision handling. MVP should be minimal and deterministic.

## Decision Drivers

- Keep configuration simple and discoverable
- Avoid ambiguous “which root owns this UUID?”
- Reduce collision/edge-case surface area
- Likely sufficient long-term

## Considered Options

* Multiple external roots
* Per-note root in frontmatter

## Decision Outcome

Support exactly one configured External Root (absolute path).

### Consequences

### Positive
- Deterministic behavior
- Simple settings UI

### Negative / Trade-offs
- Users needing multiple roots must manage it outside the plugin

## Pros and Cons of the Options

### Multiple external roots
- Pros: Flexibility; per-project storage policies
- Cons: Complex config, reconcile ambiguity, more support burden
- Why rejected: Not worth complexity for MVP (and likely ever)

### Per-note root in frontmatter
- Pros: Portable per-note configuration
- Cons: Harder to manage; increases drift and confusion
- Why rejected: Encourages fragmented config; complicates tooling

## More Information

### Non-Goals

- Per-note external root selection

### Future Considerations

If multi-root is ever revisited, it must include a clear precedence model and robust conflict tools.
