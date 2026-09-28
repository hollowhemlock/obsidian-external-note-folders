---
status: "Accepted"
date: "2026-09-27"
decision-makers: "Maintainers"
tags: "status, scanning, git, safety"
---

# Repository-Aware Status Scans

## Context

Broad external roots contain repositories and generated directories. Exhaustive
status scanning by default wastes time and obscures useful folders. Separate
status patterns and a persistent skip toggle also duplicate configuration.

## Decision

External folder status defaults to shared external-root exclusions plus Git's
ignore engine, including nested files, local excludes, and global configuration.
Git owns syntax and precedence. Tracked descendants prevent Git directory pruning;
explicit plugin exclusions take precedence. `.git` metadata is excluded. Other
generated-directory defaults are removed. All markers in included directories
are inspected even when file-level Git patterns match them.

Repositories, worktrees, and submodules have independent contexts. Excluded
parents are pruned before discovering nested repositories. An external root inside
a repository inherits its repository's rules. The configured root itself is
inspected; directory filtering governs descendants.

Git runs read-only, without a shell, with bounded streaming queries. Processes
and tracked-prefix caches belong to one scan. Git discovery, index, protocol,
timeout, or ignore-reading failures are fatal, not skipped-directory warnings.
Failed and cancelled scans preserve the previous completed snapshot and mode.

Two top-level actions select filtered or unfiltered scanning. The unfiltered
action bypasses Git and shared external exclusions, but not template exclusions,
filesystem access restrictions, or link boundaries. Scan mode is not persisted.
Legacy status settings are removed without migration; no deployed users depend
on them. The shared pattern setting retains its documented restricted syntax.

Unchecked branches remain in the internal topology and coverage model, then are
hidden in the normal tree. Virtual expected paths inherit unchecked ancestor
coverage. Hiding cannot create physical leaves or relax adoption restrictions.
Known note identities under hidden boundaries remain in a visible warning summary.
Scan details and exports retain exclusion reasons and Git rule provenance.

This policy changes only status scans. Standalone audits and mutation preflights
retain their current defaults and authoritative safety checks.

## Consequences

Filtered scanning requires Git on the desktop application's PATH. There is no
approximate fallback; unfiltered scanning remains available without Git. Global
Git configuration can change results between machines and is disclosed through
the responsible rule. Results are live observations, not atomic filesystem or
Git snapshots. New scans reload rules rather than maintaining a watcher.

## Validation

Storage tests exercise real Git pattern syntax, global/local rules, tracked
paths, nested repositories, worktrees, submodules, and failures. Protocol tests
cover chunk boundaries, negation, no matches, errors, timeout, and cancellation.
Core/session tests preserve hidden coverage and prior snapshots; sandbox smoke
tests cover scan controls and mode disclosure. State-matrix rows R30 and R31
track the new behavior.
