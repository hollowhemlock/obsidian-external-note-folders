---
impact: patch
type: fix
area: adoption
---

# Make adoption reports compact and scan-safe

User-visible change:

- Adoption blocks folders containing unreadable descendants and groups repeated scan and blocked-candidate evidence while distinguishing configured ignores from warnings.

Validation:

- `npm run test`
- `npm run build`
- `npm run lint`
- `npm run format:check`
