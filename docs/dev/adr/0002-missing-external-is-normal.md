# ADR 0002: Missing External Folders Are Normal

**Status:** Accepted  
**Date:** 2026-02-14

## Context

On many machines, not all external folders will be present (external drive not attached, not synced,
or never created). This must not be treated as a failure.

## Decision Drivers

- External root is optional and may be partial by design
- Avoid false alarms and “everything is broken” UX
- Prevent unsafe auto-creation or destructive “cleanup”
- Support multi-machine workflows naturally

## Decision

It is expected that there are more UUIDs in the vault than bound folders in the external root.

- Vault UUID with no external bound folder is **Unavailable** (informational)
- Reconcile skips missing external folders
- Creation happens via explicit command (e.g., “Open External Folder”), not by default reconcile

## Alternatives Considered

### A. Treat missing external as error
- Pros: Forces completeness
- Cons: Noisy, incorrect in common setups, pressures unsafe automation
- Why rejected: External absence is normal and often intentional

### B. Auto-create all missing externals during reconcile
- Pros: Completeness by default
- Cons: Implicit mutation; creates folders for notes that don’t need them
- Why rejected: Too surprising for MVP; violates “explicit changes” posture

## Consequences

### Positive
- Works cleanly with external drives and partial sync
- Verification output becomes trustworthy

### Negative / Trade-offs
- Users may need an explicit action to materialize an external folder

## Non-Goals

- Enforcing one-to-one completeness between vault and external root

## Future Considerations

If bulk creation is added later, it must be opt-in and clearly separate from reconcile moves.
