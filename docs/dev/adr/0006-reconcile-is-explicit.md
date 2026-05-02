---
status: "Accepted"
date: "2026-02-14"
decision-makers: "Maintainers"
---

# Reconcile Is Explicit and Dry-Run by Default

## Context and Problem Statement

Automatically moving external folders in response to vault renames/moves is risky and surprising,
especially with partial sync and external roots that may not be present. Users want a safe checkpoint.

## Decision Drivers

- Minimize surprise filesystem mutation
- Keep MVP free of watchers
- Allow preview before changes
- Preserve no-deletions trust posture

## Considered Options

* Auto-reconcile on vault move/rename events
* No dry-run (always execute)

## Decision Outcome

External reorganization occurs only via an explicit Reconcile command.

- Reconcile runs in dry-run mode by default
- Execution requires explicit confirmation
- Reconcile moves existing bound folders to match current vault structure “as much as possible”
- Reconcile does not delete anything

### Consequences

### Positive
- Predictable, reviewable changes
- Safer behavior on multi-machine setups

### Negative / Trade-offs
- Users must run reconcile when they want external paths updated

## Pros and Cons of the Options

### Auto-reconcile on vault move/rename events
- Pros: “Just works” feel
- Cons: Hard to undo; risk on partial sync; requires watchers
- Why rejected: Too risky for MVP; violates explicit-change model

### No dry-run (always execute)
- Pros: Fewer steps
- Cons: Higher risk; conflicts discovered too late
- Why rejected: Dry-run is essential to safety

## More Information

### Non-Goals

- Background synchronization between vault and external root

### Future Considerations

Auto-reconcile may be added later only after proven invariants, and should start as a prompt/suggestion.

### References

- [ADR-0003](0003-no-deletions.md)
- [ADR-0011](0011-reconcile-execution-safety-model.md)
