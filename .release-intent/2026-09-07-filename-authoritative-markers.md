---
impact: patch
type: fix
area: markers
---

# Make marker filenames authoritative

User-visible change:

- New UUID-named markers are empty files. Existing UUID-named marker contents are opaque and never read; only the canonical filename carries identity. Legacy fixed `.exnf` contents remain strictly validated.

Validation:

- `npm run test`
- `npm run build`
- `npm run lint`
- `npm run format:check`
