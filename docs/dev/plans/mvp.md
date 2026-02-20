# External Note Folders — MVP Plan

This plan defines a safe, minimal MVP aligned with ADR-0001 through ADR-0014.

The plan is split into two phases:

- **Phase 0** delivers the core value: UUID-linked external folders you can
  open from any note, plus a verification report. No reconcile.
- **Phase 1** adds reconcile to keep external folder names in sync when notes
  move or rename.

---

## Phase 0 — Core

### 0. Scope and Invariants

- [ ] Vault is source of truth (`exf` UUID in note frontmatter)
- [ ] No deletions of vault files, external folders, or `.exf` markers
- [ ] No conflict-based surprise renames — plugin never renames folders to
      dodge collisions (deterministic path derivation including sanitization
      and hash shortening is normal creation behavior, not renaming)
- [ ] External state never drives vault mutations
- [ ] Exactly one external root is configured

References:
- [ ] `docs/dev/adr/0001-vault-is-source-of-truth.md`
- [ ] `docs/dev/adr/0003-no-deletions.md`
- [ ] `docs/dev/adr/0004-single-external-root.md`
- [ ] `docs/dev/adr/0008-no-reverse-reconciliation.md`

### 1. Repo and Plugin Setup

- [ ] Initialize Obsidian plugin scaffold per ADR-0010 (TypeScript + build)
- [ ] Configure `manifest.json`
- [ ] Add `main.ts`
- [ ] Add `package.json` scripts (`dev`, `build`, `version`)
- [ ] Confirm hot reload in a test vault

### 2. Settings

- [ ] Add settings tab
- [ ] Add External Root setting (absolute path)
- [ ] Validate configured path is absolute
- [ ] On settings change, invalidate scan cache

### 3. UUID and Marker Contract

- [ ] UUID helper: generate canonical lowercase RFC 4122 UUID
- [ ] UUID helper: strict UUID validation (no permissive coercion)
- [ ] Frontmatter helper for `exf` read/write
- [ ] `.exf` writer uses UTF-8 without BOM and trailing `\n`
- [ ] `.exf` parser accepts only one UUID line plus optional trailing newline
- [ ] `.exf` parser rejects BOM, extra lines, extra content, non-canonical UUID
- [ ] Any malformed `.exf` is `Error` and blocks mutation

References:
- [ ] `docs/dev/adr/0005-bound-folder-marker.md`
- [ ] `docs/dev/adr/0014-exf-marker-format-and-validation.md`

### 4. Path and Filesystem Boundary Policy

- [ ] Derive vault-relative path without `.md`
- [ ] Normalize path separators
- [ ] Sanitize illegal characters (Windows-safe)
- [ ] Handle reserved names and trailing dots/spaces
- [ ] Enforce max path length (deterministic hash shortening)
- [ ] Normalize Unicode to NFC for path-derived naming/comparison
- [ ] Use canonical absolute paths for identity checks
- [ ] Apply case-insensitive comparison where filesystem requires it
- [ ] Enforce root boundary after canonicalization (must remain under external
      root)
- [ ] Default scan policy: do not traverse symlink/junction/reparse points

Reference:
- [ ] `docs/dev/adr/0013-filesystem-boundary-and-path-identity.md`

### 5. Vault Scan

- [ ] Scan markdown notes and collect `Map<uuid, notePath>`
- [ ] Detect duplicate UUIDs in vault and classify as `Error`
- [ ] Use Obsidian metadata cache for scan (see Section 10 — API Boundary)

Function:

```ts
scanVaultUUIDs(): {
  map: Map<string, string>;
  duplicatePaths: Map<string, string[]>;
}
```

### 6. External Root Scan

- [ ] Recursively discover `.exf` files under external root boundary
- [ ] Parse and validate markers with strict contract
- [ ] Build `Map<uuid, boundFolderPath>`
- [ ] Detect duplicate UUIDs in external root and classify as `Error`
- [ ] Detect malformed markers and classify as `Error`
- [ ] Surface permission/read failures as `Error` (not `Unavailable`)

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

- [ ] `ensureDir(path)` with boundary checks
- [ ] `writeMarker(boundFolder, uuid)` with overwrite refusal on conflicting
      UUID
- [ ] `openInExplorer(path)` with explicit error handling for
      missing/inaccessible paths
- [ ] Enforce no-deletion invariant in all mutation code paths

### 8. Command Serialization and Locking

- [ ] Implement single-flight lock for mutating commands
- [ ] Mutating commands: `Open External Folder` (when creating), `Assign UUID`
      (when writing)
