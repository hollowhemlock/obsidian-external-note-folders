---
status: "Accepted"
date: "2026-05-02"
decision-makers: "Maintainers"
---

# Reconcile Planner and Execution Contract

## Context and Problem Statement

Phase 1 reconcile execution moves existing bound external folders to paths derived from vault note
state. Existing ADRs define the safety posture, but implementation needs concrete planner outputs,
conflict categories, move semantics, journal fields, and confirmation requirements to avoid
ambiguous behavior.

## Decision Drivers

- Keep reconcile dry-run understandable before any filesystem mutation
- Make every planned move traceable to immutable scan evidence
- Fail closed on path, marker, permission, and stale-plan uncertainty
- Preserve no-delete and no-overwrite guarantees across platforms

## Considered Options

* Encode planner categories directly in the UI
* Define a pure planner contract before UI and execution
* Treat all per-move conflicts as global integrity errors

## Decision Outcome

Define a pure reconcile planner contract that is consumed by dry-run UI and execution.

### Planner Inputs

The planner receives an immutable scan snapshot:

- vault bindings: `uuid -> vault note path`
- external bindings: `uuid -> current external folder path`
- external directories under the configured root
- scan integrity issues from vault and external-root verification
- non-blocking scan warnings, including skipped unreadable descendant directories
- canonical external root path
- mutation sequence value at plan creation

If the scan contains any global integrity `Error`, the planner returns an abort result with no moves.
Global errors include duplicate UUIDs, malformed markers, invalid vault `exnf` values, external-root
root access failures, and root-boundary failures. Descendant directory read failures are warnings;
the unreadable subtree is omitted from the snapshot but does not create a global error.

### Planner Rows

For each vault UUID that intersects with an external binding, the planner returns exactly one row:

- `already-correct`: current bound folder already equals the derived target path
- `move`: current bound folder can move to the derived target path
- `conflict`: the affected UUID cannot move safely

For vault UUIDs with no external binding, the planner reports `unavailable` and does not create
folders. For external UUIDs with no vault binding, the planner reports `orphan` and does not move
folders.

### Conflict Categories

Planner `conflict` rows use these categories:

- `target-bound-to-different-uuid`: derived target has a `.exnf` marker for another UUID
- `target-unmarked-occupied`: derived target exists without a marker
- `target-has-malformed-marker`: derived target contains an unreadable or invalid `.exnf`
- `ancestor-bound-folder`: an ancestor of the target path is already a bound folder
- `descendant-bound-folder`: a descendant of the target path is already a bound folder
- `source-missing`: the current bound source folder is missing from the snapshot
- `source-outside-root`: source path fails root-boundary validation
- `target-outside-root`: target path fails root-boundary validation

Per-move conflicts skip only the affected move. They do not abort the entire dry-run plan. This
refines ADR-0013: ancestor and descendant marker collisions are execution-blocking conflicts for
the affected UUID, while scan integrity errors still abort the whole run.

### Move Semantics

Execution uses Node filesystem rename semantics for directory moves within the same external root.
The executor must:

- create missing destination parent directories only when every parent remains inside the external
  root and no parent is a bound folder
- never overwrite an existing destination
- never delete files, folders, or marker files
- re-check source existence, source marker UUID, target absence, ancestor conflicts, descendant
  conflicts, and root boundaries immediately before each move
- stop execution on the first failed move step

Cross-device moves are not supported in MVP because reconcile moves are within one external root.
If the platform returns a cross-device or unsupported rename error, execution records failure and
stops.

### Journal Schema

Each execute run writes one JSON journal file under
`{vault}/.obsidian/plugins/external-note-folders/journal/{run-id}.json`.

Journal files contain:

- `schemaVersion`: `1`
- `runId`: UUID generated at execution start
- `startedAt`: ISO timestamp
- `completedAt`: ISO timestamp or `null`
- `planMutationSequence`: mutation sequence captured by the dry-run plan
- `externalRootPath`: canonical external root path
- `entries`: ordered move entries

Each move entry contains:

- `uuid`
- `notePath`
- `sourcePath`
- `targetPath`
- `startedAt`
- `completedAt`
- `outcome`: `success` or `failure`
- `message`: human-readable failure detail or `null`

Dry-run plans are not journaled. The journal is audit evidence only; recovery uses a fresh scan.

### Execute Confirmation

The execute confirmation must show:

- number of planned moves
- number of skipped/conflict rows
- external root path
- explicit statement that folders may contain unique files
- explicit statement that execution moves folders, never deletes them, and stops on first failure

Execution is allowed only if the current mutation sequence still matches the plan's captured
sequence and the user explicitly confirms.

### Path Identity Scope

Phase 1 uses the current platform-based path identity helper until a root-specific case-sensitivity
probe is implemented. The root-specific probe from ADR-0013 remains a future hardening item and
must be added before supporting external roots whose case-sensitivity differs from platform
defaults.

### Consequences

### Positive

- Planner, UI, executor, and tests can share one vocabulary
- Per-move conflicts are visible without blocking unrelated safe moves
- Journal data is stable enough for support and debugging

### Negative / Trade-offs

- Some safe-looking moves are skipped when marker topology is ambiguous
- Cross-device or link-heavy external-root setups remain unsupported in MVP

## Pros and Cons of the Options

### Encode planner categories directly in the UI

- Pros: Faster initial UI implementation
- Cons: Mixes safety policy with presentation; hard to test execution independently
- Why rejected: Phase 1 needs pure planner tests before mutation code

### Define a pure planner contract before UI and execution

- Pros: Testable, deterministic, and reusable by dry-run and execute paths
- Cons: More upfront design work
- Why accepted: Best fit for filesystem-moving behavior

### Treat all per-move conflicts as global integrity errors

- Pros: Simplest execute rule
- Cons: One unrelated occupied target would hide other valid moves from dry-run output
- Why rejected: Too coarse; conflicts should be scoped to affected UUIDs when scan integrity is
  otherwise valid

## More Information

### Non-Goals

- Cross-device move fallback by copy/delete
- Automatic cleanup of empty source parent directories
- Executing moves for unavailable vault UUIDs or orphan external UUIDs
- Root-specific case-sensitivity probing in this ADR

### References

- [ADR-0003](0003-no-deletions.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
- [ADR-0009](0009-status-model.md)
- [ADR-0011](0011-reconcile-execution-safety-model.md)
- [ADR-0012](0012-command-serialization-and-concurrency.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
