# Test Fixtures

- `fixture`: committed baseline test data.
  - `fixture/plugin-external-note-folders-fixture`: baseline Obsidian vault.
  - `fixture/external-root`: baseline external root.
  - `fixture/expected`: committed expected semantic definitions for fixture scenarios.
- `fixture/plugin-external-note-folders-fixture/Smoke Test.md`: concise manual smoke test note copied
  into sandbox vaults.
- `sandbox`: disposable working copy (ignored in git except `.gitkeep`).
  - `sandbox/plugin-external-note-folders-sandbox`: runtime vault copy.
  - `sandbox/external-root`: runtime external-root copy.

## Scenario Naming

Fixture scenarios should be named by behavior and expected state, not by PR number, issue number,
or implementation detail.

Use this convention:

- Put formal semantic scenario data under
  `fixture/plugin-external-note-folders-fixture/<domain>/<scenario-slug>` and
  `fixture/external-root/<domain>/<scenario-slug>`, with expected JSON under
  `fixture/expected/<domain>/<scenario-slug>.json`.
- Workflow fixtures may intentionally place user-visible notes and folders under
  `fixture/plugin-external-note-folders-fixture/tests/<domain>/...` and
  `fixture/external-root/tests/<domain>/...` when the
  command behavior should report those paths.
- Use lowercase kebab-case for `<domain>` and `<scenario-slug>`.
- Prefer action-oriented slugs such as `adopt-exnf-from-plain-note` or
  `adopt-exnf-from-folder-note`.
- For a plain-note workflow fixture, use `tests/<domain>/<scenario-slug>.md` in the vault and
  `tests/<domain>/<scenario-slug>/` in the external root.
- For a folder-note workflow fixture, use `tests/<domain>/<scenario-slug>/<scenario-slug>.md` in
  the vault and `tests/<domain>/<scenario-slug>/` in the external root.
- External-root folder paths should mirror the note-derived vault path. When external folder
  contents matter, name payload files from the external-folder perspective, such as
  `external-folder-content.txt`, instead of from the test scenario perspective.
- When a command mutates sandbox state, define the expected target shape under
  `fixture/expected/<domain>/<scenario>.json` before writing or updating the test.
- Use `.gitkeep` only for structural empty directories whose contents do not affect behavior.
- Keep scenario names stable after tests reference them; add a new scenario instead of repurposing
  an old one for different behavior.

Semantic tests should follow the same domain naming. Put core semantic tests in
`test/semantic/<domain>.semantic.test.ts`, reusable fixture helpers in `test/support/fixtures`, and
expected JSON under `fixture/expected/<domain>/<scenario>.json`.

Integration tests should follow the same domain naming. Put shared Obsidian CLI helpers in
`test/integration/obsidianCliHarness.ts`, integration-only helpers in `test/support/integration`,
and workflow tests in `test/integration/<domain>.integration.test.ts`.

Integration tests may write observed command reports to `sandbox/reports/<domain>/`. These files are
runtime artifacts for debugging and are cleared by sandbox reset. They are not golden snapshots
or the canonical semantic oracle.

## Expected JSON

Expected JSON is canonical only after review against the committed fixture world.

- Use `schemaVersion`, `domain`, and `scenario` metadata.
- Keep paths slash-normalized and relative to the fixture vault or external root.
- Reject absolute paths and backslashes.
- Treat row arrays as unordered sets unless a scenario explicitly tests ordering.
- Cross-check summary counts against detailed rows.
- Do not blindly promote generated observed output to expected output.

Use [the external-folder state matrix](../../docs/dev/testing/external-folder-state-matrix.md) when
choosing or reviewing fixture scenarios. The matrix records the real-world vault, external-root,
marker, ignore, and journal states that tests should cover.

## Commands

Create a fresh sandbox from fixture:

```powershell
npm run fixtures:new-sandbox
```

This fully replaces the sandbox vault and external root, opens the sandbox vault if no CLI runtime
is available, then runs `obsidian reload` with the sandbox vault as the working directory. If
Windows reports a persistent lock, close Obsidian and run the command again.

Run all sandbox and integration commands from the primary Git checkout. Linked worktrees fail before
sandbox access or Obsidian control.

Open the sandbox or fixture vault in Obsidian:

```powershell
npm run vault:open -- sandbox
npm run vault:open -- fixture
```

Open any vault path in Obsidian:

```powershell
npm run vault:open -- test/fixtures/sandbox/plugin-external-note-folders-sandbox
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

- `scripts/fixtures.ts` retains `--content-only` and `--print-paths` for maintenance and
  diagnostics from the primary checkout. These flags are intentionally not exposed as routine npm
  commands.
- Tests/scripts should mutate sandbox paths, not fixture paths.
- Tests should assert against fixture-defined expected state, not accept a mutation result and then
  backfill that result as the expected shape.
- If behavior can be tested without Obsidian, prefer a semantic test under `test/semantic`. Use
  Obsidian CLI integration only for runtime behavior.
- Obsidian CLI testing requires Obsidian 1.12.7 or newer.
- On Windows, CLI tests use the registered `Obsidian.com` redirector, not `Obsidian.exe`.
- WSL requires a separate Linux Obsidian GUI and Linux CLI in the WSL environment; it cannot attach
  to the Windows Obsidian process.
