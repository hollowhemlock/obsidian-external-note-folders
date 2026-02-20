# ADR-0017: Testing Strategy by Boundary (Core, Adapter, Integration)

**Status:** Proposed
**Date:** 2026-02-20
**Participants:** Maintainers

## Context

The plugin has safety-critical behavior around scan/reconcile planning and filesystem mutation.
Testing only through manual Obsidian runs is too slow and too fragile, while testing only pure
functions misses adapter and runtime integration failures.

## Decision Drivers

- Catch safety regressions before runtime (especially mutation ordering and boundary checks)
- Keep fast feedback during development
- Verify adapter behavior without requiring full UI automation
- Ensure deterministic test results across operating systems

## Decision

Adopt a boundary-aligned testing strategy:

- Unit tests (`core`):
  - default test type
  - verify pure decision logic (status mapping, path derivation, collision detection, plan
    generation, mutation preconditions)
  - use fake/memory ports for filesystem/clock/id where possible
- Adapter tests (`obsidian` boundary):
  - verify request/response mapping between Obsidian objects and `core` DTOs
  - verify command-level behavior (serialization hooks, error handling, user-facing messages)
  - use minimal test doubles for Obsidian APIs
- Integration tests (filesystem + fixture vaults):
  - execute reconcile flows against on-disk fixtures
  - validate journaling, rollback/recovery expectations, and no-delete guarantees
  - keep scope focused on high-risk workflows

Coverage priorities:

- Prioritize invariants over line coverage percentage
- Every accepted ADR with executable behavior should have at least one direct test case
- Regression tests are mandatory for production bugs before fixes are merged

CI expectation:

- Unit + adapter tests run on every change
- Integration tests run in CI at least on mainline and pre-release workflows

## Alternatives Considered

### A. Integration-heavy strategy only
- Pros: Exercises realistic end-to-end behavior
- Cons: Slow, brittle, difficult to isolate failures
- Why rejected/accepted: Rejected as default strategy; kept for targeted high-risk flows

### B. Unit tests only
- Pros: Fast and easy to maintain
- Cons: Adapter regressions and runtime wiring errors can slip through
- Why rejected/accepted: Rejected due to incomplete risk coverage

## Consequences

### Positive
- Faster iteration with strong guardrails around core invariants
- Reduced chance of silent behavior drift between domain rules and plugin commands

### Neutral
- Test suite includes multiple layers and fixtures, requiring clear naming conventions

### Negative / Trade-offs
- Additional maintenance cost for test doubles and fixtures
- CI runtime increases as integration coverage grows

## Non-Goals

- Full UI/E2E automation of all Obsidian interactions
- Absolute line coverage targets as a quality gate

## Future Considerations

If test runtime grows materially, split integration suites by risk tier and run full matrix on
scheduled builds while preserving quick PR feedback on critical tests.

## References

- [ADR-0003](0003-no-deletions.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
- [ADR-0011](0011-reconcile-execution-safety-model.md)
- [ADR-0012](0012-command-serialization-and-concurrency.md)
- [ADR-0016](0016-layered-architecture-core-vs-obsidian-adapter.md)
