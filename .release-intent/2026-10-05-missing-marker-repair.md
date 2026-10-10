---
impact: patch
type: fix
area: repair
---

# Restore missing markers through shared scoped checks

Show Create missing marker for an identified exact-path note and checked unmarked
folder. Reuse its UUID after preview and fresh ownership, branch, and known-match
checks. Intentional exclusions do not block this marker-only repair. Share the
workflow across status, setup, and recovery, with exclusive writes, resumable
journals, pending-operation safeguards, and refresh after completion.

Product alignment: product-intent principles 6 and 8, ADR-0031, ADR-0034, and the
state matrix's missing-marker repair cases. Generic adoption and imported identity
restoration retain their existing safeguards. No dependencies, settings, schema
migrations, or manual version changes.

Validation (2026-10-05):

- Baseline: 588 unit/adapter tests passed; marker-only plan/journal regressions
  failed before implementation.
- Final unit/adapter suite: 612 tests passed across 67 files. Targeted session,
  controller, core, setup, and journal checks passed.
- Lint, formatting, TypeScript checking, production build, and ADR index generation
  passed. Formatting could not save its optional incremental cache but completed.
- Rendered sandbox: 27 integration tests passed across 9 files on Obsidian 1.13.7.
  The new scenario covers Setup, Open recovery, status preview/confirmation, four
  intentional exclusions, active-note changes, green refresh, unchanged note and
  payload bytes, and offline guidance without a write control.
- Full sandbox preparation reset/install succeeded; immediate CLI checks raced
  Obsidian reload. A separate successful version/vault preflight preceded the
  complete integration run on the installed build.
- Independent review identified and verified repairs for stale-cache routing,
  pending-operation overlap checks, and skipped refreshes during active work.
  Queued refresh and stale failure/cancellation regressions pass.
