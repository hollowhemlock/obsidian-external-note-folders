---
impact: patch
type: fix
area: reporting
---

# Explain parent folders containing existing bindings

Label containers above confirmed bindings as Contains bound subfolders, and
other containers with marker evidence as Contains descendant markers. Explain
the nested-adoption restriction in tooltips, details, and CSV exports while
preserving local evidence and higher-priority missing markers, conflicts, or
uncertainty. Identified parents retain Marker absent here, its review indicator,
and missing-marker filter/export membership above bound descendants.

Validation: 426 unit/adapter tests passed, including seven container-status
regressions and the browser-boundary check. TypeScript, lint, and formatting
passed. Production build and live report integration checks passed before the
missing-marker precedence fix; the live sandbox suite was not rerun for that fix.
