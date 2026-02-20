# ADR-0014: `.exf` Marker Format and Validation Contract

**Status:** Accepted
**Date:** 2026-02-19
**Participants:** Maintainers

## Context

Bound-folder identity depends on `.exf` markers. Loosely defined marker parsing can produce drift,
ambiguous UUID interpretation, and silent mismatches across editors/platforms.

## Decision Drivers

- Preserve reliable UUID identity mapping
- Prevent silent acceptance of malformed markers
- Enable forward-compatible marker evolution
- Keep Verify/Reconcile error semantics clear

## Decision

Define a strict, versioned marker contract for `.exf`.

- MVP marker payload is exactly one UUID string (canonical lowercase RFC 4122 format).
- Encoding is UTF-8 (no BOM).
- Newline policy:
  - writer emits trailing newline (`\\n`)
  - parser accepts one optional trailing newline
- Parser behavior:
  - trim only a single final `\n` line ending
  - `\r\n` and `\r` line endings are parse failures; only `\n` is accepted
  - reject extra content, extra lines, BOM, or non-canonical UUID format
- Any parse failure is `Error` and blocks mutation operations.
- Marker schema versioning:
  - current implicit schema is `v1` (single UUID line)
  - future schema changes require explicit migration handling ADR/update

## Alternatives Considered

### A. Permissive parser (trim-all, accept near matches)
- Pros: More tolerant of manual edits
- Cons: Silent divergence and hard-to-debug identity errors
- Why rejected/accepted: Rejected; safety requires strictness

### B. JSON marker format in MVP
- Pros: Explicit schema extensibility
- Cons: Higher verbosity and migration cost now
- Why rejected/accepted: Rejected for MVP simplicity; keep strict single-line format first

## Consequences

### Positive
- Deterministic parse/write behavior across environments
- Clear integrity failures instead of silent coercion

### Neutral
- Manual `.exf` edits become less forgiving but more predictable

### Negative / Trade-offs
- Requires explicit migration if marker format evolves
- Slightly more user-facing errors for malformed files

## Non-Goals

- Supporting arbitrary user-authored marker variants
- Backward compatibility with undocumented legacy marker encodings

## Future Considerations

If richer marker metadata is added later, introduce explicit `v2` format with one-way migration tooling
and a clear coexistence policy during transition.

## References

- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0007](0007-uuid-regeneration-and-manual-edits.md)
- [ADR-0009](0009-status-model.md)
