---
status: "Accepted"
date: "2026-05-21"
decision-makers: "Maintainers"
---

# Core Fixture Semantics with Obsidian CLI Smoke Integration

## Context and Problem Statement

External-note-folder behavior has safety-critical classification rules for drift, adoption,
reconcile, marker migration, ignored paths, and mutation preflight. Testing those semantics only
through Obsidian CLI makes the oracle depend on a live runtime, modal text, and machine-specific
settings. Testing only pure functions without committed fixture worlds misses realistic vault and
external-root shapes.

The project needs a boundary where semantic correctness is deterministic and Obsidian-independent,
while still preserving runtime smoke coverage for the real plugin command surface.

## Decision Drivers

- Keep semantic correctness independent of Obsidian runtime availability and modal formatting
- Use committed fixture vault and external-root shapes as reviewable test inputs
- Prevent expected JSON from becoming an unreviewed generated golden file
- Preserve real Obsidian CLI coverage for command registration, settings, modals, and selected
  mutation behavior
- Keep default validation runnable without Obsidian installed
- Maintain a durable external-folder state matrix so combinatorial vault/external-root states are
  stated explicitly instead of inferred from scattered tests

## Considered Options

* Full Obsidian CLI semantic oracle
* Core fixture semantic tests plus Obsidian CLI smoke tests
* Unit tests only

## Decision Outcome

Chosen option: "Core fixture semantic tests plus Obsidian CLI smoke tests", because it keeps the
core report/plan oracle deterministic while still exercising the real Obsidian command adapter.

Core semantic tests are canonical for report and plan correctness. They read committed fixture
inputs, build production scan-result models, call pure core builders such as `buildDriftReport`,
and compare the resulting semantic model to strict expected JSON.

Obsidian CLI integration tests are smoke/adapter tests. They verify command registration, settings
interpretation, modal availability, copyable report presence, and selected mutation post-state. They
also verify scanner fidelity between Obsidian-backed scans and fixture adapters. They must not parse
full modal markdown as the canonical semantic oracle.

The project also maintains a living external-folder state matrix as testing documentation. The
matrix is not an ADR and does not define product behavior, but it records the vault, external-root,
marker, ignore, and journal states that should be represented by semantic fixtures, integration
smoke tests, mutation tests, or explicit non-goals.

### Consequences

### Positive
- Core classification regressions can fail in normal `npm run test` without Obsidian installed
- Modal wording and formatting changes do not break semantic correctness tests
- Fixture expectations are reviewable and machine-independent
- Obsidian CLI coverage remains focused on the runtime behaviors only Obsidian can validate

### Neutral
- Test fixtures now include committed input trees and committed expected JSON
- Expected JSON needs strict validation and human review
- Some CLI tests still need a prepared Obsidian runtime
- The external-folder state matrix needs periodic updates when new commands, marker formats, or
  filesystem states become relevant

### Negative / Trade-offs
- A thin fixture vault scanner is required to adapt Markdown fixtures into `VaultScanResult`
- The fixture scanner must keep reusing production parsing helpers; duplicating semantics would
  weaken this boundary
- Existing string-only errors and warnings are asserted as normalized strings until the production
  model exposes structured codes

### Confirmation

- Semantic tests live under `test/semantic/**/*.semantic.test.ts`
- CLI integration tests live under `test/integration/**/*.integration.test.ts`
- Fixture helpers live under `test/support/fixtures`
- CLI/report helpers live under `test/support/integration`
- Expected JSON uses `schemaVersion`, domain/scenario metadata, relative slash-normalized paths,
  strict row schemas, duplicate-row rejection, and summary-count cross-checks
- Observed modal reports are written only as sandbox debug artifacts
- Scanner-fidelity integration tests compare production Obsidian scan results with fixture-adapter
  scan results for committed fixture scenarios
- The external-folder state matrix lives in `docs/dev/testing/external-folder-state-matrix.md`

## Pros and Cons of the Options

### Full Obsidian CLI semantic oracle

- Pros: Exercises the real command path end-to-end
- Pros: Captures UI-visible regressions
- Cons: Couples semantic correctness to runtime availability, modal text, and local settings
- Cons: Encourages brittle modal parsing or golden snapshots
- Why rejected: Too fragile for the core safety oracle

### Core fixture semantic tests plus Obsidian CLI smoke tests

- Pros: Keeps semantics deterministic and Obsidian-independent
- Pros: Preserves runtime confidence where Obsidian actually matters
- Pros: Scales across drift, adoption, reconcile, verify, marker migration, and open recovery
- Cons: Requires fixture scanner discipline and expected JSON validation
- Why accepted: Best fit for a safety-critical plugin with broad filesystem roots

### Unit tests only

- Pros: Fastest and simplest local feedback
- Cons: Does not validate committed fixture worlds or real Obsidian command wiring
- Why rejected: Insufficient coverage for realistic external-root workflows

## More Information

### Expected JSON Review Rule

Observed semantic JSON may be used as a drafting aid, but expected JSON is not canonical until each
row and count has been reviewed against the committed fixture files. Do not blindly promote
observed output to expected output.

### Fixture Scanner Rule

Fixture scanners are adapters, not alternate semantic implementations. They may read committed
Markdown files and produce production DTOs, but they must not classify drift, derive reconcile
actions, interpret ignore rules beyond scan-result construction, or duplicate core planner logic.

### Error and Warning Debt

Phase 1 allows exact normalized error/warning strings because current report models expose strings.
If the production model later adds stable structured issue codes, semantic expectations should use
those codes and treat message text as user-facing detail.

### References

- [ADR-0016](0016-layered-architecture-core-vs-obsidian-adapter.md)
- [ADR-0017](0017-testing-strategy-by-boundary.md)
- [ADR-0018](0018-test-vault-fixtures-live-in-repo.md)
- [ADR-0021](0021-obsidian-cli-integration-testing.md)
- [External folder state matrix](../testing/external-folder-state-matrix.md)
- [test/fixtures/README.md](../../../test/fixtures/README.md)
- [test/semantic/README.md](../../../test/semantic/README.md)
- [test/integration/README.md](../../../test/integration/README.md)
