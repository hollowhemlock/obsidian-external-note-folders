# External Note Folders — MVP Plan

This plan defines a safe, minimal MVP aligned with ADR-0001 through ADR-0014.

The plan is split into two phases:

- **Phase 0** delivers the core value: UUID-linked external folders you can
  open from any note, plus a verification report. No reconcile.
- **Phase 1** adds reconcile to keep external folder names in sync when notes
  move or rename.

---

## Phase 0 — Core

Status legend:

- `[x]` implemented and covered by automated validation or documentation.
- `[ ] Partial:` implemented incompletely or still needs manual evidence.
- `[ ] Deferred:` intentionally outside Phase 0 completion.

### 0. Scope and Invariants

- [x] Vault is source of truth (`exf` UUID in note frontmatter)
- [x] No deletions of vault files, external folders, or `.exf` markers
- [x] No conflict-based surprise renames — plugin never renames folders to
      dodge collisions (deterministic path derivation including sanitization
      and hash shortening is normal creation behavior, not renaming)
- [x] External state never drives vault mutations
- [x] Exactly one external root is configured

References:
- [x] `docs/dev/adr/0001-vault-is-source-of-truth.md`
- [x] `docs/dev/adr/0003-no-deletions.md`
- [x] `docs/dev/adr/0004-single-external-root.md`
- [x] `docs/dev/adr/0008-no-reverse-reconciliation.md`

### 1. Repo and Plugin Setup

- [x] Initialize Obsidian plugin scaffold per ADR-0010 (TypeScript + build)
- [x] Configure `manifest.json`
- [x] Add `main.ts`
- [x] Add `package.json` scripts (`dev`, `build`, `version`)
- [ ] Partial: Confirm hot reload in a test vault. Sandbox installation is covered
      by `npm run test:integration`; manual hot reload behavior still needs evidence.

### 2. Settings

- [x] Add settings tab
- [x] Add External Root setting (absolute path)
- [x] Validate configured path is absolute
- [ ] Deferred: On settings change, invalidate scan cache. Phase 0 does not keep
      a scan cache, so there is nothing to invalidate.

### 3. UUID and Marker Contract

- [x] UUID helper: generate canonical lowercase RFC 4122 UUID
- [x] UUID helper: strict UUID validation (no permissive coercion)
- [x] Frontmatter helper for `exf` read/write
- [x] `.exf` writer uses UTF-8 without BOM and trailing `\n`
- [x] `.exf` parser accepts only one UUID line plus optional trailing newline
- [x] `.exf` parser rejects BOM, extra lines, extra content, non-canonical UUID
- [x] Any malformed `.exf` is `Error` and blocks mutation

References:
- [x] `docs/dev/adr/0005-bound-folder-marker.md`
- [x] `docs/dev/adr/0014-exf-marker-format-and-validation.md`

### 4. Path and Filesystem Boundary Policy

- [x] Derive vault-relative path without `.md`
- [x] Normalize path separators
- [x] Sanitize illegal characters (Windows-safe)
- [x] Handle reserved names and trailing dots/spaces
- [x] Enforce max path length (deterministic hash shortening)
- [x] Normalize Unicode to NFC for path-derived naming/comparison
- [x] Use canonical absolute paths for identity checks
- [ ] Partial: Apply case-insensitive comparison where filesystem requires it.
      Current implementation uses platform-level case policy, not a per-root
      filesystem probe.
- [x] Enforce root boundary after canonicalization (must remain under external
      root)
- [x] Default scan policy: do not traverse symlink/junction/reparse points

Reference:
- [x] `docs/dev/adr/0013-filesystem-boundary-and-path-identity.md`

### 5. Vault Scan

- [x] Scan markdown notes and collect `Map<uuid, notePath>`
- [x] Detect duplicate UUIDs in vault and classify as `Error`
- [x] Use Obsidian metadata cache for scan (see Section 10 — API Boundary)

Function:

```ts
scanVaultUUIDs(): {
  map: Map<string, string>;
  duplicatePaths: Map<string, string[]>;
}
```

### 6. External Root Scan

- [x] Recursively discover `.exf` files under external root boundary
- [x] Parse and validate markers with strict contract
- [x] Build `Map<uuid, boundFolderPath>`
- [x] Detect duplicate UUIDs in external root and classify as `Error`
- [x] Detect malformed markers and classify as `Error`
- [x] Surface permission/read failures as `Error` (not `Unavailable`)

Function:

```ts
scanExternalRoot(): {
  map: Map<string, string>;
  duplicatePaths: Map<string, string[]>;
  malformed: string[];
  accessErrors: string[];
}
```

### 7. Filesystem Mutation Layer

Implement one guarded module for all mutations.

