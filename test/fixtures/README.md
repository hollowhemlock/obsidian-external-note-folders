# Test Fixtures

- `fixture`: committed baseline test data.
  - `fixture/vault`: baseline Obsidian vault.
  - `fixture/external-root`: baseline external root.
- `sandbox`: disposable working copy (ignored in git except `.gitkeep`).
  - `sandbox/vault`: runtime vault copy.
  - `sandbox/external-root`: runtime external-root copy.

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

## Notes

- `fixtures:refresh-sandbox` is useful during hot-reload sessions because it keeps the sandbox
  `.obsidian` state while restoring vault content and external-root content from fixture.
- Tests/scripts should mutate sandbox paths, not fixture paths.
