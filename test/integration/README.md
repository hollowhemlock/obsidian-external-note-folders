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

The lane requires Obsidian 1.12.7 or newer with its CLI installed and enabled. Integration
preparation builds the plugin, fully resets the sandbox, installs the plugin artifacts, verifies the
Obsidian version, and reloads Obsidian with the sandbox vault as the CLI target before tests run. If
no CLI runtime is available, preparation opens the sandbox vault before retrying reload.

Preparation then probes the live runtime through the Obsidian CLI and fails before any test runs if
the runtime is unavailable or the active vault is not the sandbox vault, so the lane never reports
results against a missing runtime or the wrong vault.

The CLI and desktop app must run in the same operating-system environment because they communicate
through local IPC. Windows runs use the registered `Obsidian.com` redirector. WSL cannot drive the
Windows Obsidian process; a WSL runner requires a separate Linux Obsidian 1.12.7+ GUI running
through WSLg or an X server, with its Linux CLI enabled.

The primary Git checkout owns the integration sandbox and Obsidian runtime. Worktrees may run
headless validation, but integration fails before build, sandbox mutation, plugin installation, or
Obsidian control.