- [x] `ensureDir(path)` with boundary checks
- [x] `writeMarker(boundFolder, uuid)` with overwrite refusal on conflicting
      UUID
- [x] `openInExplorer(path)` with explicit error handling for
      missing/inaccessible paths
- [x] Enforce no-deletion invariant in all mutation code paths

### 8. Command Serialization and Locking

- [x] Implement single-flight lock for mutating commands
- [x] Mutating commands: `Open External Folder` (when creating), `Assign UUID`
      (when writing)
- [x] Global mutation preflight for every mutating command:
  - [x] Run vault + external integrity scan immediately before mutation
  - [x] If any integrity `Error` exists anywhere, abort mutation with grouped
        actionable notice
  - [x] This includes external access/boundary failures (strict fail-closed)
- [x] Reject overlapping mutating commands with clear user notice
- [x] Read-only commands (Verify) may run during mutation but results must be
      labeled as possibly stale
- [x] Lock release guaranteed on success and failure paths

Reference:
- [x] `docs/dev/adr/0012-command-serialization-and-concurrency.md`

### 9. Commands

#### 9.1 Assign UUID

- [x] Run global mutation preflight and abort on any integrity `Error`
- [x] If UUID missing: generate and write
- [x] If UUID exists: no-op + notice
- [x] Never mutate external root from this command

#### 9.2 Open External Folder

- [x] If UUID missing: assign UUID first
- [x] Run global mutation preflight and abort on any integrity `Error`
- [x] Scan external map
- [x] If UUID already bound: open existing folder
- [x] If UUID unbound:
  - [x] Derive target path using path policy
  - [x] If target path occupied: report conflict and abort with notice
  - [x] Create directory
  - [x] Write `.exf`
  - [x] Open folder

#### 9.3 Verify

- [x] Scan vault and external
- [x] Categorize:
  - [x] `OK`
  - [x] `Unavailable` (vault UUID with no bound external folder)
  - [x] `Warning` (orphan bound folder)
  - [x] `Error` (duplicates, malformed markers, mismatches,
        boundary/access failures)
- [x] Show grouped report modal
- [ ] Partial: Log structured summary. Current implementation shows a notice and
      modal; structured operation logging is not implemented.

Reference:
- [x] `docs/dev/adr/0009-status-model.md`

### 10. Obsidian API Boundary

- [x] Vault scan uses `app.metadataCache` for reading frontmatter UUIDs —
      document freshness guarantee
- [x] Frontmatter writes use `app.fileManager.processFrontMatter()`
- [x] External root operations use raw Node `fs`/`fsPromises` — explicitly
      outside Obsidian's vault abstraction
- [ ] Partial: Document which operations trigger Obsidian vault events and how
      the plugin handles re-entrant events. The implementation avoids event
      handlers and uses command-time scans, but this is not documented in detail.

### 11. Known Limitations

- [x] Document: concurrent UUID assignment across unsynced devices can create
      orphan external folders
- [x] Document: sync tool conflicts on frontmatter are outside plugin scope

### 12. Caching Rules

- [x] Cache is optional for read-only UX, not required for correctness
- [ ] Deferred: Invalidate cache on settings change and folder creation. Phase 0
      does not keep a scan cache.
- [ ] Deferred: Label cached verify results when freshness is uncertain. Phase 0
      does not keep a scan cache.

### 13. UX and Logging

- [x] Verify modal uses grouped actionable sections
- [x] Use clear, neutral language
- [ ] Partial: Write structured logs for operations. Current implementation
      relies on notices/modals and test output.
- [ ] Deferred: Include operation IDs in logs for debugging. This should be
      added with structured logging.

### 14. Testing

- [x] Unit tests:
  - [x] path sanitization/canonicalization/boundary checks
  - [x] UUID validation and normalization policy
  - [x] strict `.exf` parse/write contract
  - [x] duplicate detection with path-rich diagnostics (`uuid -> paths[]`)
- [ ] Partial: Integration/manual matrix:
  - [x] external root missing
  - [ ] Manual: external drive detached or permissions denied
  - [x] duplicate UUID in vault
  - [x] duplicate UUID in external
  - [x] malformed `.exf`
  - [x] occupied target path on Open External Folder
  - [x] symlink/junction/root-escape attempts

### 15. Documentation

- [x] README covers:
  - [x] what plugin does and does not do
  - [x] command semantics (Assign UUID, Open External Folder, Verify)
  - [x] no-deletions guarantee
  - [x] known limitations (sync, orphan accumulation)
- [x] Link ADR index

### 16. Release Checklist

