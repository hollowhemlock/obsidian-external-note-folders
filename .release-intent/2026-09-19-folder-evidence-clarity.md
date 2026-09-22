---
impact: patch
type: fix
area: reporting
---

# Clarify folder evidence and ancestor relationships

Separate note-path and directory coverage from identity uncertainty, explain
ancestor markers and path-specific adoption restrictions, and simplify status
controls and details. Inspect marked ancestors without changing filters or
exports, and return to the original selection and expansion state.

Validation: 399 unit/adapter tests and all 21 sandbox integration tests passed;
the four report integration tests also passed after the final UI refinements.
TypeScript, lint, formatting, production builds, and the browser-boundary check
passed. Light/dark and narrow layouts were visually inspected in HTML and
Obsidian. The 20,000-leaf benchmark recorded scan tasks below 16 ms and scheduled
analysis/query/export slices below 12 ms; the Obsidian interaction check recorded
no long tasks and at most 60 rendered rows.

Integration scripts now use short file-loading eval commands to avoid the
Obsidian 1.13.7 Windows CLI JSON-parser failure encountered with long inline
scripts. The post-reload version preflight was rerun once Obsidian was ready.
