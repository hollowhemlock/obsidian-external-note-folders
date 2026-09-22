---
impact: patch
type: fix
area: reporting
---

# Show attention levels on the left of folder rows

Use theme-aware gray, teal, blue, amber, and red indicators for informational,
healthy, optional, review, and conflict/recovery states. Keep healthy containers
neutral when parent adoption is unavailable. Expand selected-folder sections by
default and remove repeated tag definitions while retaining actual evidence,
navigation, warnings, and CSV explanations.

Validation: 425 unit tests and four live Obsidian report integration tests passed,
including the 20,000-leaf case. TypeScript, production/browser builds, lint, and
formatting checks passed. Visually checked light/dark HTML and Obsidian layouts
and the narrow Obsidian layout.
