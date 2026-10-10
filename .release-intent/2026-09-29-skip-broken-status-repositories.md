---
impact: patch
type: fix
area: status
---

# Continue status scans past broken nested repositories

Filtered status scans skip nested repositories that fail initial repository or
index validation, including stale worktree metadata references. Healthy siblings
remain scannable. Skipped repositories retain unchecked coverage, note warnings,
and adoption restrictions, with separate counts and diagnostics in Scan details
and exports.

Root validation and Git process/runtime failures still abort and preserve the
previous snapshot. No automatic worktree repair or unfiltered fallback is added.
Standalone audits and mutation preflights are unchanged.

Product alignment: ADR-0034 and state-matrix R31.

Validation (2026-09-29):

- Reproduced the original failure with a stale-worktree fixture before the fix.
- `npm run test`: 563 tests passed across 62 files.
- `npm run lint`, `npm run build`, `npm run format:check`, and `git diff --check`
  passed. Formatting reported an optional cache-write permission warning.
- Added a sandbox integration assertion for warning publication and separate
  repository counts. It remains unrun: the Obsidian CLI preflight could not find
  a running Obsidian runtime.
