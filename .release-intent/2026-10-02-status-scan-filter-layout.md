---
impact: patch
type: fix
area: status
---

# Separate scan context from result filters

User-visible change:

- Place the root path and inspection action first, then separate Scan and Filter
  sections with their own metrics and exports.
- Keep scan totals and outcomes stable while filtering; place rescan actions at
  the end of Scan and adoption recovery beside result navigation.
- Make passive report text selectable for copying and label unmarked-leaf exports
  explicitly without changing their contents.
- Disable filtered exports while filters are recalculating so exports cannot use
  the previous result with newly selected filter controls.

Product alignment: ADR-0034 and state-matrix R30/R31 presentation checks.

Validation (2026-10-02):

- Full unit suite: 571 tests passed. Targeted metric regressions passed again
  after correcting strict TypeScript predicates.
- Lint, build, and formatting checks passed. The formatter could not save its
  optional incremental cache but returned success.
- Browser preview confirmed separate metrics and export controls, stable scan
  totals during filtering, and selectable passive text.
- Sandbox integration suite: 25 tests passed on Obsidian 1.13.7 after fixing a
  test race that rejected the mocked scan before the asynchronous button action
  reached it. Desktop access was required for the CLI. The full preparation
  command built and reset the sandbox; its immediate post-reload version check
  failed transiently, then passed on retry before running the complete suite.
