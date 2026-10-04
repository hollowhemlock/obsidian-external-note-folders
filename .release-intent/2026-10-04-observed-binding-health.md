---
impact: patch
type: fix
area: status
---

# Separate observed binding health from exhaustive coverage

User-visible change:

- Show checked matching bindings as healthy through unrelated scan gaps, including
  intentional exclusions, skipped links, and unreadable descendants.
- Keep local uncertainty and known identity/nesting conflicts visible. Mark both
  participants of an observed nesting conflict and preserve orange path drift.
- Explain scan coverage once, group diagnostics, and collapse adoption restrictions
  for existing bindings. Preserve write safeguards and CSV compatibility.

Product alignment: product-intent principles 6 and 8, ADR-0009, ADR-0034, and
state-matrix G7/T4/T25/R30/R31.

Validation (2026-10-04):

- Baseline: 571 unit/adapter tests passed. The new regression tests failed on
  global coverage downgrades and missing parent nesting conflicts before repair.
- Final unit/adapter suite: 588 tests passed across 65 files.
- Lint, format check, TypeScript checking, and production build passed. Formatting
  reported an unavailable optional incremental cache but completed successfully.
- Sandbox integration: 26 tests passed across 8 files on Obsidian 1.13.7,
  including rendered filtered/unfiltered health, grouped diagnostics, review
  navigation, adoption disclosures, and an offline HTML iframe.
- Preparation rebuilt, reset, and installed the sandbox. The restricted shell
  could not reach Obsidian; desktop access completed reload and the required
  version/vault preflight before the integration suite ran.
- Independent review found no actionable P0/P1/P2 defects; write preflight
  restrictions and legacy CSV confidence remain unchanged.
