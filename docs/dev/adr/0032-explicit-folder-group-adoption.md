---
status: "Accepted"
date: "2026-09-15"
decision-makers: "Maintainers"
tags: "adoption, safety, vault, recovery"
---

# Explicit Folder Group Adoption

## Context

The unmarked-leaf report exposes external trees users want to bind one at a time.
Sometimes the external layout is the desired note layout. Bulk exact adoption
cannot create notes or accept explicitly selected notes at different paths.

## Decision

The Obsidian report may offer a previewed, confirmed adoption of one real folder
group and its entire subtree. The root is excluded. Grouping may include terminal
leaves. Filters never restrict mutation scope. Offline HTML remains read-only.

This is a narrow exception to ADR-0008: users may explicitly create a matching
note or relocate a selected note to match an external folder. There is no watcher,
bulk reverse synchronization, external move, or per-binding layout authority.
Reconcile remains note-driven. Old basenames are retained as aliases on rename;
Obsidian's own link-update behavior is retained.

Core owns suggestions and plans; adapters own effects. Name and alias matches are
review evidence only. A chosen existing UUID requires uniqueness proof. Ignore
settings block ignored targets, while physical evidence throughout the selected
subtree must exclude nested markers even in hidden or ignored branches for existing-UUID
reuse and legacy journals. For new-UUID adoption, the scoped policy below applies. Unassigned
descendant notes may remain after explicit acknowledgment. Existing identities and
unchecked overlapping topology block adoption. Bulk adoption retains ADR-0026.

## Execution and Recovery

### Scoped new-UUID adoption (2026-10-06)

New-UUID selected-folder adoption and existing-unmarked-folder setup inspect the
target, ancestors, and included descendants through the Git-aware exclusion engine.
Tracked directories remain included; all local marker filenames are inspected
regardless of file-level ignores. Excluded targets and excluded ancestors block.
Intentional omissions strictly below the target are disclosed in a collapsed
**Excluded from checks** section, without an acknowledgment checkbox. Required read
failures, unsafe paths, unignored links, and repository failures block. Unrelated
external failures do not. Fresh vault identities, note bytes, destinations, and
reservations remain authoritative, including topology at a different expected path.

Available completed report evidence supplies known overlapping marker locations,
including malformed and unchecked evidence. Preview, execution, verification, and
resume recheck these locations even if they have since become excluded. An unreadable
known location cannot clear a conflict. Scoped inspection is not exhaustive discovery.

Optional validated policy context captures roots, exclusions, known evidence, and
omissions in plans and journals. Missing context means legacy strict checks; invalid
context is rejected. Changed omission scope requires another confirmation. After a
partial write, recovery previews updated scope and persists it in the same journal
before continuing, retaining UUID, note intent, stage, and verified output. Only that
journal is exempt from its own overlap restriction; other pending operations block.
Uncertain note renames still require manual verification. No replacement operation or
UUID is generated. Bulk adoption, imported restoration, and other repairs are unchanged.

### Journal effects

Under the mutation lock, fresh scans validate the confirmed plan. A dedicated,
versioned journal records intent before effects and completion afterward. Execution
orders marker verification, note identity/aliases, optional relocation, and final
verification. Required directories are created without replacing existing paths.
Original and prepared note content support recovery verification. Journal updates
use replacement of a temporary file; invalid journals fail closed.

Recovery is available through a plugin command independently of report membership.
An ambiguous rename must not be repeated automatically: the user must inspect note
paths and affected links. Explicit verification can finish a move already completed
after that inspection. No cleanup or rollback deletes user data. Closing the report
does not interrupt an active mutation; interrupted runtime effects remain journaled.

### Verified report revisions (2026-10-08)

The report preserves the original completed scan for forensic exports and publishes
immutable working revisions after verified adoption and resume. This supersedes the
original snapshot-only presentation contract. Completion includes the operation,
roots, mutation revision, note paths, UUID, affected folders, and unmodified final
verification evidence. The planner masks its own effects only in a derived view.
Publish after journal completion and mutation-sequence advancement; presentation
failure cannot turn a completed write into a pending journal.

Merge positive checks and established absences only. Skipped and unreadable paths
retain prior evidence. Rebuild derived status, indexes, counts, and navigation in
memory. Filtered verification does not narrow an unfiltered report's discovery scope.
Each report retains its original scan times and discloses later verification times.
Current status exports pin one working revision at invocation, while raw forensic
exports retain the original scan. CSV schemas and confidence meanings are unchanged.

Selection, expansion, filters, and scroll position survive updates. An adopted row
leaving an adoptable-only filter remains temporarily visible until navigation leaves
it, without becoming a candidate or export match. Healthy or Path differs remains
primary; session history is secondary and distinguishes direct from descendant
changes. Temporary action disabling does not change unrelated evidence colors.
Late, incompatible, duplicate, or superseded events cannot replace newer results.
Failed presentation offers read-only targeted verification; broader refresh is needed
only without a usable baseline or safe affected scope.

Suggestions are visible on opening. Fresh local candidate reads can preselect one
suitable exact-name candidate after competitors finish checking. Ambiguity and
unreadable competitors require a choice; existing identity still requires its own
checks. Selection starts preview immediately and defaults to binding without moving.
Search does not scan the external tree. Explicit confirmation remains mandatory.

Bound repeated work: no scan for a no-op move, shared in-flight previews, deduplicated
inspection targets, and Git context shared within one inspection. Read notes through
at most eight concurrent tasks and merge independent results in traversal order.
Always reread bytes before using a workflow-local, byte-bounded 16 MiB parse cache.
Cancellation settles outstanding work. No cross-operation filesystem cache, time-based
authorization, dependencies, settings, or journal migration is introduced.

## Validation

Pure planning and journal tests cover identity, topology, path round trips, aliases,
and interruptions between effects and journal completion. Obsidian sandbox tests
cover creation, relocation, link handling, and independent interrupted-move recovery.
