---
impact: patch
type: fix
area: status
---

# Preserve copyable diagnostics for failed status scans

Fatal status scan failures now open a Latest scan attempt section in Scan details.
Selectable diagnostics and Copy error include the attempted roots, mode, time,
affected path when available, and the complete error message. Copying works before
any successful scan and remains available while retrying.

Failure diagnostics are separate from completed snapshot coverage and exports.
A completed or cancelled retry clears them; another failure replaces them.
Clipboard failures leave the diagnostic available for manual copying.

Product alignment: ADR-0034 snapshot retention and state-matrix R31.

Validation (2026-09-30):

- `npm run test`: 567 tests passed across 63 files, including first-failure,
  retry retention, cancellation, changed-root context, and copy-text coverage.
- `npm run lint`, `npm run build`, `npm run format:check`, and `git diff --check`
  passed. Formatting reported an optional cache-write permission warning.
- Sandbox integration assertions cover disclosure, clipboard copying, manual-copy
  fallback, and clearing diagnostics after success. They remain unrun because the
  Obsidian CLI preflight could not find a running runtime.
