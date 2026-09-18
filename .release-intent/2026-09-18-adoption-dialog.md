---
impact: patch
type: fix
area: adoption
---

# Clarify note selection and adoption confirmation

Replace the adoption dialog's separate selection and preview controls with an
autocomplete field, mutually exclusive action buttons, automatic validation,
and a permanent confirmation footer. Cancel stale previews and distinguish
retryable checks from journaled operations requiring recovery.

Validation: unit tests, Obsidian sandbox integration tests, TypeScript, lint,
formatting, production build, and wide/narrow dialog inspection.
