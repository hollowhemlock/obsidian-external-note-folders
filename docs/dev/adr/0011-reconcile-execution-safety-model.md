# ADR-0011: Reconcile Execution Safety Model (Ordering, Journal, Recovery)

**Status:** Proposed
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

Reconcile execution must use an explicit operation journal and a defined ordering model.

- A reconcile run has two phases: `plan` then `execute`.
- Execution begins only from a user-confirmed immutable plan snapshot.
- Before each mutation, append a journal entry (`pending`); after success, mark entry `applied`.
- Required operation ordering for each move:
  1. Re-validate preconditions (source exists, destination policy still valid)
  2. Execute move (`src -> dst`) with no-overwrite semantics
  3. Verify postconditions (marker UUID and path expectations)
- On any failed step, stop execution and mark run `incomplete`; do not continue best-effort.
- On next reconcile invocation, detect incomplete journal state and surface explicit recovery options:
  - verify-and-resume unfinished plan where safe
  - abort-resume and generate a new plan
- Reconcile operations must be idempotent against already-applied entries.

## Alternatives Considered

### A. No journal; rely on in-memory flow only
- Pros: Less code and storage
- Cons: Crash leaves ambiguous state; no deterministic resume path
- Why rejected/accepted: Rejected for trust-critical mutation flow

### B. Full transactional filesystem abstraction
- Pros: Stronger atomic model
- Cons: Not practical cross-platform for directory-tree moves
- Why rejected/accepted: Rejected for MVP complexity and OS limitations

## Consequences

### Positive
- Clear recovery posture after interruption
- Better user trust and supportability through auditable execution history

### Neutral
- Adds small metadata overhead for journal storage and maintenance

### Negative / Trade-offs
- More implementation complexity in reconcile executor
- Requires explicit stale-journal handling UX

## Non-Goals

- Providing true ACID transactions across arbitrary filesystem operations
- Automatic rollback of all partially applied moves in every failure mode

## Future Considerations

If journal format changes, migration must preserve old run readability and recovery decisions.
Future auto-reconcile features must keep the same journaled execution guarantees.

## References

- [ADR-0003](0003-no-deletions.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
- [ADR-0009](0009-status-model.md)
