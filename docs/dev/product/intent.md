# Product Intent

Status: active high-level product intent authority

Last reviewed: 2026-05-26

This document is the authority for high-level product intent for External Note Folders. ADRs refine,
constrain, and implement this intent for specific architectural, safety, command, testing, and
release decisions.

If a lower-level ADR or implementation detail conflicts with this document's high-level product
intent, the conflict should be resolved explicitly by updating this document, amending or
superseding the ADR, or recording a new ADR. Do not let low-level implementation details silently
change product intent.

This document does not automatically trigger code changes. It steers new work and future design
decisions at the product level; concrete behavior changes still need normal implementation planning,
tests, and, when architectural or safety-significant, ADR refinement.

## Product Promise

External Note Folders lets an Obsidian note keep a durable, cross-platform relationship with an
external folder without requiring the folder path to stay fixed.

The relationship is identity-based:

- the vault note stores a canonical UUID in `exnf` frontmatter;
- the external folder stores the same UUID in a marker file;
- current folder paths are derived from the current vault note path, but identity survives note and
  folder moves.

References:

- [ADR-0001: Vault Is the Source of Truth](../adr/0001-vault-is-source-of-truth.md)
- [ADR-0015: External Folder Path Derivation Rule](../adr/0015-external-folder-path-derivation.md)
- [ADR-0027: UUID-Named External Folder Marker Files](../adr/0027-uuid-named-marker-files.md)

## Governance

Product intent governs high-level product direction. It should be consulted before writing new ADRs,
changing command semantics, changing filesystem mutation behavior, adding broad test fixtures, or
reworking user-visible safety/status behavior.

Product intent changes are allowed as direct documentation changes when they clarify existing
direction. If a product intent change contradicts an accepted ADR, the same work must also amend,
supersede, or explicitly schedule replacement of the affected ADR.

ADRs should name the product-intent principle they refine. Tests and fixtures should name the product
intent, ADR, or state-matrix item they prove when the behavior is safety-relevant or otherwise
non-obvious.

This governance is intentionally not self-executing:

- updating product intent does not automatically require code changes;
- code changes still require normal planning, review, tests, and validation;
- when product intent reveals implementation drift, create explicit follow-up work rather than
  silently folding unrelated changes into the intent update;
- low-level implementation details should not become product direction unless this document or an
  accepted ADR says so.

## Target User

The product is for users who organize notes in Obsidian while storing related non-note material in a
normal filesystem tree outside the vault.

It is especially justified for users who:

- reorganize notes and folders over time;
- use a broad external root that may contain unrelated work;
- use multiple operating systems or sync tools;
- need confidence that plugin commands will not delete or unexpectedly move important files.

## Primary Workflow

The main workflow is active-note driven:

1. User works in an Obsidian note.
2. User runs `Open external folder`.
3. If the note has a valid identity and the expected folder is correctly bound, the folder opens
   immediately.
4. If the expected folder is not correctly bound, the plugin shows focused recovery information for
   that note.
5. Root-wide diagnosis and repair remain explicit commands: drift report, adoption, reconcile, and
   migration.

References:

- [ADR-0023: Open External Folder Does Not Assign Identity](../adr/0023-open-external-folder-does-not-assign-identity.md)
- [ADR-0025: Active-Note Open Recovery Scan](../adr/0025-active-note-open-recovery-scan.md)

## Product Principles

### 1. Vault Identity Is Authoritative

The vault is the source of truth for note identity. External folders reflect vault identity; they do
not define it.

External state may be incomplete, unavailable, stale, or reorganized outside Obsidian. That state is
reported, not used to automatically rewrite vault identity.

References:

- [ADR-0001](../adr/0001-vault-is-source-of-truth.md)
- [ADR-0008](../adr/0008-no-reverse-reconciliation.md)

### 2. Missing External Folders Are Normal

A note with `exnf` may not have a corresponding external folder on a given machine. That is
informational, not corruption.

Creation happens only through explicit user action.

References:

- [ADR-0002: Missing External Folders Are Normal](../adr/0002-missing-external-is-normal.md)
- [ADR-0009: Explicit Status Model](../adr/0009-status-model.md)

### 3. No Deletions

The plugin must not delete vault files, external folders, or marker files.

Cleanup of orphaned folders, stale markers, or historical data remains manual unless a future
accepted decision defines an explicit, opt-in, reversible cleanup workflow.

Reference:

- [ADR-0003: No Deletions](../adr/0003-no-deletions.md)

### 4. Explicit Mutation Over Automation

The plugin should prefer explicit commands, previews, confirmations, and dry-runs over background
automation.

It does not run watchers that automatically reconcile vault and external-root changes. Mutating
commands are serialized and preflighted.

References:

- [ADR-0006: Reconcile Is Explicit and Dry-Run by Default](../adr/0006-reconcile-is-explicit.md)
- [ADR-0012: Command Serialization and Concurrency Boundaries](../adr/0012-command-serialization-and-concurrency.md)
- [ADR-0022: Reconcile Planner and Execution Contract](../adr/0022-reconcile-planner-and-execution-contract.md)

### 5. Fail Closed On Ambiguous Filesystem Evidence

When marker, path, root-boundary, duplicate identity, malformed identity, or stale execution evidence
is ambiguous, mutating commands must block the affected operation or the whole command according to
the relevant ADR.

Warnings should be visible. Silent fallback is worse than asking the user to decide.

References:

