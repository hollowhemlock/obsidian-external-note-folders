---
impact: minor
type: feat
area: templates
---

# Explicit vault template exclusions

Add opt-in vault-relative patterns that declare template sources ineligible for
external-folder bindings. Support filename globs and root-anchored directories
using the existing ignore matcher. Apply the scope to physical and cached scans,
candidate selection, active-note commands, adoption, and recovery; disclose the
scope in status results and exports. Existing installations exclude nothing by
default. Ordinary malformed notes and external marker restrictions remain.

Authority: ADR-0033 and the explicit template-exclusion request.

Local validation on 2026-09-23: `npm test` (468 tests), `npm run lint`,
`npm run build`, and `npm run format:check` passed. The formatting check reported
a non-fatal incremental-cache write warning. Live Obsidian integration was not run.
