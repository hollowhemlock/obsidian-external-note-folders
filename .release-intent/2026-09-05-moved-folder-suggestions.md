---
impact: minor
type: feat
area: adoption
---

# Suggest moved external folder matches safely

User-visible change:

- Rename exact-path adoption for clarity and add a read-only, ambiguity-aware report for equivalently named unassigned notes and external folders whose relative paths diverged.

Validation:

- `npm run test`
- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run test:integration`
