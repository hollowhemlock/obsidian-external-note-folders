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
subtree must exclude nested markers even in hidden or ignored branches. Unassigned
descendant notes may remain after explicit acknowledgment. Existing identities and
unchecked overlapping topology block adoption. Bulk adoption retains ADR-0026.

## Execution and Recovery

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

The report preserves browsing position and displays session overlays after mutation.
Its counts and CSV exports describe the original scan and disclose staleness until
refresh. No adoption action silently substitutes new data into the captured snapshot.

## Validation

Pure planning and journal tests cover identity, topology, path round trips, aliases,
and interruptions between effects and journal completion. Obsidian sandbox tests
cover creation, relocation, link handling, and independent interrupted-move recovery.
