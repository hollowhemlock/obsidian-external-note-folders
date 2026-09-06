---
status: "Accepted"
date: "2026-09-05"
decision-makers: "Maintainers"
tags: "external-root, safety, status-model"
when_to_read: "Before changing moved-folder suggestions or allowing non-path evidence near adoption."
---

# Read-Only Moved-Folder Name Suggestions

## Context and Problem Statement

An unassigned note can move before its external folder receives UUID identity. Exact-path adoption then correctly ignores the old folder, but users need bounded evidence that the note and folder may still correspond. A basename is useful evidence but is not identity and cannot safely authorize adoption.

## Decision Outcome

Add a separate `Suggest moved external folder matches` command. It compares the literal note basename without `.md` to the literal external-directory basename after NFC normalization and the platform path-identity case policy. It does not sanitize names, shorten long path components, strip punctuation, or use fuzzy matching.

Suggestions require exactly one eligible note and one eligible folder with that normalized name among checked scan evidence. Duplicate names are summarized as ambiguity groups rather than expanded into note/folder pairs. Exact relative-path candidates remain owned by `Adopt exact-path external folders` and are never moved-folder suggestions.

Eligible external folders cannot overlap existing vault identity topology, valid or duplicate marker topology, malformed marker evidence, skipped evidence, configured ignored roots, or any discovered exact-path candidate topology, including suppressed and blocked candidates. Ignored subtrees are absent from the scan, and skipped subtrees have incomplete evidence, so uniqueness is explicitly described as “unique among checked eligible paths.” Root-scan and ignore-configuration errors make suggestion classification unavailable.

The report is read-only. It never assigns UUIDs, writes markers, moves folders, invokes adoption execution, or offers confirmation. Suggestions are grouped by the note's first vault path segment, preserve all rows in the report model, lazily render at most 100 more rows per user action, and cap copied Markdown samples at five per group. The existing exact-adoption command ID remains stable for hotkey compatibility while its visible name changes to `Adopt exact-path external folders`.

Until direct divergent-path adoption has a separate safety design, the report documents this workflow: temporarily restore the note to the folder's matching relative path, run exact-path adoption, move the note to its intended path, and run reconciliation.

## Consequences

- Users can discover likely pre-identity moves without weakening UUID or exact-path safety.
- Common folder names are deliberately ambiguous and require manual investigation.
- Ignored and unreadable paths mean the report cannot claim global uniqueness.
- The full external tree is still scanned, but large reports do not eagerly create thousands of modal elements.

## References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0008](0008-no-reverse-reconciliation.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [ADR-0026](0026-safe-partial-exact-adoption-with-external-root-ignore-patterns.md)
