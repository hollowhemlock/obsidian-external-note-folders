---
status: "Accepted"
date: "2026-09-23"
decision-makers: "Maintainers"
tags: "templates, adoption, safety, vault"
---

# Explicit Template Exclusions

## Context and Problem Statement

Template source files can intentionally contain YAML that becomes valid only
after expansion. Treating every such file as an unknown note identity blocks
unrelated adoption. This decision refines product principles 1 (vault identity
authority), 5 (fail closed), 6 (safe unrelated work), and 8 (visible evidence).

## Considered Options

- Require every template source to be valid YAML.
- Guess identities from malformed frontmatter or suppress parse warnings.
- Explicitly declare template paths outside the binding scope.

## Decision Outcome

Add optional vault-relative template exclusion patterns, empty by default.
Reuse the existing `ignore` matcher and normalization rules, adding file-path
matching alongside directory matching. Support filename globs such as
`*.tpl.md` at any depth and root-anchored directory patterns such as
`/settings/templates/` and `/settings/templates.archive/`. Reject negation,
Windows drive paths, and UNC paths. Preserve platform case conventions.

Matching files cannot own bindings, even if they contain a valid `exnf` value.
They are omitted from identity checks and adoption candidates. Setup, assignment,
opening, note creation, relocation, and recovery reject excluded note targets.
Physical scans skip declared template subtrees before reading their contents;
other unreadable or malformed notes retain existing restrictions.

This policy applies across plugin commands, including status reports and fresh
mutation preflights. It is independent of external-directory ignore settings.
Status results and exports disclose the patterns and number of excluded files
or directory subtrees. Complete coverage means coverage within the declared
binding scope. External markers remain visible, including markers whose only
former owner is now excluded. Removing an exclusion restores ordinary checks.
Standalone audit commands remain exhaustive by default; the scanner accepts
explicit exclusions from callers without reading plugin settings implicitly.

Settings changes invalidate pending plugin plans. Group adoption journals capture
the exclusion patterns and require the same scope on execution and recovery;
older journals imply an empty exclusion list. Selected sources and destinations
are checked again before effects. No exclusion rewrites templates or markers.

### Consequences

Templates no longer prevent unrelated adoption. Users must deliberately choose
the binding scope: broadly excluding ordinary notes also removes their identity
claims. This is an explicit eligibility rule, not proof of absent YAML identity.

### Confirmation

Tests cover filename and directory patterns, root anchoring, separator handling,
invalid settings, cached and physical scans, ordinary malformed notes, excluded
sources and destinations, settings changes during adoption/recovery, and export
disclosure. Existing marker, topology, and uniqueness checks continue to apply
within the eligible-note scope.
