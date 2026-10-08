---
impact: patch
type: fix
area: status
---

# Simplify status labels

Shorten repository badges to `git` in the shared tree and folder details. Render
healthy binding names at normal weight, including selected rows, while retaining
their green color and selection outline. Applies to Obsidian and offline HTML.

Product alignment: ADR-0034 repository orientation and the existing healthy
binding presentation. High-level product intent and mutation behavior are unchanged.

Validation evidence (local, 2026-10-08T13:55:00Z):

- `npx vitest run src/ui/leafStyles.test.ts src/ui/leafReport.test.ts`: four
  palette tests passed in the existing leafStyles test file.
- `npm run lint`, `npm run format:check`, `npm run build`, and `git diff --check`
  passed. Formatting could not save its optional incremental cache under the
  restricted environment, but completed successfully.
- Focused self-review checked both shared badge renderers and the healthy-label
  CSS cascade, including selected rows. No actionable findings remain.
- No new tests or live sandbox run for this small text/CSS-only adjustment;
  rendered appearance was not independently verified. The existing palette
  regression tests remain unchanged.

Commit review: PASS, high confidence; one presentation scope, synchronized
documentation, patch intent, no product-intent changes, and no overrides.

## Follow-up: normal weight for every tree row

Remove bold styling from all tree rows, including marked folders, selected rows,
and invalid-evidence indicators. Preserve status colors and selection outlines
in both report hosts. Column headings retain their existing styling.

Local validation (2026-10-08T13:56:13Z): `npx vitest run src/ui/leafStyles.test.ts`
passed all four palette tests; `npm run lint`, `npm run build`,
`npm run format:check`, and `git diff --check` passed. Focused self-review of
the CSS and documentation found no actionable issues. No new tests or live UI
run for this small styling adjustment; rendered appearance remains unverified.
