# ADR-0011: Reconcile Execution Safety Model (Ordering, Journal, Recovery)

**Status:** Accepted
**Date:** 2026-02-19
**Participants:** Maintainers

## Context

Reconcile can move existing external bound folders to new target paths derived from vault state.
Interrupted execution (process crash, power loss, permission error) can leave partial filesystem state.
No-delete is necessary but not sufficient for trust if recovery is ambiguous.

## Decision Drivers

- Preserve trust under interruption and partial failure
- Keep behavior deterministic and auditable
- Ensure retries are safe (idempotent where possible)
- Stay aligned with explicit reconcile and no-deletion constraints

## Decision

Reconcile execution uses an audit journal and relies on re-scan for recovery.

- A reconcile run has two phases: `plan` then `execute`.
- Execution begins only from a user-confirmed immutable plan snapshot.
- Required operation ordering for each move:
  1. Re-validate preconditions (source exists, destination policy still valid)
  2. Execute move (`src -> dst`) with no-overwrite semantics
  3. Verify postconditions (marker UUID and path expectations)
- On any failed step, stop execution and do not continue best-effort.
- Journal each move for auditability: source, destination, timestamp, outcome
  (success/failure). Include a run ID for grouping.
- Recovery model: re-scan, not replay. On next reconcile invocation, the plugin
  re-scans both vault and external root and builds a fresh plan from current
  state. Already-applied moves are naturally reflected in the re-scan results.
  No resume/abort UX is needed.

### Why re-scan is sufficient for recovery

Moves are within a single external root (same filesystem, atomic `rename()`).
The plugin never deletes anything. If reconcile is interrupted after 3 of 5
moves, the 3 moved folders are in their new locations, the 2 unmoved folders
are in their old locations. A fresh scan sees the actual state and generates a
correct plan for the remaining moves. The journal adds auditability but is not
needed for correctness.

## Alternatives Considered

### A. No journal; rely on in-memory flow only
- Pros: Less code and storage
- Cons: No audit trail for debugging or support
- Why rejected/accepted: Rejected; auditability is valuable even without
  recovery semantics

### B. Full transactional filesystem abstraction
- Pros: Stronger atomic model
- Cons: Not practical cross-platform for directory-tree moves
- Why rejected/accepted: Rejected for MVP complexity and OS limitations

### C. Journal with pending/applied/failed state machine and resume/abort UX
- Pros: Explicit recovery decisions after interruption
- Cons: Significant implementation complexity for a recovery path that re-scan
  already handles; resume/abort UX is confusing for users who don't understand
  journal state
- Why rejected/accepted: Rejected; re-scan provides correct recovery with less
  complexity and better UX

## Consequences

### Positive
- Clear audit trail for debugging and support
- Simple recovery model: just run reconcile again
- Lower implementation complexity than state-machine recovery

### Neutral
- Adds small metadata overhead for journal storage

### Negative / Trade-offs
- No explicit "pick up where you left off" — user must re-confirm a new plan
  after interruption

## Non-Goals

- Providing true ACID transactions across arbitrary filesystem operations
- Automatic rollback of all partially applied moves in every failure mode
- Resume/replay of interrupted reconcile runs

## Future Considerations

If journal format changes, migration must preserve old run readability.
Future auto-reconcile features must keep the same journaled execution guarantees.

## References

- [ADR-0003](0003-no-deletions.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
- [ADR-0009](0009-status-model.md)