- [ADR-0009](../adr/0009-status-model.md)
- [ADR-0013: Filesystem Boundary and Path Identity Policy](../adr/0013-filesystem-boundary-and-path-identity.md)
- [ADR-0022](../adr/0022-reconcile-planner-and-execution-contract.md)

### 6. Broad Roots Are Supported By Pruning, Not Guessing

Users may point the plugin at a broad external root that contains unrelated source trees, fixtures,
temporary folders, or historical marker evidence.

The product should let safe rows proceed without requiring the entire root to be pristine. It should
not compensate with fuzzy identity inference.

References:

- [ADR-0026: Safe Partial Exact Adoption with External Root Ignore Patterns](../adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md)
- [ADR-0013](../adr/0013-filesystem-boundary-and-path-identity.md)

### 7. Exact Identity Beats Path Similarity

UUID identity is authoritative. Paths are useful for expected location and human readability, but
path similarity alone must not create bindings.

Adoption and recovery can use exact derived paths or exact normalized name candidates where accepted
by ADRs, but fuzzy, suffix, tree-tail, or basename-only binding is rejected unless a future accepted
decision changes that.

References:

- [ADR-0015](../adr/0015-external-folder-path-derivation.md)
- [ADR-0025](../adr/0025-active-note-open-recovery-scan.md)
- [ADR-0026](../adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md)

### 8. Reports Should Minimize Silent Failure

If a known note identity points to a problematic, ignored, missing, malformed, duplicate, or occupied
state, the user should see that state in the appropriate command output.

Ignored linked folders are not treated as healthy, missing, drifted, or reconciled. They are
reported as ignored/unchecked so the user can decide whether to remove the note identity, move the
note, or amend ignore settings.

References:

- [ADR-0009](../adr/0009-status-model.md)
- [ADR-0026](../adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md)

## Command Intent

| Command | Product intent | Mutation posture | Governing references |
| --- | --- | --- | --- |
| Assign external folder identifier | Explicitly create vault note identity. | Writes vault frontmatter only after preflight. | [ADR-0001](../adr/0001-vault-is-source-of-truth.md), [ADR-0007](../adr/0007-uuid-regeneration-and-manual-edits.md) |
| Open external folder | Navigate from active note to its bound folder and provide active-note recovery when needed. | May create/adopt external folder state only for an already-identified note. Never creates note identity. | [ADR-0023](../adr/0023-open-external-folder-does-not-assign-identity.md), [ADR-0025](../adr/0025-active-note-open-recovery-scan.md) |
| Adopt existing external folders | Bind exact safe note/folder matches in mixed roots. | Marker first, frontmatter second, journaled, row-local safe. | [ADR-0026](../adr/0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md) |
| Report external folder drift | Explain current vault/external-root mismatch without mutation. | Read-only. | [ADR-0009](../adr/0009-status-model.md), [ADR-0028](../adr/0028-core-fixture-semantics-with-cli-smoke.md) |
| Reconcile external folders | Move existing bound folders to current note-derived paths. | Dry-run first, explicit confirmation, journaled, no delete, no overwrite. | [ADR-0006](../adr/0006-reconcile-is-explicit.md), [ADR-0011](../adr/0011-reconcile-execution-safety-model.md), [ADR-0022](../adr/0022-reconcile-planner-and-execution-contract.md) |
| Migrate legacy marker files | Move users from fixed `.exnf` markers to `<uuid>.exnf` markers. | Dry-run first, explicit confirmation, journaled, no overwrite. | [ADR-0027](../adr/0027-uuid-named-marker-files.md) |

## Priority Order When Goals Conflict

Use this product-level order when deciding behavior. ADRs may refine how a principle applies inside
a specific command or subsystem, but they should not silently invert this order without updating this
document.

1. Preserve user data and trust.
2. Stay inside the configured external-root boundary.
3. Preserve vault identity authority.
4. Avoid silent failure or invisible drift.
5. Prefer explicit user confirmation over automation.
6. Keep safe unrelated rows actionable when root-wide state is mixed.
7. Preserve fast active-note open behavior for already-correct bindings.
8. Keep implementation testable through pure core models and focused integration checks.

References:

- [ADR-0003](../adr/0003-no-deletions.md)
- [ADR-0013](../adr/0013-filesystem-boundary-and-path-identity.md)
- [ADR-0025](../adr/0025-active-note-open-recovery-scan.md)
- [ADR-0028](../adr/0028-core-fixture-semantics-with-cli-smoke.md)

## Non-Goals

The current product intent excludes:

- bidirectional synchronization between vault and external root;
- automatic deletion or cleanup of external folders or marker files;
- automatic reverse reconciliation from external folders into vault notes;
- background watchers that mutate vault or external-root state;
- fuzzy folder adoption;
- full support for symlink/junction traversal;
- using external folder names as the source of identity;
- treating missing external folders as corruption;
- hiding ignored bound-folder state from users.

Future work may revisit some of these, but only through explicit product/ADR updates.

## Current Gaps In Product Intent

The current repo has strong safety and command-level intent, but these areas are not yet expressed as
complete product requirements:

- target personas beyond the broad "Obsidian notes plus external folders" workflow;
- success metrics for the plugin;
- performance expectations for very large broad roots;
- support policy for sync tools and multi-device setups;
- long-term policy for legacy `.exnf` read support after the migration window;
- whether any future cleanup/quarantine feature should exist;
- how high-level product requirements should trace into tests and fixtures.

These gaps should be handled as product intent updates before implementation details are chosen.
