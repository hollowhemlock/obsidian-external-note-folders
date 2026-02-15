# ADR 0005: Bound Folders Are Defined by a Root Marker File (`.exf`)

**Status:** Accepted  
**Date:** 2026-02-14

## Context

External directories may contain arbitrary subfolders (repos, videos, assets). A folder without a
marker is not necessarily an orphan; it can be a container or part of another bound folder tree.
We need a precise definition for identity-bearing external folders.

## Decision Drivers

- Avoid false “orphan” classification
- Support nested/complex external directory structures safely
- Make scanning deterministic and simple
- Avoid path-only identity

## Decision

A folder is identity-bearing only if it contains `.exf` at its root (“bound folder”).

- The `.exf` file content is the UUID
- Scanning the external root is done by discovering `.exf` files (not by inspecting markerless dirs)
- Nested bound folders are allowed
- Markerless directories are treated as opaque containers unless they block a target path

## Alternatives Considered

### A. Path-only mapping (no marker)
- Pros: Simpler filesystem; no metadata files
- Cons: Ambiguous identity; harder integrity checks; fragile
- Why rejected: Reintroduces path identity and silent failure modes

### B. Marker at arbitrary depth
- Pros: Flexible placement
- Cons: Ambiguous root; harder scan semantics; more edge cases
- Why rejected: Too ambiguous; increases risk

## Consequences

### Positive
- Clear definition of what is bound vs unbound
- Reliable orphan detection (only for bound folders)
- Safe coexistence with arbitrary container folders

### Negative / Trade-offs
- Requires marker file management
- Users may see `.exf` in file explorer (benign)

## Non-Goals

- Treating markerless folders as “orphans” or disposable

## Future Considerations

If marker filename changes later, provide migration tooling; do not auto-delete legacy markers.
