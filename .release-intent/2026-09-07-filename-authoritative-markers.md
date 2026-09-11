---
impact: patch
type: fix
area: markers
---

# Make marker filenames authoritative

User-visible change:

- New UUID-named markers are empty files, while existing markers with matching UUID payloads remain compatible and conflicting payloads remain blocked.

Validation:

- `npm run test`
- `npm run build`
- `npm run lint`
- `npm run format:check`
