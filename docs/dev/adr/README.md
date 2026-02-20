# Architecture Decision Records

## Procedures
- **[review-checklist.md](review-checklist.md)** — Use when reviewing an ADR before accepting it.
- **[0000-template.md](0000-template.md)** — Template for new ADRs.

## Records

- [ADR-0001](0001-vault-is-source-of-truth.md) - Vault is source of truth
- [ADR-0002](0002-missing-external-is-normal.md) - Missing external is normal (Unavailable)
- [ADR-0003](0003-no-deletions.md) - No deletions (trust boundary)
- [ADR-0004](0004-single-external-root.md) - Single external root
- [ADR-0005](0005-bound-folder-marker.md) - Bound folder marker (`.exf`)
- [ADR-0006](0006-reconcile-is-explicit.md) - Reconcile is explicit (dry-run default)
- [ADR-0007](0007-uuid-regeneration-and-manual-edits.md) - UUID regeneration & manual edits
- [ADR-0008](0008-no-reverse-reconciliation.md) - No reverse reconciliation (external never drives vault)
- [ADR-0009](0009-status-model.md) - Status model (OK / Unavailable / Warning / Error)
- [ADR-0010](0010-use-generator-obsidian-plugin.md) - Use generator-obsidian-plugin
- [ADR-0011](0011-reconcile-execution-safety-model.md) - Reconcile execution safety model (ordering, journal, recovery)
- [ADR-0012](0012-command-serialization-and-concurrency.md) - Command serialization and concurrency boundaries
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md) - Filesystem boundary and path identity policy
- [ADR-0014](0014-exf-marker-format-and-validation.md) - `.exf` marker format and validation contract
- [ADR-0015](0015-external-folder-path-derivation.md) - External folder path derivation rule
- [ADR-0016](0016-layered-architecture-core-vs-obsidian-adapter.md) - Layered architecture (core engine vs Obsidian adapter)
- [ADR-0017](0017-testing-strategy-by-boundary.md) - Testing strategy by boundary (core, adapter, integration)
- [ADR-0018](0018-test-vault-fixtures-live-in-repo.md) - Test vault and external-root fixtures live in-repo
- [ADR-0019](0019-vitest-as-test-runner.md) - Vitest as test runner
