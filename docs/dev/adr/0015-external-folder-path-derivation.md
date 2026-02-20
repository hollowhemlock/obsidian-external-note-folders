# ADR-0015: External Folder Path Derivation Rule

**Status:** Accepted
**Date:** 2026-02-19
**Participants:** Maintainers

## Context

Reconcile must compute a target external path for each note's bound folder. ADR-0006 states that
reconcile "moves existing bound folders to match current vault structure", but without a defined
derivation rule, "match vault structure" is ambiguous and implementations may diverge.

## Decision Drivers

- Reconcile target paths must be deterministic and unambiguous
- Human-readable external structure aids direct filesystem navigation
- Path collisions between notes must be detectable before any move is executed
- Must work correctly across Windows/macOS/Linux filesystems

## Decision

The external folder path for a note is derived from its vault-relative path with the `.md`
extension removed:

- Input: vault-relative note path (e.g., `Projects/Research/My Note.md`)
- Output: `{external_root}/Projects/Research/My Note/`
- Notes in the vault root derive to direct children of the external root
  (e.g., `README.md` → `{external_root}/README/`)
- Path components containing OS-invalid characters are sanitized by replacing each invalid
  character with `_` (invalid character sets are OS-specific; see ADR-0013)
- Derived paths are compared using the case-sensitivity policy from ADR-0013
- If two vault notes derive to the same external path, it is an `Error` (duplicate derived path
  collision) and blocks reconcile for the affected notes
- If the derived target path collides with an existing bound folder belonging to a different UUID,
  reconcile aborts for that move (per ADR-0009 and ADR-0011 Error semantics)

Reconcile uses the derived path as the target when moving bound folders. A note whose title or
containing vault folder has changed will produce a new derived path, making a move visible in the
dry-run output.

## Alternatives Considered

### A. Flat structure named by note title only

- Pros: Simple — always one directory level deep; no vault hierarchy to mirror
- Cons: Title-only collisions are common (same title in different vault folders); loses
  meaningful grouping that vault structure provides
- Why rejected: Collision rate unacceptable for any non-trivial vault

### B. UUID-named flat structure

- Pros: No collisions; no reconcile moves needed when notes are renamed or moved
- Cons: External root is opaque to direct filesystem navigation; contradicts the "match vault
  structure" framing of reconcile (ADR-0006)
- Why rejected: Defeats the purpose of human-readable external organization

### C. User-configurable derivation templates

- Pros: Maximum flexibility per vault or per-note
- Cons: Significant configuration complexity; unclear collision semantics for custom templates;
  harder to document and support
- Why rejected: Not MVP; adds configuration surface without demonstrated user demand

## Consequences

### Positive

- External structure mirrors vault hierarchy — intuitive to navigate directly in the OS
- Derivation is deterministic and independently testable
- Collisions are detectable as errors before any move is executed

### Neutral

- Users who reorganize vault folders will see pending folder moves in reconcile dry-run output,
  which is expected and informational

### Negative / Trade-offs

- Notes with OS-invalid characters in their paths require sanitization, which may produce
  unexpected external folder names
- Deep vault hierarchies produce deep external hierarchies (no flattening option in MVP)

## Non-Goals

- Customizable path derivation templates on a per-note or per-folder basis
- Automatic disambiguation suffixes for duplicate-name collisions

## Future Considerations

If a configurable derivation rule is added later, it must define collision semantics explicitly
and remain independent of the UUID identity mechanism (which lives in `.exf`, not the path).

## References

- [ADR-0004](0004-single-external-root.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
- [ADR-0009](0009-status-model.md)
- [ADR-0011](0011-reconcile-execution-safety-model.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
