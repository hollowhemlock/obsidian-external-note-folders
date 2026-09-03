# Agent Instructions

Primary project guidance is centralized in [README.md](README.md).

## Project

External Note Folders is an Obsidian plugin that binds a markdown note to an
external folder by a UUID stored in both the note's `exnf` frontmatter and a
`<uuid>.exnf` marker file inside the folder. The vault is the source of truth;
the plugin never deletes vault files, external folders, or markers, and never
auto-renames to resolve conflicts.

Full product behavior, the command reference, the safety model, and the
ignore-pattern syntax live in [README.md](README.md). Do not duplicate those
details in agent guidance.

## Branch Workflow

- Develop routine changes on `dev`.
- Keep `main` as the release/integration branch.
- Merge `dev` to `main` only when changes are ready for integration or release.
- Do not retarget Release Please or release documentation away from `main`
  unless the repository release branch intentionally changes.

## Commands

- `npm run dev`: watch build into the dev sandbox vault via `scripts/dev.ts`.
- `npm run build` / `npm run build:clean`
- `npm run test`: unit and adapter tests; excludes `**/*.integration.test.ts`.
- Single test: `npx vitest run src/core/pathPolicy.test.ts`, or by name:
  `npx vitest run -t "<name>"`.
- `npm run test:watch`
- `npm run lint` / `npm run lint:fix` / `npm run format:check`
- `npm run test:integration`: requires the primary checkout, Obsidian CLI
  installed and enabled, and a running Obsidian runtime. It builds, fully resets
  fixtures, installs the plugin, reloads Obsidian, and runs an Obsidian-version
  preflight first.
- `npm run fixtures:new-sandbox`: fully reset the sandbox vault and external
  root from committed fixtures, then reload Obsidian and run the version
  preflight. Primary checkout only.

## Architecture

Layered, with a strict dependency rule from ADR-0016: `obsidian -> core`, never
`core -> obsidian`.

- `src/core/`: pure domain logic; no Obsidian imports and no filesystem IO.
  Owns path derivation, status classification, validation, and dry-run plan
  building. May use `node:path` and `node:crypto` for pure computation only.
- `src/storage/`: Node fs/process adapter for the external root, outside the
  vault. This is where real `node:fs` mutation happens.
- `src/obsidian/`: Obsidian API adapter for vault reads and writes:
  `scanVault` via `metadataCache`, and `assignUuidToNote` / `writeUuidToNote`
  via `fileManager`.
- `src/Plugin.ts`: orchestrator. Registers commands, owns the single-flight
  mutation lock and `mutationSequence`, and wires core plans to storage and
  Obsidian effects.
- `src/main.ts`: default-exports the plugin class only.
- UI lives in `*Modal.ts` classes plus `PluginSettings.ts` and
  `PluginSettingsTab.ts`.

### Mutating Commands

Adoption, reconcile, and marker migration follow this pattern:

1. Build a dry-run plan in `core`; the plan captures the current
   `mutationSequence`.
2. User confirms in a `*PlanModal`.
3. `runMutatingCommand` takes the single-flight lock. Execution rejects stale
   plans and reruns a preflight rescan before mutation.
4. The storage executor writes a per-row journal and stops on first failure. For
   adoption, write the marker file before note frontmatter.
5. Long scans run inside `withProgressModal`, which enforces a minimum visible
   duration via `core/progressTiming`.

## Conventions

- Relative imports use explicit `.ts` extensions.
- Tests are co-located `*.test.ts` next to source.
- Integration tests are `test/**/*.integration.test.ts`.
- Semantic fixture tests live in `test/semantic/` with expected JSON under
  `test/fixtures/fixture/expected/`.
- Behavior changes should trace to a product-intent principle, an ADR, or a
  state-matrix item.
- Agent autonomy and escalation boundaries are defined in
  `docs/dev/agent/autonomy-policy.md`.
- `docs/dev/adr/README.md` is generated. Edit ADR files or
  `scripts/update-adr-index.ts`, then run `npm run docs:adr:index`.
- Use `fix:`, not `bug:`, for bug fixes so Release Please can parse version
  impact correctly.
- Do not manually edit `package.json`, `manifest.json`, `CHANGELOG.md`, or
  `versions.json` for versioning in feature/fix PRs; Release Please owns those
  changes.
- Debug output is prefixed `[external-note-folders]` and uses `console.debug`.

For architecture and process details, use:

- `docs/dev/adr/README.md`
- `docs/dev/procedures/`
- `docs/dev/product/intent.md`
- `docs/dev/agent/autonomy-policy.md`
- Commit policy and local hook behavior: `README.md` -> Contributor Guide -> Commit conventions / Local git hooks
- PR review comment handling and thread resolution policy:
  `docs/dev/procedures/commit-pull-request-merge-review-gate.md` -> Stage 2 -> Review Thread Resolution
