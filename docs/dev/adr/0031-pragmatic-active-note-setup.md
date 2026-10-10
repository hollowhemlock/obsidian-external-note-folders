---
status: "Accepted"
date: "2026-09-11"
decision-makers: "Maintainers"
tags: "external-root, safety, vault-model, workflow"
when_to_read: "Before changing active-note setup, imported marker restoration, or setup journaling."
---

# Pragmatic Active-Note Setup and Explicit Marker Restoration

## Context

Assigning note identity currently verifies the complete external root, then the
user must run a second command to create or open the folder. That scan cannot
protect against an external folder that is imported later and makes ordinary
setup unnecessarily dependent on unrelated root health.

## Decision

`Set up external folder` is the primary explicit workflow. A missing expected
folder uses targeted path checks, creates an empty canonical marker, writes note
frontmatter marker-first through a dedicated resumable journal, and opens the
folder. An existing unmarked exact target requires confirmation and the same
leaf-first topology protections as adoption.

An unassigned note may explicitly restore the single UUID identity found in its
exact expected folder. Restoration requires confirmation, a complete scan of
the non-ignored root, exactly one discovered folder for that UUID, no skipped
or inaccessible evidence, and no other vault owner. This is a narrow recovery
exception to ADR-0008, not automatic reverse reconciliation.

`Assign external folder identifier` remains vault-only. `Open external folder`
still never creates note identity.

Setup uses a separate journal whose stages name the next operation:
`folder-create`, `marker-write`, `frontmatter-write`, and `complete`. Resume
revalidates live evidence, reuses the journaled UUID, and never deletes partial
output. Opening the OS folder occurs only after journal completion.

If a matching expected marker coexists with other UUID markers, opening remains
available but warns about the additional identities. No command overwrites or
chooses among competing markers.

## Marker-only repair for an identified note

Status, Setup, and Open recovery share a marker-only preview and executor. Fresh
adapter reads determine note ownership, independent of metadata-cache availability.
Exactly one owner must retain the original UUID and expected target. The target,
ancestors, and included subtree use the filtered status scan's configured/Git
rules, tracked paths, and metadata exclusions. Intentional omissions are disclosed,
not blockers. Required read failures, unignored links, repository-validation
failures, overlapping identified reservations, and observed marker conflicts block.
Ordinary descendant notes without UUIDs do not reserve the identified parent's
binding. Known competing UUID locations are rechecked; no whole-root scan is
required, and scoped checks do not establish exhaustive uniqueness.

The pure repair plan captures identity, root, target, policy, omissions, known
locations, and mutation sequence. Confirmation permits exclusive marker creation
under the mutation lock after fresh checks. Matching concurrent output is verified.
The marker-only action extends the existing journal with `marker-write → complete`,
never a frontmatter stage. Resume repeats the same policy and requires the original
note UUID. Changed eligibility or omissions require another preview. Old journals
remain readable without migration. Pending repairs are discoverable after restart
and block overlapping mutation workflows. This policy is separate from generic
adoption and restoration of an imported UUID into an unassigned note.

## Consequences

- Common setup no longer depends on a broad whole-root scan.
- Imported identity restoration remains slower because uniqueness is global.
- Configured ignores are an explicit blind spot; skipped directories block
  restoration because uniqueness cannot be proven.
- Interrupted setup is auditable and resumable without rollback or deletion.

## References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0008](0008-no-reverse-reconciliation.md)
- [ADR-0023](0023-open-external-folder-does-not-assign-identity.md)
- [ADR-0025](0025-active-note-open-recovery-scan.md)
- [ADR-0026](0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md)
- [ADR-0027](0027-uuid-named-marker-files.md)
