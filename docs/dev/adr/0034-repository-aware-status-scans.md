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
and tracked-prefix caches belong to one scan. Normal nonzero exits during initial
repository or index validation skip a nested repository before its contents are
scanned. These boundaries remain unchecked and are reported separately from
intentional exclusions and filesystem read failures. This permits healthy
siblings to be inspected when, for example, a moved worktree retains a stale
metadata reference.

Recovery uses structured process outcomes, never Git diagnostic text. Root or
containing-repository validation failures, launch errors, timeouts, output limits,
signal termination, unexpected stderr from successful commands, and runtime
ignore-query/protocol/shutdown failures remain fatal. Parent ignore queries are
outside the nested repository validation recovery boundary. Failed and cancelled
scans preserve the previous completed snapshot and mode; recovered scans publish
new results with warnings. No approximate fallback or worktree repair is applied.

Fatal failures retain copyable diagnostics for the latest failed attempt outside
the completed snapshot. Scan details opens this separate section with attempted
roots, mode, time, affected path when available, and the complete error message.
It remains available during retries, including before any successful scan. A
completed or cancelled retry clears it; a new failure replaces it. Snapshot
coverage and exports continue to describe only the completed scan.

The status view separates Scan from Filter. Root context appears first. Scan owns
snapshot metrics, progress, warnings, diagnostics, whole-snapshot exports, and
the rescan actions at its end. Filter owns display controls, matching metrics,
and filtered exports. Snapshot totals and scan outcomes remain stable through
display queries and action feedback. Matching metrics exclude context ancestors
and temporary navigation reveals, and include collapsed matches. Typed optional
metrics preserve compatibility with older models without parsing summary text;
unavailable totals are displayed as unknown. Passive report text is selectable.

Two actions in Scan select filtered or unfiltered scanning. The unfiltered
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

### Observed binding health (2026-10-04)

Status health describes checked note/folder evidence independently of exhaustive
coverage. A readable directory and matching valid note/marker identity at the
expected path are healthy unless a conflict affecting that binding was observed.
Unrelated vault gaps, ignored branches, skipped repositories/links, and unreadable
descendants do not downgrade that binding. Drift remains a review state. Unchecked
local identity evidence prevents healthy classification, even if another local
marker matches. Observed valid nested markers mark all overlapping marked
participants as conflicts; unmarked containers do not inherit those conflicts.

Ancestor descriptions and bound-descendant counts use the same checked-binding
predicate. Scan-wide coverage confidence is retained for exports and existing
repair eligibility, never substituted with displayed health. Mutation safety
rules are unchanged. This refines product-intent principles 6 and 8 and ADR-0009:
scan warnings describe their affected evidence without making healthy siblings
appear broken.

Expected omissions appear as a neutral scope notice once in Scan. Unexpected
read/identity failures and skipped repositories have a compact warning linking to
grouped diagnostics. Exclusions, links, failures, and marker findings retain their
paths and provenance in collapsed, paginated groups. Unfiltered scans remain
optional diagnostics, not a prerequisite for green. Bound-folder details collapse
adoption restrictions while keeping recovery and stale-result actions visible.
The status CSV schema and legacy exhaustive-coverage confidence values are unchanged.

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
