---
impact: minor
type: feat
area: reporting
---

Expand the external folder report into a status tree with command-specific scan
exclusions, identity evidence, expected paths, CSV exports, and selected binding
repair previews.

Validation: 383 unit/adapter tests and 20 sandbox integration tests passed.
TypeScript, production/browser builds, lint, and formatting checks passed.
The 20,000-leaf benchmark measured scan tasks below 20 ms and scheduled
analysis/query slices below 11 ms; Obsidian reported no long tasks in the
large-tree interaction check. Obsidian layout was visually inspected.
Standalone HTML embedding and browser-boundary tests passed; browser policy
blocked visual inspection of the local HTML file.
