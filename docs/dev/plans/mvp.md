# External Note Folders - MVP Checklist

This checklist defines a safe, minimal MVP aligned with ADR-0001 through ADR-0014.

## 0. Scope and Invariants

- [ ] Vault is source of truth (`exf` UUID in note frontmatter)
- [ ] No deletions of vault files, external folders, or `.exf` markers
- [ ] Reconcile is explicit and dry-run by default
- [ ] External state never drives vault mutations
- [ ] Exactly one external root is configured

References:
- [ ] `docs/dev/adr/0001-vault-is-source-of-truth.md`
- [ ] `docs/dev/adr/0003-no-deletions.md`
- [ ] `docs/dev/adr/0004-single-external-root.md`
- [ ] `docs/dev/adr/0006-reconcile-is-explicit.md`
- [ ] `docs/dev/adr/0008-no-reverse-reconciliation.md`

## 1. Repo and Plugin Setup

- [ ] Initialize Obsidian plugin scaffold (TypeScript + build)
- [ ] Configure `manifest.json`
- [ ] Add `main.ts`
- [ ] Add `package.json` scripts (`dev`, `build`, `version`)
- [ ] Confirm hot reload in a test vault

## 2. Settings

- [ ] Add settings tab
- [ ] Add External Root setting (absolute path)
- [ ] Validate configured path is absolute
- [ ] Add "Dry-run by default" toggle (default: true)
- [ ] On settings change, invalidate scan cache and clear any active plan state

## 3. UUID and Marker Contract

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

## 4. Path and Filesystem Boundary Policy

- [ ] Derive vault-relative path without `.md`
- [ ] Normalize path separators
- [ ] Sanitize illegal characters (Windows-safe)
- [ ] Handle reserved names and trailing dots/spaces
- [ ] Enforce max path length (deterministic hash shortening)
- [ ] Normalize Unicode to NFC for path-derived naming/comparison
- [ ] Use canonical absolute paths for identity checks
- [ ] Apply case-insensitive comparison where filesystem requires it
- [ ] Enforce root boundary after canonicalization (must remain under external root)
- [ ] Default scan policy: do not traverse symlink/junction/reparse points
- [ ] Conflict checks include ancestor and descendant `.exf` marker collisions

Reference:
- [ ] `docs/dev/adr/0013-filesystem-boundary-and-path-identity.md`

## 5. Vault Scan

- [ ] Scan markdown notes and collect `Map<uuid, notePath>`
- [ ] Detect duplicate UUIDs in vault and classify as `Error`
- [ ] Use a fresh-enough read strategy for safety decisions (no stale plan inputs)

Function:

```ts
scanVaultUUIDs(): {
  map: Map<string, string>;
  duplicates: string[];
}
```

