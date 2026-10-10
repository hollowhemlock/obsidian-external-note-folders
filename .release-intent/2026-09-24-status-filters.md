---
impact: minor
type: feat
area: status
---

# Make status filters discoverable

Add All folders, Adoptable leaves, and Needs review quick views. Keep labeled
Status, Category, and Sort controls visible, with less-used options under
Advanced. Show removable filter chips, an empty-results clear action, and the
last scan time. Compact the sticky folder header so more details remain visible.

Authority: explicit status-layout request and product intent's explicit diagnosis
workflow. Adoptable leaves reuses the existing snapshot availability checks;
preview and execution validation remain authoritative. Product intent is unchanged.

Local validation on 2026-09-24: `npm test` (474 tests), `npm run lint`,
`npm run build`, and `npm run format:check` passed. The formatter reported a
non-fatal incremental-cache write warning. The adoptable-view test first failed
on its expected membership assertion, then passed after implementation. Browser
checks used synthetic data for quick views, combined search, navigation, chip
removal, Advanced filters, empty-result recovery, and narrow/compact layouts.
Live Obsidian integration was not run.