- [x] All blocking tests pass
- [ ] Manual: Manual safety matrix completed
- [x] Build succeeds
- [x] Test in fresh vault and realistic external root
- [ ] Deferred: Release PR generated and reviewed (Release Please)
- [ ] Deferred: Changelog updated (`CHANGELOG.md`) in release PR
- [ ] Deferred: Version bump propagated to `package.json` and `manifest.json` in release PR
- [ ] Deferred: Release PR merged
- [ ] Deferred: GitHub release published and required assets uploaded
- [ ] Deferred: `versions.json` updated on `main` for released version/min app version

Reference:
- [x] `docs/dev/adr/0020-release-please-for-versioning-and-changelog.md`
- [x] `docs/dev/procedures/release.md`

### Phase 0 Done Criteria

- [x] Verify reports `Unavailable` (not `Error`) for notes with no external
      folder
- [x] Any integrity `Error` blocks mutation
- [x] Mutating commands are serialized by lock
- [x] Boundary checks prevent scan/mutation outside configured external root
- [x] Strict malformed `.exf` handling is enforced and user-visible
- [x] Occupied target path on Open External Folder reports conflict, does not
      auto-rename

---

## Phase 1 — Reconcile

Phase 1 adds reconcile to keep external folder paths in sync when vault notes
move or rename. Ship after Phase 0 is validated by real usage.

### 1. Filesystem Mutation Layer (additions)

- [ ] `moveDir(src, dst)` no-overwrite, conflict-aware, boundary-checked
- [ ] Each mutating operation is idempotent on retry where feasible

### 2. Settings (additions)

- [ ] Add "Dry-run by default" toggle (default: true)
- [ ] On settings change, clear any active plan state

### 3. Command Serialization (additions)

- [ ] Add `Reconcile (execute)` to mutating command set
- [ ] Reconcile confirm step re-validates lock/version before execution

### 4. Reconcile Command (Dry-Run Default)

- [ ] Build immutable plan from scan snapshot
- [ ] Abort plan/execution if any integrity `Error` exists
- [ ] Immediately before each planned move, re-check source/destination
      invariants against live filesystem state; on mismatch, mark conflict and
      skip move
- [ ] For UUID intersection:
  - [ ] Derive canonical target path
  - [ ] Skip if already correct
  - [ ] Plan move when target empty/unbound
  - [ ] Report conflict when target occupied (bound to different UUID or
        unbound) — skip the move
  - [ ] Report conflict on ancestor/descendant marker collisions — skip the
        move
- [ ] Show plan modal (moves, conflicts, skipped, risk notices)
- [ ] Reconcile modal clearly distinguishes dry-run vs execute mode
- [ ] Confirm dialog contains explicit mutation summary before execute
- [ ] Execute only with explicit confirmation
- [ ] Never delete anything

References:
- [ ] `docs/dev/adr/0006-reconcile-is-explicit.md`
- [ ] `docs/dev/adr/0009-status-model.md`

### 5. Reconcile Execution Log

Journal serves as an audit log, not a recovery mechanism. Re-scan provides
correct recovery.

- [ ] Log each move with: source, destination, timestamp, outcome
      (success/failure)
- [ ] Include run ID for grouping
- [ ] On failure: stop execution, log failure, do not continue best-effort
- [ ] No resume/regenerate UX — next reconcile re-scans and builds a fresh
      plan

Reference:
- [ ] `docs/dev/adr/0011-reconcile-execution-safety-model.md`

### 6. Caching Rules (additions)

- [ ] Never execute reconcile from stale cache-only state
- [ ] Invalidate cache on reconcile execution

### 7. Testing (additions)

- [ ] Unit tests:
  - [ ] reconcile planner conflict detection
  - [ ] lock behavior and stale-plan invalidation
- [ ] Integration/manual matrix:
  - [ ] note rename then reconcile
  - [ ] concurrent command attempts
  - [ ] occupied target path during reconcile (conflict reported, move
        skipped)
  - [ ] interrupted reconcile execution (simulated mid-run failure, then
        fresh re-scan recovery)

### 8. Documentation (additions)

- [ ] README covers:
  - [ ] reconcile semantics (dry-run default, explicit execution)
  - [ ] conflict reporting (no auto-rename)

### Phase 1 Done Criteria

- [ ] Reconcile execution never performs deletion operations
- [ ] Occupied or conflicting target paths are reported and skipped, never
      auto-renamed
- [ ] Mutating commands (including Reconcile execute) are serialized by lock
- [ ] Reconcile execution is logged with run IDs for auditability

---

## Deferred — Regenerate UUID

ADR-0007 (accepted) defines a Regenerate UUID command with re-association
semantics and safe-abort mode. This is deferred past Phase 1. Until then,
users can manually edit the `exf` frontmatter field to change a UUID; Verify
will surface the consequences (orphaned bound folder, new Unavailable status).