## 6. External Root Scan

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
  duplicates: string[];
  malformed: string[];
  accessErrors: string[];
}
```

## 7. Filesystem Mutation Layer

Implement one guarded module for all mutations.

- [ ] `ensureDir(path)` with boundary checks
- [ ] `writeMarker(boundFolder, uuid)` with overwrite refusal on conflicting UUID
- [ ] `moveDir(src, dst)` no-overwrite, conflict-aware, boundary-checked
- [ ] `openInExplorer(path)` with explicit error handling for missing/inaccessible paths
- [ ] Enforce no-deletion invariant in all mutation code paths
- [ ] Each mutating operation is idempotent on retry where feasible

## 8. Command Serialization and Locking

- [ ] Implement single-flight lock for mutating commands
- [ ] Mutating commands: `Reconcile (execute)`, `Open External Folder` (when creating), `Assign UUID` (when writing)
- [ ] Reject overlapping mutating commands with clear user notice
- [ ] Reconcile confirm step re-validates lock/version before execution
- [ ] Lock release guaranteed on success and failure paths

Reference:
- [ ] `docs/dev/adr/0012-command-serialization-and-concurrency.md`

## 9. Commands

### 9.1 Assign UUID

- [ ] If UUID missing: generate and write
- [ ] If UUID exists: no-op + notice
- [ ] Never mutate external root from this command

### 9.2 Open External Folder

- [ ] If UUID missing: assign UUID first
- [ ] Scan external map
- [ ] If UUID already bound: open existing folder
- [ ] If UUID unbound:
- [ ] Derive target path using path policy
- [ ] Create directory
- [ ] Write `.exf`
- [ ] Open folder

### 9.3 Verify

- [ ] Scan vault and external
- [ ] Categorize:
- [ ] `OK`
- [ ] `Unavailable` (vault UUID with no bound external folder)
- [ ] `Warning` (orphan bound folder)
- [ ] `Error` (duplicates, malformed markers, mismatches, boundary/access failures)
- [ ] Show grouped report modal
- [ ] Log structured summary

### 9.4 Reconcile (Dry-Run Default)

- [ ] Build immutable plan from scan snapshot
- [ ] Abort plan/execution if any integrity `Error` exists
- [ ] For UUID intersection:
- [ ] Derive canonical target path
- [ ] Skip if already correct
- [ ] Plan move when target empty/unbound
- [ ] Mark conflict when target has different UUID
- [ ] Mark conflict on ancestor/descendant marker collisions
- [ ] Resolve unbound occupied target using deterministic suffix strategy
- [ ] Show plan modal (moves, conflicts, skipped, risk notices)
- [ ] Execute only with explicit confirmation
- [ ] Never delete anything

Reference:
- [ ] `docs/dev/adr/0009-status-model.md`

## 10. Reconcile Execution Journal and Recovery

- [ ] Persist a reconcile run journal for execution phase
- [ ] Journal each move entry with states: `pending`, `applied`, `failed`
- [ ] Per entry execution order:
- [ ] Re-validate preconditions
- [ ] Execute move
- [ ] Verify postconditions
- [ ] On first failure: stop execution and mark run incomplete
- [ ] On next reconcile: detect incomplete run and offer resume or regenerate plan
- [ ] Ensure already applied entries are safe to re-check/retry (idempotent handling)

Reference:
- [ ] `docs/dev/adr/0011-reconcile-execution-safety-model.md`

## 11. Caching Rules

- [ ] Cache is optional for read-only UX, not required for correctness
- [ ] Never execute reconcile from stale cache-only state
- [ ] Invalidate cache on settings change, reconcile execution, and folder creation
- [ ] Label cached verify results when freshness is uncertain

## 12. UX and Logging

- [ ] Reconcile modal clearly distinguishes dry-run vs execute mode
- [ ] Confirm dialog contains explicit mutation summary before execute
- [ ] Verify modal uses grouped actionable sections
- [ ] Use clear, neutral language
- [ ] Write structured logs for plan and execution events
- [ ] Include run ID and operation IDs in logs for incident debugging

## 13. Testing

- [ ] Unit tests:
- [ ] path sanitization/canonicalization/boundary checks
- [ ] UUID validation and normalization policy
- [ ] strict `.exf` parse/write contract
- [ ] duplicate detection
- [ ] reconcile planner conflicts and deterministic suffixing
- [ ] lock behavior and stale-plan invalidation
- [ ] journal state transitions and idempotent re-run behavior
- [ ] Integration/manual matrix:
- [ ] external root missing
- [ ] external drive detached or permissions denied
- [ ] duplicate UUID in vault
- [ ] duplicate UUID in external
- [ ] malformed `.exf`
- [ ] note rename then reconcile
- [ ] interrupted reconcile execution (simulated mid-run failure)
- [ ] concurrent command attempts
- [ ] symlink/junction/root-escape attempts

## 14. Documentation

- [ ] README covers:
- [ ] what plugin does and does not do
- [ ] command semantics
- [ ] no-deletions guarantee
- [ ] dry-run and explicit execution model
- [ ] troubleshooting for malformed markers and incomplete journal runs
- [ ] Link ADR index

## 15. Release Checklist

- [ ] All blocking tests pass
- [ ] Manual safety matrix completed
- [ ] Build succeeds
- [ ] Test in fresh vault and realistic external root
- [ ] Version bump
- [ ] Tag and publish

## MVP Done Criteria (Measurable)

- [ ] Verify reports `Unavailable` (not `Error`) for notes with no external folder
- [ ] Reconcile execution never performs deletion operations
- [ ] Any integrity `Error` blocks mutation
- [ ] Mutating commands are serialized by lock
- [ ] Interrupted reconcile leaves journal state that supports explicit resume/regenerate
- [ ] Boundary checks prevent scan/mutation outside configured external root
- [ ] Strict malformed `.exf` handling is enforced and user-visible
