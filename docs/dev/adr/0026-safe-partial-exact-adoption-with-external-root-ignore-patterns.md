---
status: "Accepted"
date: "2026-05-12"
decision-makers: "Maintainers"
tags: "external-root, safety, status-model"
when_to_read: "Before changing bulk adoption, external-root ignore patterns, or scan evidence policy."
supersedes: "ADR-0024"
---

# Safe Partial Exact Adoption with External Root Ignore Patterns

## Context and Problem Statement

The original bulk adoption contract required the entire configured external root
to be pristine before any row could be adopted. That was safe for a dedicated
empty root, but too strict for real broad roots such as `C:\Users\...\hangar`
that also contain source checkouts, test fixtures, temp folders, stale markers,
and unreadable directories.

The safety model needs to change without introducing fuzzy adoption or allowing
unrelated root state to silently affect identity writes.

## Decision Drivers

- Adopt only exact, unambiguous note-derived targets
- Keep marker-first, frontmatter-second execution with journaled resume from
  [ADR-0024](0024-strict-exact-adoption-with-journaled-marker-first-writes.md)
- Let safe rows proceed in mixed roots instead of blocking the whole run
- Give users a way to remove unrelated source checkouts and temp folders from
  scan evidence
- Avoid misleading half-support for `.gitignore` negation when ignored
  directories are pruned before `readdir`

## Considered Options

* Whole-root pristine adoption
* Partial exact adoption without ignore patterns
* Partial exact adoption with external-root ignore patterns
* Fuzzy, suffix, or basename-only adoption

## Decision Outcome

Bulk adoption no longer requires the entire external root to be pristine.
Instead, adoption is permitted when each adopted row is locally coherent at
preflight time: the note does not appear in the vault identity scan, including
duplicate UUID paths, and has no invalid `exnf`; the derived target is exact and
unique; and the target is discovered, unignored, unskipped, unmarked, not
malformed, and not already bound. Unrelated root state is reported as warnings
or blocked rows but does not suppress safe rows.

The old invariant was whole-root pristine/coherent. The new invariant is
row-local coherence for each adopted exact match.

Only root-level scan failures and invalid ignore settings remain global blockers.
Existing unrelated vault identities, external markers, malformed markers,
skipped descendant directories, and ignored directories are reported but do not
block unrelated adoptable rows.

### Ignore Pattern Contract

The plugin supports a practical `.gitignore`-style subset implemented with the
`ignore` package:

- patterns are configured by the user and default to empty
- matching is against slash-normalized paths relative to the canonical external
  root
- user-entered backslashes are normalized to `/`
- a single leading `/` is root-anchored relative to the external root
- POSIX-looking paths such as `/Users/name/foo/` are interpreted as
  root-anchored relative patterns, not filesystem-absolute paths
- Windows drive paths such as `C:/...` and UNC paths such as `//server/share/...`
  are rejected as filesystem-absolute
- `!` negation is rejected in v1 because ignored directories are pruned before
  descendant `readdir`
- matching uses the same case-sensitivity policy as path identity:
  case-insensitive on Windows/macOS defaults and case-sensitive on Linux
- symlink, junction, and reparse-point paths are matched by the walked link path;
  existing scan behavior still does not traverse those directories

Ignored folders are not traversed and do not contribute marker evidence for
adoption, verify, drift, reconcile, or active-note open recovery scans. If an
existing note identity points at an ignored path, reports classify it as
ignored/unchecked, not healthy, missing, drifted, or reconciled.

Ignored directory reporting includes a count and the first 20 ignored relative
paths. The matching ignore pattern is not reported because the `ignore` package
does not expose that information directly.

### Adoption Row Policy

- Existing note identities, including duplicate UUID note paths, are warnings
  and excluded from adoption.
- Existing external markers are warnings unless they overlap a candidate target;
  candidate targets with exact, ancestor, or descendant markers block only that
  note.
- Malformed markers are warnings unless they overlap a candidate target;
  candidate targets with exact, ancestor, or descendant malformed markers block
  only that note.
- Skipped directories are warnings unless the note's target is inside a skipped
  subtree; that note is blocked.
- Ignored target paths block the affected note with an ignored-target message.
- Duplicate normalized derived targets block the affected notes.
- Duplicate normalized target directories block the affected notes.
- No fuzzy, suffix, tree-tail, or basename-only adoption is allowed.

Execution remains marker-first, frontmatter-second, journaled, and preflighted
immediately before apply.

## Consequences

### Positive

- Broad mixed roots can adopt safe exact matches without cleaning every
  unrelated subtree first
- User ignore patterns suppress fixture markers and temp-directory EPERM noise
- Each adopted row still has a clear local safety proof
- Ignored linked folders are visibly unchecked instead of being misreported as
  missing or healthy

### Negative / Trade-offs

- A successful adoption run no longer proves the whole external root is coherent
- Ignore settings can hide real marker evidence until the user removes the
  pattern
- The ignore pattern subset is less powerful than full `.gitignore` behavior
  because v1 rejects `!` negation
- Reports need an additional ignored/unchecked state

## Pros and Cons of the Options

### Whole-root pristine adoption

- Pros: Simple invariant; success proves the entire root was identity-clean
- Cons: Unusable for broad roots with unrelated markers, fixtures, temp folders,
  or skipped directories
- Why superseded: The invariant was too strict for real working roots

### Partial exact adoption without ignore patterns

- Pros: Safe rows can proceed; simpler settings model
- Cons: Broad roots still surface noisy fixture markers and EPERM warnings
- Why rejected: It fixes partial adoption but not practical broad-root scanning

### Partial exact adoption with external-root ignore patterns

- Pros: Keeps exact row-local safety while letting users prune unrelated
  subtrees
- Cons: Adds settings validation and an ignored/unchecked report state
- Why accepted: Best match for mixed roots without fuzzy identity inference

### Fuzzy, suffix, or basename-only adoption

- Pros: More likely to match messy historical roots automatically
- Cons: Can bind the wrong folder to a note
- Why rejected: Wrong adoption is worse than no adoption

## More Information

### References

- [ADR-0001](0001-vault-is-source-of-truth.md)
- [ADR-0005](0005-bound-folder-marker.md)
- [ADR-0009](0009-status-model.md)
- [ADR-0013](0013-filesystem-boundary-and-path-identity.md)
- [ADR-0014](0014-exnf-marker-format-and-validation.md)
- [ADR-0015](0015-external-folder-path-derivation.md)
- [ADR-0024](0024-strict-exact-adoption-with-journaled-marker-first-writes.md)
- [ADR-0025](0025-active-note-open-recovery-scan.md)
- [Git gitignore documentation](https://git-scm.com/docs/gitignore)
- [`ignore` package documentation](https://github.com/kaelzhang/node-ignore)
