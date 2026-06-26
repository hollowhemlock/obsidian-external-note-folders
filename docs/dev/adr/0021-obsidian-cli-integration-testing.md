---
status: "Accepted"
date: "2026-06-11"
decision-makers: "Maintainers"
---

# Add a Non-Required Obsidian CLI Integration Test Lane

## Context and Problem Statement

Unit and adapter tests cover internal logic, but they do not verify behavior through the real
Obsidian runtime surface. Obsidian CLI enables command-level integration checks against a live vault
when Obsidian 1.12.7 or newer is installed, CLI support is enabled, and the Obsidian app/runtime is
available.

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
- The primary Git checkout owns the integration sandbox and Obsidian runtime; worktrees are limited
  to headless validation
- This restriction keeps the GUI integration vault at one stable absolute path. Obsidian's URI
  handler only opens vault paths present in its global vault registry; each worktree has a different
  absolute path and would require separate registration. A single registered primary-checkout vault
  avoids registry mutation, ambiguous runtime targeting, and stale worktree registrations.
- Integration setup must:
  - build plugin artifacts
  - fully reset the sandbox from committed fixtures
  - install plugin artifacts into sandbox `.obsidian/plugins/<plugin-id>`
  - verify that the CLI reports Obsidian 1.12.7 or newer
  - open the sandbox vault when no CLI runtime is available
  - reload Obsidian with the sandbox vault as the CLI target
  - probe the live runtime and confirm it is serving the sandbox vault before tests run
- Integration tests must assert CLI command exposure when the CLI runtime responds
- Integration tests should prefer committed scenario fixtures when directory shape is the behavior
  being validated; runtime-created files are still appropriate for temporary, generated test cases
  where the directory shape itself is not the behavior under test
- If no Obsidian CLI binary is found, the integration lane fails because the required integration
  dependency is not installed
- If the CLI binary exists but the command-line interface is disabled, reload fails, or the runtime
  times out, `npm run test:integration` fails because the integration runtime was not actually
  exercised
- CLI integration requires Obsidian 1.12.7 or newer
- The CLI and desktop GUI must run in the same operating-system environment because CLI commands
  use local IPC to the desktop process
- On Windows, CLI execution uses the `Obsidian.com` redirector installed and registered by the
  current Obsidian installer, not `Obsidian.exe`
- WSL cannot use its Linux CLI to control the Windows Obsidian process. Running integration from
  WSL requires a separate Linux Obsidian 1.12.7+ installation running through WSLg or an X server,
  with the CLI enabled in that Linux installation.
- CI integration job is `workflow_dispatch` only and runs on `self-hosted` runners labeled `obsidian-cli`
- Do not make the integration job a required pull request status check unless an online matching runner is available

## Required Behavior

- `npm run test:integration` builds plugin artifacts before invoking Obsidian CLI.
- `npm run test:integration` fully resets the sandbox vault from committed fixtures.
- `npm run test:integration` installs artifacts into `.obsidian/plugins/<plugin-id>`.
- `npm run test:integration` rejects Obsidian versions older than 1.12.7.
- `npm run test:integration` reloads Obsidian after plugin installation.
- `npm run test:integration` preparation probes the live runtime and fails before tests run when the
  Obsidian runtime is unavailable or when the active vault is not the sandbox vault, so the lane
  never reports against a missing runtime or the wrong vault.
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
- WSL runners require a separate Linux GUI installation and cannot reuse a Windows Obsidian runtime
- GUI integration cannot run directly from linked worktrees; changes must use headless validation
  there and run Obsidian runtime testing from the primary checkout
- Manual GitHub runs stay queued until a matching `self-hosted` + `obsidian-cli` runner is online
- Integration lane is slower than unit-only CI
- The version command is a prerequisite check only; command-surface assertions remain the runtime
  readiness and plugin-wiring invariant

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
