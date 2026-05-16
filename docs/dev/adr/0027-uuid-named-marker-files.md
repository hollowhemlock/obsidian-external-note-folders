---
status: "Accepted"
date: "2026-05-16"
decision-makers: "Maintainers"
tags: "external-root, vault-model, status-model, release"
when_to_read: "Before changing marker filenames, marker migration, or external folder identity scanning."
supersedes: "ADR-0005, ADR-0014"
---

# UUID-Named External Folder Marker Files

## Context and Problem Statement

External Note Folders currently identifies bound external folders with a fixed
`.exnf` marker file whose payload is the note UUID. This works for single-device
assignment, but concurrent offline assignment can produce two different UUIDs
for the same note path. When the external root is synced, both devices write to
the same `.exnf` filename and the sync tool may rename one marker to a
tool-specific conflict filename that the plugin does not recognize.

The marker contract needs to preserve per-folder identity while avoiding marker
filename collisions during parallel UUID generation.

## Decision Drivers

- Preserve UUID-based identity across vault and external-root moves.
- Avoid path-only linking and central registries.
- Avoid sync-tool-specific conflict filename detection.
- Keep marker parsing strict and deterministic.
- Make the breaking marker-contract change explicit for release planning.
- Provide a migration path for existing fixed `.exnf` markers.

## Considered Options

* Keep fixed `.exnf` and document sync discipline.
* Keep fixed `.exnf` and detect sync-conflict sibling filenames.
* Replace per-folder markers with a central external-root registry.
* Rename markers to `.exnf-<uuid>`.
* Rename markers to `<uuid>.exnf`.

## Decision Outcome

Chosen option: "`<uuid>.exnf` marker filenames", because unique marker filenames
avoid the fixed `.exnf` filename collision while preserving per-folder marker
semantics.

This is a breaking marker-contract change and must ship as `2.0.0` when
implemented. This ADR does not itself bump package or manifest versions.

### Marker Contract

- A bound external folder is identity-bearing when it contains one or more
  marker files named `<uuid>.exnf`, where `<uuid>` is a canonical lowercase
  RFC 4122 UUID.
- The marker payload remains the strict single-line UUID format from ADR-0014:
  UTF-8, exact canonical lowercase UUID, writer emits trailing `\n`, parser
  accepts one optional trailing `\n`, and rejects BOM, `\r\n`, `\r`, extra
  content, extra lines, or non-canonical UUIDs.
- The filename UUID and payload UUID must match. A mismatch is a malformed
  marker and blocks mutation involving that folder.
- The note's `exnf` frontmatter UUID remains authoritative for selecting the
  current marker.
- If a folder contains the active note's `<uuid>.exnf` plus other `*.exnf`
  markers, the matching marker is current and the other markers are drift
  evidence: stale, orphaned, or misplaced cleanup candidates.
- New writes after implementation create only `<uuid>.exnf`; fixed `.exnf`
  markers are deprecated legacy markers.

### Legacy `.exnf` Deprecation Window

During the 2.0.0 migration window, scanners read both fixed `.exnf` markers and
new `<uuid>.exnf` markers:

- A legacy `.exnf` marker with a valid payload is treated as legacy binding
  evidence and reported as needing migration.
- If the corresponding `<uuid>.exnf` marker already exists with matching
  filename and payload, the new marker is authoritative and the legacy `.exnf`
  is stale cleanup evidence.
- If legacy `.exnf` and new `<uuid>.exnf` markers disagree, the folder is a
  marker conflict. The plugin reports the conflict and does not auto-resolve it.
- Malformed legacy markers remain errors for operations that would mutate or
  rely on that folder.
- No code path writes new fixed `.exnf` markers after the 2.0.0 marker-contract
  implementation lands.

Removing legacy `.exnf` read support requires a later ADR or explicit release
decision after users have had a migration window.

### Migration Contract

The implementation must include an explicit migration command or workflow:

- Scan the external root for legacy `.exnf` markers.
- Read each marker's UUID using the legacy strict parser.
- Plan a rename from `<folder>/.exnf` to `<folder>/<uuid>.exnf`.
- Show a dry-run plan and require explicit confirmation.
- Execute with journaled recovery consistent with existing reconcile/adoption
  patterns.
- Never overwrite an existing `<uuid>.exnf` marker. If the target marker already
  exists, report the row as blocked or already migrated.
- Do not delete legacy markers automatically outside the migration operation.

### Consequences

Positive:

- Concurrent assignment no longer collides at the marker filename layer.
- Sync-conflict recovery no longer depends on recognizing tool-specific sibling
  filenames.
- Multiple markers in one folder become first-class drift evidence rather than
  a special global integrity failure.

Negative / trade-offs:

- Marker discovery changes from checking one fixed filename to enumerating
  `*.exnf` candidates.
- Marker files become visible in file managers instead of hidden by a leading
  dot on Unix-like systems.
- Existing users need an explicit migration path.
- Existing ADR-0005 and ADR-0014 are superseded for the marker filename
  contract, though their per-folder identity and strict payload principles
  continue here.

### Confirmation

Implementation is in line with this ADR when tests prove:

- New marker writes create `<uuid>.exnf` and never fixed `.exnf`.
- Filename UUID and payload UUID must match.
- Legacy `.exnf` markers are read as deprecated binding evidence during the
  migration window.
- New markers take precedence over matching legacy markers.
- Conflicting legacy/new marker evidence blocks mutation and is reported.
- Migration dry-run and execution rename valid legacy markers without
  overwriting existing new markers.
- Drift, verify, open recovery, reconcile, and adoption all enumerate
  `*.exnf` markers and report stale/orphan/misplaced markers.

## Pros and Cons of the Options

### Keep fixed `.exnf` and document sync discipline

- Pros: No code or migration work.
- Cons: Leaves concurrent assignment as a user discipline problem and does not
  prevent marker filename collisions.
- Why rejected: Documentation-only mitigation is weaker than conflict-tolerant
  design for a cross-device identity feature.

### Keep fixed `.exnf` and detect sync-conflict sibling filenames

- Pros: Preserves current marker filename.
- Cons: Conflict filename patterns vary by sync tool and version.
- Why rejected: The collision still occurs; the plugin only tries to recover
  after tool-specific renaming.

### Replace per-folder markers with a central external-root registry

- Pros: One file can store richer metadata.
- Cons: Reintroduces path stability as a dependency because the registry maps
  UUIDs to paths.
- Why rejected: Per-folder markers are what let bindings survive folder moves
  outside Obsidian.

### Rename markers to `.exnf-<uuid>`

- Pros: Avoids filename collisions while preserving a leading dot.
- Cons: Uses a less conventional extension placement and less direct glob
  semantics.
- Why rejected: `<uuid>.exnf` is simpler to enumerate and communicate.

### Rename markers to `<uuid>.exnf`

- Pros: Avoids fixed-name collisions, keeps a clear marker extension, and makes
  duplicate/stale markers explicit drift evidence.
- Cons: Requires a breaking migration and visible marker files.
- Why accepted: It best preserves UUID identity under concurrent assignment and
  cross-device sync.

## More Information

### Non-Goals

- Auto-resolving vault-side frontmatter sync conflicts.
- Inferring identity from folder names or paths alone.
- Deleting legacy markers outside an explicit migration operation.
- Removing legacy `.exnf` read support in the same decision that introduces
  `<uuid>.exnf`.

### References

- [UUID Marker Filename Design Notes](../plans/uuid-marker-filenames.md)
- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0014](0014-exnf-marker-format-and-validation.md)
- [ADR-0025](0025-active-note-open-recovery-scan.md)
- [ADR-0026](0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md)

