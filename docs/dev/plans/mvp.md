# External Note Folders — MVP Plan

This plan defines a safe, minimal MVP aligned with ADR-0001 through ADR-0014.

The plan is split into three phases:

- **Phase 0** delivers the core value: UUID-linked external folders you can
  open from any note, plus a verification report. No reconcile.
- **Phase 0.5** adds a read-only reconciliation report for drift caused by note
  renames or moves. It suggests likely matches but never mutates anything.
- **Phase 1** adds explicit reconcile execution to keep external folder names in
  sync when notes move or rename.

---

## Phase 0 — Core

Status legend:

- `[x]` implemented and covered by automated validation or documentation.
- `[ ] Partial:` implemented incompletely or still needs manual evidence.
- `[ ] Deferred:` intentionally outside Phase 0 completion.

### 0. Scope and Invariants

- [x] Vault is source of truth (`exnf` UUID in note frontmatter)
- [x] No deletions of vault files, external folders, or `.exnf` markers
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
- [x] Confirm plugin installation in a test vault. Sandbox installation and
      command loading are covered by `npm run test:integration`.
- [ ] Deferred: Manual hot reload UX evidence. This is useful developer
      ergonomics validation, but not required for Phase 0 runtime safety.

### 2. Settings

- [x] Add settings tab
- [x] Add External Root setting (absolute path)
- [x] Validate configured path is absolute
- [ ] Deferred: On settings change, invalidate scan cache. Phase 0 does not keep
      a scan cache, so there is nothing to invalidate.

### 3. UUID and Marker Contract

- [x] UUID helper: generate canonical lowercase RFC 4122 UUID
- [x] UUID helper: strict UUID validation (no permissive coercion)
- [x] Frontmatter helper for `exnf` read/write
- [x] `.exnf` writer uses UTF-8 without BOM and trailing `\n`
- [x] `.exnf` parser accepts only one UUID line plus optional trailing newline
- [x] `.exnf` parser rejects BOM, extra lines, extra content, non-canonical UUID
- [x] Any malformed `.exnf` is `Error` and blocks mutation

References:
- [x] `docs/dev/adr/0005-bound-folder-marker.md`
- [x] `docs/dev/adr/0014-exnf-marker-format-and-validation.md`

### 4. Path and Filesystem Boundary Policy

- [x] Derive vault-relative path without `.md`
- [x] Collapse folder-note paths to the parent folder when the note stem
      exactly matches the parent folder name
- [x] Normalize path separators
- [x] Sanitize illegal characters (Windows-safe)
- [x] Handle reserved names and trailing dots/spaces
- [x] Enforce max path length (deterministic hash shortening)
- [x] Normalize Unicode to NFC for path-derived naming/comparison
- [x] Use canonical absolute paths for identity checks
- [x] Apply platform-level case-insensitive comparison where required by the
      default filesystem policy.
- [ ] Deferred: Per-root case-sensitivity probing. Current implementation uses
      platform-level policy rather than probing each configured external root;
      this is acceptable for Phase 0 and should be revisited only if users hit
      mixed case-sensitivity filesystems.
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

- [x] Recursively discover `.exnf` files under external root boundary
- [x] Parse and validate markers with strict contract
- [x] Build `Map<uuid, boundFolderPath>`
- [x] Detect duplicate UUIDs in external root and classify as `Error`
- [x] Detect malformed markers and classify as `Error`
- [x] Surface configured-root permission/read failures as `Error` (not
      `Unavailable`)
- [x] Surface unreadable descendant directories as warning-only skipped
      subtrees

Function:

```ts
scanExternalRoot(): {
  map: Map<string, string>;
  duplicatePaths: Map<string, string[]>;
  malformed: string[];
  accessErrors: string[];
  skippedDirectories: string[];
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
- [x] Integrity preflight for mutating commands:
  - [x] `Assign UUID` runs vault + external integrity scan immediately before
        mutation
  - [x] If any integrity `Error` exists anywhere, abort mutation with grouped
        actionable notice
  - [x] This includes configured-root access/boundary failures (strict
        fail-closed); unreadable descendant directories are warning-only skips
  - [x] `Open External Folder` uses an active-note fast path and only falls
        back to full external scan when an existing UUID has no expected folder
- [x] Reject overlapping mutating commands with clear user notice
- [x] Read-only reports may run during mutation but results must be labeled as
      possibly stale
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
- [x] Validate the active note and expected external folder before opening
- [x] Fast path: if expected folder already has the matching marker, open it
- [x] Fast path: if UUID was just assigned, create the expected folder without
      a full external-root scan
- [x] Drift path: if an existing UUID has no expected folder, scan the external
      map to find whether that UUID is bound elsewhere before creating
- [x] If UUID already bound at the expected folder: open existing folder
- [x] If UUID unbound:
  - [x] Derive target path using path policy
  - [x] If target path occupied: report conflict and abort with notice
  - [x] Create directory
  - [x] Write `.exnf`
  - [x] Open folder

#### 9.3 Integrity Preflight Report

- [x] Scan vault and external
- [x] Categorize:
  - [x] `OK`
  - [x] `Unavailable` (vault UUID with no bound external folder)
  - [x] `Warning` (orphan bound folder)
  - [x] `Warning` (unreadable descendant directory skipped during scan)
  - [x] `Error` (duplicates, malformed markers, mismatches, boundary failures,
        configured-root access failures)
- [x] Show grouped report modal
- [x] Log structured summary. Integrity preflights log grouped report objects
      to the DevTools console with the `[external-note-folders]` prefix.

Reference:
- [x] `docs/dev/adr/0009-status-model.md`

### 10. Obsidian API Boundary

- [x] Vault scan uses `app.metadataCache` for reading frontmatter UUIDs —
      document freshness guarantee
- [x] Frontmatter writes use `app.fileManager.processFrontMatter()`
- [x] External root operations use raw Node `fs`/`fsPromises` — explicitly
      outside Obsidian's vault abstraction
- [x] Document which operations trigger Obsidian vault events and how the plugin
      handles re-entrant events. The implementation avoids event handlers and
      uses command-time scans; frontmatter writes use Obsidian's file manager,
      while external-root operations use raw Node filesystem APIs.

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

- [x] Integrity report modal uses grouped actionable sections
- [x] Use clear, neutral language
- [x] Write structured logs for operations. Command success, blocked mutation,
      verification, warnings, and unexpected failures are logged to the
      DevTools console with structured detail objects.
- [ ] Deferred: Include operation IDs in logs for debugging. This should be
      added with structured logging.

### 14. Testing

- [x] Unit tests:
  - [x] path sanitization/canonicalization/boundary checks
  - [x] UUID validation and normalization policy
  - [x] strict `.exnf` parse/write contract
  - [x] duplicate detection with path-rich diagnostics (`uuid -> paths[]`)
- [x] Integration/manual matrix:
  - [x] external root missing
  - [ ] Deferred: external drive detached or permissions denied. This remains a
        manual hardware/OS-permission scenario; Phase 0 treats equivalent
        configured-root access failures as scan `Error`s and fail-closed
        mutation blockers.
  - [x] unreadable descendant directory under external root reports a warning
        and does not block classification of readable siblings
  - [x] duplicate UUID in vault
  - [x] duplicate UUID in external
  - [x] malformed `.exnf`
  - [x] occupied target path on Open External Folder
  - [x] symlink/junction/root-escape attempts

### 15. Documentation

- [x] README covers:
  - [x] what plugin does and does not do
  - [x] command semantics (Assign UUID, Open External Folder, Report external folder drift)
  - [x] no-deletions guarantee
  - [x] known limitations (sync, orphan accumulation)
- [x] Link ADR index

### 16. Release Checklist

- [x] All blocking tests pass
- [x] Manual safety matrix completed for repo-backed scenarios. Detached drive
      and OS-level permission denial are deferred as residual manual risk.
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

- [x] Integrity reports mark notes with no external folder as `Unavailable`
      (not `Error`)
- [x] Any integrity `Error` blocks mutation
- [x] Mutating commands are serialized by lock
- [x] Boundary checks prevent scan/mutation outside configured external root
- [x] Strict malformed `.exnf` handling is enforced and user-visible
- [x] Occupied target path on Open External Folder reports conflict, does not
      auto-rename

---

## Phase 0.5 — Read-Only Reconciliation Report

Phase 0.5 exists because external folders may contain unique authoritative files.
Before any mutating reconcile behavior ships, users need a safe way to inspect
rename/move drift and identify likely matches without risking external data.

### 1. Scope and Invariants

- [x] Read-only only: no vault frontmatter writes, external folder creation,
      external folder moves, marker writes, marker edits, or deletions
- [x] Treat external folder contents as authoritative user data, never as a
      disposable mirror
- [x] Preserve Phase 0 safety model: malformed markers, duplicate UUIDs,
      boundary failures, and configured-root access failures are reported as
      errors; unreadable descendant directories are warning-only skips
- [x] Do not infer external-to-vault mutations from folder names

### 2. Reconciliation Report Command

- [x] Add command: `Report external folder drift`
- [x] Scan vault markdown notes and configured external root
- [x] Derive expected external folder path for each note using the current path
      policy
- [x] Report notes whose UUID is bound to an existing external folder at a
      non-expected path
- [x] Report notes whose expected external folder is missing
- [x] Report bound external folders whose UUID is not present in the vault
- [x] Report unmarked external folders that occupy expected target paths
- [x] Report likely matches between missing expected folders and existing
      orphan/unexpected folders

### 3. Match Heuristics

- [x] Prefer UUID-backed matches over name-only matches
- [x] Suggest same-parent rename matches when an existing folder is near the
      expected folder path
- [x] Suggest normalized basename matches for case, punctuation, space, dash,
      and Unicode normalization differences
- [ ] Deferred: Optional fuzzy scoring. Current implementation uses conservative
      exact heuristics and confidence/rationale labels; fuzzy scoring can be
      added later if simple matches are insufficient.
- [x] Never auto-select an action from a heuristic match

### 4. UX and Logging

- [x] Show grouped report modal with counts and actionable sections
- [x] Include a copyable text/markdown report for support and manual cleanup
- [x] Log a structured console summary with the `[external-note-folders]` prefix
- [x] Clearly label the command as read-only
- [x] Explain that external folders may contain unique files and should be
      backed up before manual repair

### 5. Testing

- [x] Unit tests:
  - [x] drift classifier for expected, unexpected, missing, orphaned, occupied,
        and error states
  - [x] match heuristics for same-parent rename and normalized basename cases
  - [x] assurance that the report path calls no mutation functions
- [x] Integration/manual matrix:
  - [x] note renamed after external folder creation
  - [x] note moved after external folder creation
  - [x] orphan bound folder
  - [x] unmarked occupied expected path
  - [x] malformed marker blocks confidence but still appears in report

### Phase 0.5 Done Criteria

- [x] Report command is read-only by construction and test coverage
- [x] Users can identify likely renamed/moved external folders without any
      automatic mutation
- [x] Report output is copyable from the UI or console
- [x] README documents that Phase 0.5 reports drift but does not repair it

---

## Phase 1 — Reconcile

Phase 1 adds explicit reconcile execution to keep external folder paths in sync
when vault notes move or rename. Ship after Phase 0.5 is validated by real
usage, because external folders may contain unique authoritative files.

### 1. Filesystem Mutation Layer (additions)

- [x] `moveDir(src, dst)` no-overwrite, conflict-aware, boundary-checked
- [x] Each mutating operation is idempotent on retry where feasible

### 2. Settings (additions)

- [x] Add "Dry-run by default" toggle (default: true). When disabled,
      reconcile still shows the plan first, but opens with the execute button
      already at the final confirmation step.
- [x] On settings change, clear any active plan state. Plans are held only in
      the open modal and execute is rejected if mutation sequence changes.

### 3. Command Serialization (additions)

- [x] Add `Reconcile (execute)` to mutating command set
- [x] Reconcile confirm step re-validates lock/version before execution

### 4. Reconcile Command (Dry-Run Default)

- [x] Build immutable plan from scan snapshot
- [x] Abort plan/execution if any integrity `Error` exists
- [x] Immediately before each planned move, re-check source/destination
      invariants against live filesystem state; on mismatch, mark conflict and
      skip move
- [ ] For UUID intersection:
  - [x] Derive canonical target path
  - [x] Skip if already correct
  - [x] Plan move when target empty/unbound
  - [x] Report conflict when target occupied (bound to different UUID or
        unbound) — skip the move
  - [x] Report conflict on ancestor/descendant marker collisions — skip the
        move
- [x] Show plan modal (moves, conflicts, skipped, risk notices)
- [x] Reconcile modal clearly distinguishes dry-run vs execute mode
- [x] Confirm dialog contains explicit mutation summary before execute. The
      modal requires a second explicit click on "Confirm execute".
- [x] Execute only with explicit confirmation
- [x] Never delete anything

References:
- [x] `docs/dev/adr/0006-reconcile-is-explicit.md`
- [x] `docs/dev/adr/0009-status-model.md`
- [x] `docs/dev/adr/0022-reconcile-planner-and-execution-contract.md`

### 5. Reconcile Execution Log

Journal serves as an audit log, not a recovery mechanism. Re-scan provides
correct recovery.

- [x] Log each move with: source, destination, timestamp, outcome
      (success/failure)
- [x] Include run ID for grouping
- [x] On failure: stop execution, log failure, do not continue best-effort
- [x] No resume/regenerate UX — next reconcile re-scans and builds a fresh
      plan

Reference:
- [x] `docs/dev/adr/0011-reconcile-execution-safety-model.md`

### 6. Caching Rules (additions)

- [x] Never execute reconcile from stale cache-only state
- [x] Invalidate cache on reconcile execution. No persistent plan cache is kept;
      stale modal plans are rejected by mutation sequence.

### 7. Testing (additions)

- [x] Unit tests:
  - [x] reconcile planner conflict detection
  - [x] journaled executor stop-on-first-failure behavior
- [ ] Deferred: direct command lock/stale-plan unit tests. Current coverage is
      by command wiring and manual validation because plugin command
      orchestration depends on Obsidian runtime objects.
- [ ] Integration/manual matrix:
  - [ ] note rename then reconcile
  - [ ] concurrent command attempts
  - [ ] occupied target path during reconcile (conflict reported, move
        skipped)
  - [ ] interrupted reconcile execution (simulated mid-run failure, then
        fresh re-scan recovery)

### 8. Documentation (additions)

- [x] README covers:
  - [x] reconcile semantics (dry-run default, explicit execution)
  - [x] conflict reporting (no auto-rename)

### Phase 1 Done Criteria

- [x] Reconcile execution never performs deletion operations
- [x] Occupied or conflicting target paths are reported and skipped, never
      auto-renamed
- [x] Mutating commands (including Reconcile execute) are serialized by lock
- [x] Reconcile execution is logged with run IDs for auditability

---

## Deferred — Regenerate UUID

ADR-0007 (accepted) defines a Regenerate UUID command with re-association
semantics and safe-abort mode. This is deferred past Phase 1. Until then,
users can manually edit the `exnf` frontmatter field to change a UUID; integrity
preflights and drift reports will surface the consequences (orphaned bound folder, new Unavailable status).
