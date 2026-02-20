# ADR-0016: Layered Architecture (Core Engine vs Obsidian Adapter)

**Status:** Proposed
**Date:** 2026-02-20
**Participants:** Maintainers

## Context

Current implementation work will span filesystem logic, reconcile planning, and Obsidian-specific
interaction (commands, UI, vault APIs). Without explicit layering, domain rules can drift into
plugin/UI code, reducing testability and increasing coupling to Obsidian runtime details.

## Decision Drivers

- Keep reconcile and path logic testable without launching Obsidian
- Minimize coupling between business rules and Obsidian APIs
- Make filesystem behavior explicit and mockable
- Enable safe future extension (CLI, batch tools, richer UI) without rewriting core logic

## Decision

Adopt a two-layer TypeScript architecture with explicit boundaries:

- `core` (platform/domain layer):
  - owns domain models, validation, status classification, scan/reconcile planning, and execution
    policies
  - depends only on TypeScript types and small interfaces (ports), not on Obsidian classes
  - expresses side effects through injected adapters (filesystem, clock, logger, id generator)
- `obsidian` (adapter layer):
  - maps Obsidian concepts (`TFile`, commands, setting tab, notices, modals) into `core` requests
    and maps `core` outputs into UI/reporting
  - is the only layer that imports `obsidian`
  - coordinates command serialization and plugin lifecycle around `core` operations

Filesystem integration follows the same boundary:

- Define a `FilesystemPort` in `core` for required operations
- Provide a Node/OS implementation in adapter/infrastructure code
- Keep path policy and safety checks in `core` rules (per ADR-0013), not spread across UI code

Dependency rule:

- Allowed: `obsidian -> core`
- Forbidden: `core -> obsidian`

## Alternatives Considered

### A. Keep logic directly inside Obsidian plugin classes
- Pros: Fewer files initially; fast prototype iteration
- Cons: Hard to unit test; high coupling; domain rules become implicit in UI flow
- Why rejected/accepted: Rejected due to long-term maintenance and safety risk

### B. Fully separate packages immediately (`packages/core`, `packages/plugin`)
- Pros: Strong compile-time boundary, clearer release artifacts
- Cons: Extra tooling and workspace complexity before MVP scope is stable
- Why rejected/accepted: Deferred; may be adopted later once boundaries settle

## Consequences

### Positive
- Most behavior can be tested in pure TypeScript unit tests
- Obsidian API churn has smaller blast radius
- Clearer ownership of domain invariants and safety policy

### Neutral
- Initial refactors may introduce additional adapter/mapper code

### Negative / Trade-offs
- More up-front structure and interface design work
- Some operations require explicit data mapping between layers

## Non-Goals

- Immediate monorepo/package split
- Designing a public SDK for third-party consumers

## Future Considerations

If split into multiple packages later, preserve current dependency rule and keep `core` free of
Obsidian imports. Add automated boundary checks (lint rule or import restriction) as structure
stabilizes.

## References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
- [ADR-0011](0011-reconcile-execution-safety-model.md)
- [ADR-0012](0012-command-serialization-and-concurrency.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
