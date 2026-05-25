# Testing Strategy

This directory contains durable testing guidance for the plugin. It complements ADRs and test-local
READMEs:

- ADRs explain why the project uses a testing boundary.
- This directory explains what behavior needs coverage and how to reason about coverage gaps.
- `test/**/README.md` files explain local fixture and harness mechanics.

## Canonical References

- [External Folder State Matrix](external-folder-state-matrix.md): living inventory of vault,
  external-root, marker, ignore, journal, and command states that tests should cover.
- [External Folder State Coverage](external-folder-state-coverage.json): machine-readable ledger of
  matrix states that are covered by committed scenarios or intentionally planned for future
  scenarios.
- [ADR-0028](../adr/0028-core-fixture-semantics-with-cli-smoke.md): decision to use core fixture
  semantic tests with Obsidian CLI smoke and adapter tests.

## Policy

External-folder behavior is not self-evident from individual tests because the real-world state
space combines vault frontmatter, external marker files, ignored/skipped directories, broad roots,
legacy marker migration, and partial failures.

When adding or changing behavior:

- Check the state matrix for existing coverage expectations.
- Prefer semantic tests for report/plan classification when Obsidian is not required.
- Use Obsidian CLI integration tests for command wiring, settings interpretation, modals,
  scanner-fidelity checks, and selected mutation post-state checks.
- Add or update fixture scenarios before accepting mutation output as the target shape.
- Treat generated reports as debugging artifacts, not golden snapshots.

## Maintenance

The external-folder state matrix is a living reference. Update it when:

- a command is added, removed, or changes behavior;
- marker formats or migration rules change;
- journal/resume semantics change;
- ignore, skipped-directory, symlink, or path-identity policy changes;
- a bug reveals a real-world state not represented in the matrix;
- a fixture scenario intentionally changes expected coverage.

When adding a new semantic or integration fixture, check whether the matrix already names the state.
If not, update the matrix in the same PR or explicitly document why the state is out of scope. If
the fixture covers an existing state, update the coverage ledger so `npm run test` can verify that
matrix coverage stays explicit.
