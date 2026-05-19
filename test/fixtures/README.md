# Test Fixtures

- `fixture`: committed baseline test data.
  - `fixture/vault`: baseline Obsidian vault.
  - `fixture/external-root`: baseline external root.
- `fixture/vault/Smoke Test.md`: concise manual smoke test note copied into sandbox vaults.
- `sandbox`: disposable working copy (ignored in git except `.gitkeep`).
  - `sandbox/vault`: runtime vault copy.
  - `sandbox/external-root`: runtime external-root copy.

## Scenario Naming

Fixture scenarios should be named by behavior and expected state, not by PR number, issue number,
or implementation detail.

Use this convention:

- Put scenario data under `fixture/vault/tests/<domain>/<scenario-slug>` and
  `fixture/external-root/tests/<domain>/<scenario-slug>`.
- Use lowercase kebab-case for `<domain>` and `<scenario-slug>`.
- Prefer action-oriented slugs such as `adopt-exnf-from-plain-note` or
  `adopt-exnf-from-folder-note`.
- For a plain-note fixture, use `tests/<domain>/<scenario-slug>.md` in the vault and
  `tests/<domain>/<scenario-slug>/` in the external root.
- For a folder-note fixture, use `tests/<domain>/<scenario-slug>/<scenario-slug>.md` in the vault
  and `tests/<domain>/<scenario-slug>/` in the external root.
- When external folder contents matter, add a named text file such as
  `file-in-<scenario-slug>.txt` instead of using a placeholder.
- Use `.gitkeep` only for structural empty directories whose contents do not affect behavior.
- Keep scenario names stable after tests reference them; add a new scenario instead of repurposing
  an old one for different behavior.

Integration tests should follow the same domain naming. Put shared Obsidian CLI helpers in
`test/integration/obsidianCliHarness.ts`, and put workflow tests in
`test/integration/<domain>.integration.test.ts`.

## Commands

Create a fresh sandbox from fixture:

```powershell
npm run fixtures:new-sandbox
```

Refresh sandbox content from fixture while preserving `sandbox/vault/.obsidian`:

```powershell
npm run fixtures:refresh-sandbox
```

Print resolved fixture/sandbox absolute paths:

```powershell
npm run fixtures:paths
```

Open fixture vault in Obsidian:

```powershell
npm run fixtures:open-fixture
```

Open sandbox vault in Obsidian:

```powershell
npm run fixtures:open-sandbox
```

Open any vault path in Obsidian:

```powershell
npm run vault:open -- test/fixtures/sandbox/vault
```

Prepare and run Obsidian CLI integration tests:

```powershell
npm run test:integration
```

Run only the integration tests (assumes sandbox and plugin artifacts are already prepared):

```powershell
npm run test:integration:watch
```

## Notes

- `fixtures:refresh-sandbox` is useful during hot-reload sessions because it keeps the sandbox
  `.obsidian` state while restoring vault content and external-root content from fixture.
- Tests/scripts should mutate sandbox paths, not fixture paths.
- On Windows, CLI tests should use `Obsidian.com` (not `Obsidian.exe`) and require Command line interface
  to be enabled in Obsidian Settings -> General.
