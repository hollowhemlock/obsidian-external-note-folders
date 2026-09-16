---
impact: minor
type: feat
area: audit
---

# Explore unmarked external folders as a tree

User-visible change:

- Replace depth-based grouping with a filesystem tree shared by HTML and Obsidian, with name or leaf-count sorting, search, and folder details.
- Preserve keyboard navigation and reading order as virtualized rows expand, sort, and scroll.

Validation:

- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run format:check`
- `npm run test:integration` (includes the production build)
