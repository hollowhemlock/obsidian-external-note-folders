# ADR-0012: Command Serialization and Concurrency Boundaries

**Status:** Proposed
**Date:** 2026-02-19
**Participants:** Maintainers

## Context

Multiple user commands can be triggered in close succession (`Verify`, `Reconcile`, `Open External Folder`,
`Assign UUID`). Concurrent runs can observe inconsistent state and apply conflicting mutations.

## Decision Drivers

- Prevent race conditions during filesystem mutation
- Keep reconcile plans valid from confirm to execute
- Preserve deterministic, debuggable command behavior
- Minimize surprising command interactions

## Decision

The plugin enforces a single-flight command lock for mutation-capable commands.

- Commands are split into classes:
  - Read-only: `Verify`
  - Mutating: `Reconcile (execute)`, `Open External Folder` (when creating), `Assign UUID` (when writing)
- Only one mutating command may run at a time.
- If a mutating command is in progress:
  - new mutating commands are rejected with a clear user notice
  - read-only commands may run but must be labeled as possibly stale
- Reconcile dry-run plan confirmation must re-check that no other mutating command has completed since plan creation.
- Lock lifecycle is explicit: acquire before preflight, release only after success/failure finalization.

## Alternatives Considered

### A. Fully concurrent commands
- Pros: Maximum responsiveness
- Cons: High race risk, invalid plans, non-deterministic outcomes
- Why rejected/accepted: Rejected for safety and predictability

### B. Global lock for all commands (including Verify)
- Pros: Simplest mental model
- Cons: Unnecessary blocking; poor UX for read-only diagnostics
- Why rejected/accepted: Rejected; too restrictive for low-risk reads

## Consequences

### Positive
- Lower risk of conflicting operations and stale-plan execution
- Easier reproduction and debugging of issues

### Neutral
- Users may need to re-run commands that were rejected due to lock contention

### Negative / Trade-offs
- Additional state machine and UX handling for lock conflicts
- Slightly higher complexity in command orchestration

## Non-Goals

- Multi-operation parallel mutation pipelines
- Background queueing/retry service for deferred command execution

## Future Considerations

If background automation is introduced later, it must integrate with the same lock model and expose
visibility into queued/running operations.

## References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0006](0006-reconcile-is-explicit.md)
- [ADR-0008](0008-no-reverse-reconciliation.md)
