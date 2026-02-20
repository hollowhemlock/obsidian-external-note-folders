# ADR-0019: Vitest as Test Runner

**Status:** Accepted
**Date:** 2026-02-20
**Participants:** Maintainers

## Context

ADR-0017 defines a boundary-aligned testing strategy but does not prescribe a test runner. The project needs a framework that supports the ESM + TypeScript stack, runs fast, and requires minimal configuration.

## Decision Drivers

- Native ESM support (project uses `"type": "module"`)
- Native TypeScript support without a separate compile step
- Fast startup and execution for tight feedback loops during development
- Watch mode for iterative development
- Minimal configuration to get started

## Decision

Use **Vitest** as the test runner for all test layers (unit, adapter, integration).

Configuration choices:

- **Co-located tests**: Test files live beside their source as `*.test.ts` (e.g., `src/core/foo.ts` → `src/core/foo.test.ts`). This keeps tests visible alongside the code they exercise.
- **Excluded paths**: `node_modules`, `dist`, `test/fixtures` are excluded from test discovery. Fixtures are test data, not executable tests.
- **No coverage config yet**: Coverage tooling will be added when there is enough code to make thresholds meaningful.

## Alternatives Considered

### A. Jest
- Pros: Widely adopted, large ecosystem
- Cons: Requires transform config for ESM + TypeScript; slower startup; CJS-first design
- Why rejected: Extra configuration burden for ESM projects; Vitest is a drop-in replacement with better DX

### B. Node.js built-in test runner (`node:test`)
- Pros: Zero dependencies
- Cons: Less mature ecosystem; no built-in watch mode (at time of evaluation); weaker TypeScript integration
- Why rejected: Not ergonomic enough for a project already using a bundler-friendly stack

## Consequences

### Positive
- Tests run with zero transform overhead — Vitest understands TypeScript and ESM natively
- Watch mode enables rapid iteration during development
- Co-located tests make missing coverage immediately visible in the file tree

### Neutral
- Adds `vitest` as a dev dependency (~27 packages)

### Negative / Trade-offs
- Vitest is younger than Jest; ecosystem plugins are less numerous (acceptable for this project's needs)

## Non-Goals

- Coverage thresholds or reporting (deferred)
- Browser-environment testing (not needed for core/adapter layers)

## Future Considerations

If integration tests grow to require Obsidian API mocking at scale, evaluate whether Vitest's `vi.mock` is sufficient or whether a dedicated test-double library is warranted.

## References

- [ADR-0016](0016-layered-architecture-core-vs-obsidian-adapter.md)
- [ADR-0017](0017-testing-strategy-by-boundary.md)
- [ADR-0018](0018-test-vault-fixtures-live-in-repo.md)
