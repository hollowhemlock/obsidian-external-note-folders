# Test Fixtures

- `fixture`: committed baseline test data.
  - `fixture/vault`: baseline Obsidian vault.
  - `fixture/external-root`: baseline external root.
  - `fixture/expected`: committed expected semantic definitions for fixture scenarios.
- `fixture/vault/Smoke Test.md`: concise manual smoke test note copied into sandbox vaults.
- `sandbox`: disposable working copy (ignored in git except `.gitkeep`).
  - `sandbox/vault`: runtime vault copy.
  - `sandbox/external-root`: runtime external-root copy.

## Scenario Naming

Fixture scenarios should be named by behavior and expected state, not by PR number, issue number,
or implementation detail.

Use this convention:

- Put formal semantic scenario data under `fixture/vault/<domain>/<scenario-slug>` and
  `fixture/external-root/<domain>/<scenario-slug>`, with expected JSON under
  `fixture/expected/<domain>/<scenario-slug>.json`.
- Workflow fixtures may intentionally place user-visible notes and folders under
  `fixture/vault/tests/<domain>/...` and `fixture/external-root/tests/<domain>/...` when the
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
runtime artifacts for debugging and are cleared by fixture refresh. They are not golden snapshots
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

Create fresh sandboxes for the current checkout and linked Git worktrees:

```powershell
npm run fixtures:new-sandboxes
```

Refresh sandbox content from fixture while preserving `sandbox/vault/.obsidian`:

```powershell
npm run fixtures:refresh-sandbox
```

Refresh sandbox content for the current checkout and linked Git worktrees:

```powershell
npm run fixtures:refresh-sandboxes
```

Print resolved fixture/sandbox absolute paths:

```powershell
npm run fixtures:paths
```

When the repository has multiple Git worktrees, this also lists any existing sibling worktree
sandbox vaults. Dev build/install scripts update those sandboxes in addition to the current
checkout's sandbox.

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
- Tests should assert against fixture-defined expected state, not accept a mutation result and then
  backfill that result as the expected shape.
- If behavior can be tested without Obsidian, prefer a semantic test under `test/semantic`. Use
  Obsidian CLI integration only for runtime behavior.
- On Windows, CLI tests use `Obsidian.com` (not `Obsidian.exe`). The integration lane fails unless
  an Obsidian CLI binary is installed, Obsidian is running, and the command line interface is enabled
  in Obsidian Settings -> General.
