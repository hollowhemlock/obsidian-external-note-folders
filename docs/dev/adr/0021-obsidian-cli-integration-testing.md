# ADR-0021: Require Obsidian CLI Integration Testing (v1.12+)

**Status:** Accepted
**Date:** 2026-03-03
**Participants:** Maintainers

## Context

Unit and adapter tests cover internal logic, but they do not verify behavior through the real Obsidian runtime surface. Obsidian v1.12 introduced a CLI interface that enables command-level integration checks against a live vault.

This project needs an integration requirement that validates plugin behavior with real vault fixtures and real Obsidian command execution, while keeping standard CI fast and deterministic.

## Decision Drivers

- Validate behavior through actual Obsidian CLI execution, not mocks only
- Reuse committed fixture topology for reproducibility
- Keep default PR CI fast (unit/lint lane separate from integration lane)
- Support both human maintainers and LLM agents with explicit, repeatable workflow
- Avoid coupling integration test pass/fail to machines without Obsidian CLI installed

## Decision

Adopt a dedicated **Obsidian CLI integration test lane** with these constraints:

- Integration tests live under `test/integration/**/*.integration.test.ts`
- Integration tests run via `npm run test:integration`
- Integration setup must:
  - refresh sandbox from committed fixture
  - build plugin artifacts
  - install plugin artifacts into sandbox `.obsidian/plugins/<plugin-id>`
- Integration tests must assert CLI runtime is Obsidian `>=1.12.0`
- On Windows, CLI execution uses `Obsidian.com` (not `Obsidian.exe`) when available
- CI integration job runs on `self-hosted` runners labeled `obsidian-cli`

## Alternatives Considered

### A. Unit tests only
- Pros: Fast and simple
- Cons: No verification of runtime CLI behavior
- Why rejected: Does not satisfy integration requirement

### B. Run CLI integration tests in default CI on hosted runners
- Pros: Single CI lane
- Cons: Hosted runners may not provide configured Obsidian CLI runtime
- Why rejected: Unreliable and environment-dependent

### C. Mock the CLI process
- Pros: Fully deterministic in any environment
- Cons: Does not validate actual Obsidian runtime semantics
- Why rejected: Misses the key requirement of real integration coverage

## Consequences

### Positive
- Real command-path validation through Obsidian CLI
- Stronger confidence before release for vault-level workflows

### Neutral
- Adds maintenance for integration scripts/workflow/docs

### Negative / Trade-offs
- Requires prepared local or self-hosted environment with Obsidian CLI enabled
- Integration lane is slower than unit-only CI

## Non-Goals

- Replacing unit tests with integration tests
- Running CLI integration on every hosted CI environment

## Future Considerations

Expand integration coverage as domain commands are implemented (Assign UUID, Open External Folder, Verify, Reconcile), keeping fixture scenarios traceable to ADR invariants.

## References

- [ADR-0017](0017-testing-strategy-by-boundary.md)
- [ADR-0018](0018-test-vault-fixtures-live-in-repo.md)
- [test/fixtures/README.md](../../../test/fixtures/README.md)
