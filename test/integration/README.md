# Obsidian CLI Integration Tests

Integration tests validate the real Obsidian runtime surface. They are smoke and adapter tests, not
the canonical oracle for core report or plan semantics.

Use integration tests for:

- command registration
- settings loading and interpretation
- modal availability
- copyable report presence
- scanner-fidelity checks between Obsidian-backed scans and fixture adapters
- selected mutation smoke and post-state checks
- behavior that specifically depends on Obsidian vault APIs

Do not parse full modal markdown as the semantic oracle. Core behavior belongs in
`test/semantic/**/*.semantic.test.ts`.

Use [the external-folder state matrix](../../docs/dev/testing/external-folder-state-matrix.md) to
decide when runtime coverage is needed for command wiring, settings, modals, scanner fidelity, or
mutation post-state checks.

Integration tests run with:

```powershell
npm run test:integration
```

The lane requires Obsidian CLI to be installed and enabled, and a running Obsidian runtime that can
attach to the sandbox vault.
