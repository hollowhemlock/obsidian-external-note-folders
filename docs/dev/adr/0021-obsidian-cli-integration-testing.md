---
status: "Accepted"
date: "2026-03-03"
decision-makers: "Maintainers"
---

# Add a Non-Required Obsidian CLI Integration Test Lane

## Context and Problem Statement

Unit and adapter tests cover internal logic, but they do not verify behavior through the real Obsidian runtime surface. Obsidian CLI enables command-level integration checks against a live vault when an Obsidian 1.12-series installer is present, CLI support is enabled, and the Obsidian app/runtime is available.

This project needs an integration requirement that validates plugin behavior with real vault fixtures and real Obsidian command execution, while keeping standard CI fast and deterministic.

## Decision Drivers

- Validate behavior through actual Obsidian CLI execution, not mocks only
- Reuse committed fixture topology for reproducibility
- Keep default PR CI fast (unit/lint lane separate from integration lane)
- Support both human maintainers and LLM agents with explicit, repeatable workflow
- Fail clearly when Obsidian CLI is not installed or the Obsidian runtime is unavailable
- Avoid coupling default PR validation to machines without an interactive Obsidian CLI environment

## Considered Options

* Unit tests only
* Run CLI integration tests in default CI on hosted runners
* Mock the CLI process
* Add a dedicated manual/local Obsidian CLI integration lane

## Decision Outcome

Adopt a dedicated **non-required Obsidian CLI integration test lane** with these constraints:

- Default validation (`npm run lint`, `npm run format:check`, `npm run test`, and build/release checks)
  does not invoke Obsidian CLI integration tests
- Integration tests live under `test/integration/**/*.integration.test.ts`
- Integration tests are organized by workflow/domain file, not as one monolithic CLI file:
  - shared process and sandbox helpers live in `test/integration/obsidianCliHarness.ts`
  - workflow tests live in `test/integration/<domain>.integration.test.ts`
- Integration test files run serially because they share one sandbox vault, one external root, and one
  live Obsidian modal surface
- Integration tests run via `npm run test:integration`
- Integration setup must:
  - refresh sandbox from committed fixture
  - build plugin artifacts
  - install plugin artifacts into sandbox `.obsidian/plugins/<plugin-id>`
- Integration tests must assert CLI command exposure when the CLI runtime responds
- Integration tests should prefer committed scenario fixtures when directory shape is the behavior
  being validated; runtime-created files are still appropriate for temporary, generated test cases
  where the directory shape itself is not the behavior under test
- If no Obsidian CLI binary is found, the integration lane fails because the required integration
  dependency is not installed
- If the CLI binary exists but Obsidian is not running, the command-line interface is disabled, or
  the runtime times out, `npm run test:integration` fails because the integration runtime was not
  actually exercised
- On Windows, CLI execution uses `Obsidian.com` (not `Obsidian.exe`) when available
- CI integration job is `workflow_dispatch` only and runs on `self-hosted` runners labeled `obsidian-cli`
- Do not make the integration job a required pull request status check unless an online matching runner is available

## Required Behavior

- `npm run test:integration` refreshes the sandbox vault from committed fixtures.
- `npm run test:integration` builds plugin artifacts before invoking Obsidian CLI.
- `npm run test:integration` installs artifacts into `.obsidian/plugins/<plugin-id>`.
- `npm run test:integration` verifies that expected plugin commands are exposed through the
  Obsidian CLI command surface.
- Integration files run serially.
- The integration lane exits non-zero with clear command output when the CLI binary is missing, the
  Obsidian runtime is unavailable, CLI support is disabled, or the CLI command times out.

### Consequences

### Positive
- Real command-path validation through Obsidian CLI
- Stronger confidence before release for vault-level workflows when a prepared runner or local environment is available

### Neutral
- Adds maintenance for integration scripts/workflow/docs

### Negative / Trade-offs
- Requires prepared local or self-hosted environment with Obsidian installed and the CLI enabled
- Manual GitHub runs stay queued until a matching `self-hosted` + `obsidian-cli` runner is online
- Integration lane is slower than unit-only CI
- Some Obsidian CLI builds do not expose a stable `version` command, so version assertions are
  weaker than command-surface assertions

## Pros and Cons of the Options

### Unit tests only
- Pros: Fast and simple
- Cons: No verification of runtime CLI behavior
- Why rejected: Does not satisfy integration requirement

### Run CLI integration tests in default CI on hosted runners
- Pros: Single CI lane
- Cons: Hosted runners may not provide configured Obsidian CLI runtime
- Why rejected: Unreliable and environment-dependent

### Mock the CLI process
- Pros: Fully deterministic in any environment
- Cons: Does not validate actual Obsidian runtime semantics
- Why rejected: Misses the key requirement of real integration coverage

### Add a dedicated manual/local Obsidian CLI integration lane
- Pros: Validates real Obsidian runtime behavior without slowing or destabilizing default PR checks
- Cons: Requires a prepared interactive local or self-hosted runner environment
- Why accepted: Provides the runtime coverage this project needs while keeping default validation deterministic

## More Information

### Non-Goals

- Replacing unit tests with integration tests
- Running CLI integration on every hosted CI environment

### Future Considerations

Expand integration coverage as domain commands are implemented (Assign UUID, Open External Folder, Verify, Reconcile), keeping fixture scenarios traceable to ADR invariants and grouped by workflow.

### References

- [ADR-0017](0017-testing-strategy-by-boundary.md)
- [ADR-0018](0018-test-vault-fixtures-live-in-repo.md)
- [test/fixtures/README.md](../../../test/fixtures/README.md)
- [Obsidian CLI documentation](https://obsidian.md/help/cli)
