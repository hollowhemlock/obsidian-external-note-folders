# ADR-0018: Test Vault and External-Root Fixtures Live In-Repo

**Status:** Proposed
**Date:** 2026-02-20
**Participants:** Maintainers

## Context

Reconcile and marker behavior depend on realistic vault/external-root directory shapes. Ad hoc local
fixtures make failures hard to reproduce across developers and CI. The repository already includes
sample test directories under `test/`, but fixture policy and lifecycle are not yet defined.

## Decision Drivers

- Keep integration tests reproducible across machines and CI
- Make complex filesystem scenarios explicit and reviewable in pull requests
- Avoid hidden local setup requirements
- Preserve fast fixture updates for new edge cases and bug regressions

## Decision

Store canonical test fixture vaults and external roots in the repository under `test/fixtures/`,
with this policy:

- Fixtures are version-controlled and named by scenario intent, not by ticket number alone
- Each fixture scenario includes:
  - vault tree
  - external-root tree
  - minimal metadata describing expected outcomes
- Tests copy fixtures to a temporary working directory before mutation; tests never mutate tracked
  fixture files in place
- Add a focused fixture per bug class when behavior depends on directory shape or marker content
- Keep fixtures minimal: only files needed to express scenario semantics

Large/binary fixture policy:

- Prefer text fixtures
- Avoid large binaries in git history unless required by a concrete test case

## Alternatives Considered

### A. Generate all fixtures at runtime in test code
- Pros: Fewer tracked files; easier bulk refactors
- Cons: Scenario intent becomes implicit in setup code; harder review/debug of filesystem topology
- Why rejected/accepted: Rejected as sole approach; runtime generation may still be used for trivial cases

### B. Developer-local fixture directories outside repo
- Pros: Flexible local experimentation
- Cons: Non-reproducible failures; CI drift; onboarding friction
- Why rejected/accepted: Rejected for shared reliability

## Consequences

### Positive
- Reproducible integration behavior across contributors and CI
- Easier code review for edge-case additions and regression coverage

### Neutral
- Repository includes additional fixture directories and maintenance conventions

### Negative / Trade-offs
- Fixture sprawl risk if scenarios are not curated
- Periodic cleanup and naming discipline required

## Non-Goals

- Capturing full real user vaults in the repository
- Creating exhaustive fixtures for every possible OS/filesystem combination

## Future Considerations

If fixture count grows, introduce a manifest index and validation script to detect orphaned scenarios
and enforce naming/metadata standards.

## References

- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0011](0011-reconcile-execution-safety-model.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [ADR-0017](0017-testing-strategy-by-boundary.md)
