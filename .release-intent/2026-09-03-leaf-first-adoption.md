---
impact: patch
type: fix
area: adoption
---

# Make external folder adoption leaf-first

User-visible change:

- Adoption selects deepest exact matches without creating nested bindings and replaces exhaustive unmatched-folder rows with grouped residual-tree counts and samples.

Validation:

- `npm run test`
- `npm run build`
- `npm run lint`
- `npm run format:check`
