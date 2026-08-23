# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

External Note Folders is an Obsidian plugin that binds a markdown note to an external folder by a
UUID stored in both the note's `exnf` frontmatter and a `<uuid>.exnf` marker file inside the folder.
The vault is the source of truth; the plugin never deletes vault files, external folders, or markers,
and never auto-renames to resolve conflicts. Full product behavior, the six-command reference, the
safety model, and the ignore-pattern syntax live in [README.md](README.md) — do not duplicate them here.

## Commands

- `npm run dev` — watch build into the dev sandbox vault (`scripts/dev.ts`)
- `npm run build` / `npm run build:clean`
- `npm run test` — unit + adapter tests (Vitest; excludes `**/*.integration.test.ts`)
- `npm run test:watch`
- Single test: `npx vitest run src/core/pathPolicy.test.ts`, or by name: `npx vitest run -t "<name>"`
- `npm run lint` / `npm run lint:fix` / `npm run format:check`
- `npm run test:integration` — requires the primary checkout (not a linked worktree), Obsidian CLI
  installed and enabled, and a running Obsidian runtime; it builds, fully resets fixtures, installs
  the plugin, reloads Obsidian, and runs an Obsidian-version preflight (>= 1.12.7) first
- `npm run fixtures:new-sandbox` — fully reset the sandbox vault
  (`test/fixtures/sandbox/vault-plugin-external-note-folders-sandbox`) and external root
  (`test/fixtures/sandbox/external-root`) from committed fixtures, then reload Obsidian and run the
  version preflight (primary checkout only)

## Architecture

Layered, with a strict dependency rule (ADR-0016): `obsidian -> core`, never `core -> obsidian`.

- **`src/core/`** — pure domain logic; no Obsidian imports and no filesystem IO. Owns path
  derivation, status classification, validation, and dry-run plan building (`buildAdoptionPlan`,
  `buildReconcilePlan`, `buildDriftReport`, `buildVerifyReport`, `buildMarkerMigrationPlan`,
  `buildOpenExternalFolderRecoveryPlan`, `chooseInitialOpenExternalFolderAction`). May use
  `node:path` / `node:crypto` for pure computation only.
- **`src/storage/`** — Node fs/process adapter for the external root (outside the vault):
  `scanExternalRoot`, `boundExternalFolder`, and the journaled executors (`adoptionExecutor`,
  `reconcileExecutor`, `markerMigrationExecutor`). This is where real `node:fs` mutation happens.
- **`src/obsidian/`** — Obsidian API adapter for vault reads/writes: `scanVault` (via
  `metadataCache`), `assignUuidToNote` / `writeUuidToNote` (via `fileManager`).
- **`src/Plugin.ts`** — orchestrator. Registers the six commands, owns the single-flight mutation
  lock and `mutationSequence`, and wires core plans to storage/obsidian effects. `src/main.ts` only
  default-exports it. UI is the `*Modal.ts` classes plus `PluginSettings.ts` / `PluginSettingsTab.ts`.

### Mutating-command pattern (repeated across adoption, reconcile, marker migration)

1. Build a dry-run plan in `core`; the plan captures the current `mutationSequence`.
2. User confirms in a `*PlanModal`.
3. `runMutatingCommand` takes the single-flight lock (ADR-0012). Execution rejects stale plans
   (`mutationSequence` changed) and re-runs a preflight rescan, comparing rows
   (`haveSameAdoptionRows`, etc.) before any mutation.
4. The storage executor writes a per-row journal and stops on first failure (for adoption the marker
   file is written before note frontmatter).
5. Long scans run inside `withProgressModal`, which enforces a minimum visible duration via
   `core/progressTiming`.

## Conventions / gotchas

- Relative imports use explicit `.ts` extensions (`from './core/adoptionPlan.ts'`). Match this.
- Tests are co-located `*.test.ts` next to source; integration tests are
  `test/**/*.integration.test.ts`; semantic fixture tests live in `test/semantic/` with expected JSON
  under `test/fixtures/fixture/expected/` (ADR-0017, ADR-0028).
- Behavior changes should trace to a product-intent principle, an ADR, or a state-matrix item. What
  an agent may change autonomously vs. must escalate is defined in
  `docs/dev/agent/autonomy-policy.md`.
- `docs/dev/adr/README.md` is generated — edit ADR files or `scripts/update-adr-index.ts`, then run
  `npm run docs:adr:index`.
- Commit messages: conventional commits enforced by the Husky `commit-msg` hook and parsed by Release
  Please. Use `fix:` (not `bug:`) for bug fixes in this repo so version bumps work.
- Do not manually edit `package.json` / `manifest.json` / `CHANGELOG.md` / `versions.json` for
  versioning in feature/fix PRs — Release Please owns those (ADR-0020).
- Debug output is prefixed `[external-note-folders]` and uses `console.debug` (enable Verbose in the
  DevTools console to see it).

## Deeper context

- ADRs: `docs/dev/adr/README.md` (browse by tag and the "When to read" column)
- Procedures: `docs/dev/procedures/` (TDD workflow, MVP implementation, review gate)
- Product intent: `docs/dev/product/intent.md`
- Agent autonomy policy: `docs/dev/agent/autonomy-policy.md`