- [ ] Global mutation preflight for every mutating command:
  - [ ] Run vault + external integrity scan immediately before mutation
  - [ ] If any integrity `Error` exists anywhere, abort mutation with grouped
        actionable notice
  - [ ] This includes external access/boundary failures (strict fail-closed)
- [ ] Reject overlapping mutating commands with clear user notice
- [ ] Read-only commands (Verify) may run during mutation but results must be
      labeled as possibly stale
- [ ] Lock release guaranteed on success and failure paths

Reference:
- [ ] `docs/dev/adr/0012-command-serialization-and-concurrency.md`

### 9. Commands

#### 9.1 Assign UUID

- [ ] Run global mutation preflight and abort on any integrity `Error`
- [ ] If UUID missing: generate and write
- [ ] If UUID exists: no-op + notice
- [ ] Never mutate external root from this command

#### 9.2 Open External Folder

- [ ] If UUID missing: assign UUID first
- [ ] Run global mutation preflight and abort on any integrity `Error`
- [ ] Scan external map
- [ ] If UUID already bound: open existing folder
- [ ] If UUID unbound:
  - [ ] Derive target path using path policy
  - [ ] If target path occupied: report conflict and abort with notice
  - [ ] Create directory
  - [ ] Write `.exf`
  - [ ] Open folder

#### 9.3 Verify

- [ ] Scan vault and external
- [ ] Categorize:
  - [ ] `OK`
  - [ ] `Unavailable` (vault UUID with no bound external folder)
  - [ ] `Warning` (orphan bound folder)
  - [ ] `Error` (duplicates, malformed markers, mismatches,
        boundary/access failures)
- [ ] Show grouped report modal
- [ ] Log structured summary

Reference:
- [ ] `docs/dev/adr/0009-status-model.md`

### 10. Obsidian API Boundary

- [ ] Vault scan uses `app.metadataCache` for reading frontmatter UUIDs —
      document freshness guarantee
- [ ] Frontmatter writes use `app.fileManager.processFrontMatter()`
- [ ] External root operations use raw Node `fs`/`fsPromises` — explicitly
      outside Obsidian's vault abstraction
- [ ] Document which operations trigger Obsidian vault events and how the
      plugin handles re-entrant events

### 11. Known Limitations

- [ ] Document: concurrent UUID assignment across unsynced devices can create
      orphan external folders
- [ ] Document: sync tool conflicts on frontmatter are outside plugin scope

### 12. Caching Rules

- [ ] Cache is optional for read-only UX, not required for correctness
- [ ] Invalidate cache on settings change and folder creation
- [ ] Label cached verify results when freshness is uncertain

### 13. UX and Logging

- [ ] Verify modal uses grouped actionable sections
- [ ] Use clear, neutral language
- [ ] Write structured logs for operations
- [ ] Include operation IDs in logs for debugging

### 14. Testing

- [ ] Unit tests:
  - [ ] path sanitization/canonicalization/boundary checks
  - [ ] UUID validation and normalization policy
  - [ ] strict `.exf` parse/write contract
  - [ ] duplicate detection with path-rich diagnostics (`uuid -> paths[]`)
- [ ] Integration/manual matrix:
  - [ ] external root missing
  - [ ] external drive detached or permissions denied
  - [ ] duplicate UUID in vault
  - [ ] duplicate UUID in external
  - [ ] malformed `.exf`
  - [ ] occupied target path on Open External Folder
  - [ ] symlink/junction/root-escape attempts

### 15. Documentation

- [ ] README covers:
  - [ ] what plugin does and does not do
  - [ ] command semantics (Assign UUID, Open External Folder, Verify)
  - [ ] no-deletions guarantee
  - [ ] known limitations (sync, orphan accumulation)
- [ ] Link ADR index

### 16. Release Checklist

- [ ] All blocking tests pass
- [ ] Manual safety matrix completed
- [ ] Build succeeds
- [ ] Test in fresh vault and realistic external root
- [ ] Version bump
- [ ] Tag and publish

### Phase 0 Done Criteria

- [ ] Verify reports `Unavailable` (not `Error`) for notes with no external
      folder
- [ ] Any integrity `Error` blocks mutation
- [ ] Mutating commands are serialized by lock
- [ ] Boundary checks prevent scan/mutation outside configured external root
- [ ] Strict malformed `.exf` handling is enforced and user-visible
- [ ] Occupied target path on Open External Folder reports conflict, does not
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
