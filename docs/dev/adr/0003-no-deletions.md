---
status: "Accepted"
date: "2026-02-14"
decision-makers: "Maintainers"
---

# No Deletions (Trust Boundary)

## Context and Problem Statement

Deletion by plugins is high-risk, especially with ambiguous sync state, external roots that may be
partially available, and users reorganizing via the OS. The project aims to be safe and predictable.

## Decision Drivers

- Preserve user trust: no irreversible operations
- External roots may be incomplete or temporarily missing
- Avoid OS-specific trash/recycle-bin behavior in MVP
- Prevent accidental data loss

## Considered Options

* Auto-delete orphans
* Auto-quarantine orphans (move to `.orphaned/`)

## Decision Outcome

The plugin must not delete local files.

Specifically, it never deletes:
- Vault files
- External folders
- Marker files (`.exf`)

Allowed mutations are limited to:
- Writing UUID frontmatter into notes
- Creating a bound folder and writing `.exf`
- Moving bound folders via explicit reconcile (dry-run by default)

### Consequences

### Positive
- Strong safety guarantee
- Reduces fear of running reconcile/verify

### Negative / Trade-offs
- Orphan cleanup is manual
- External root can accumulate historical data

## Pros and Cons of the Options

### Auto-delete orphans
- Pros: Keeps external root “clean”
- Cons: High risk of deleting unsynced or intentionally retained data
- Why rejected: Too risky; breaks trust boundary

### Auto-quarantine orphans (move to `.orphaned/`)
- Pros: Safer than delete; reversible
- Cons: Still surprising; may move large trees; can break user workflows
- Why rejected: Still a form of “destructive” automation; not MVP

## More Information

### Non-Goals

- Automatic cleanup of external root

### Future Considerations

If any cleanup is added later, it must be explicit, opt-in, and reversible (trash/quarantine) with
clear previews and confirmations.

### References

- [ADR-0001](0001-vault-is-source-of-truth.md)
