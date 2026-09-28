---
impact: minor
type: feat
area: status
---

# Respect repository ignore rules in external folder status

User-visible change:

- Status defaults to shared external exclusions and full Git ignore semantics,
  including nested, local, and global rules.
- Two rescan buttons replace the status-specific pattern list and skip toggle.
  An explicit unfiltered scan remains available without Git.
- Unscannable branches leave the normal tree while coverage, known-binding
  warnings, and adoption restrictions remain visible and authoritative.
- Git failures retain the previous completed snapshot instead of publishing
  partial results.

Product alignment: reporting principle 8 and ADR-0034; no changes to mutation
preflight scope or the vault's authority over binding identity.

Local validation (2026-09-27):

- `npm run test`: 548 tests passed, including real Git, protocol, coverage,
  cancellation, snapshot retention, and process-count/performance coverage.
- `npm run lint`, `npm run format:check`, and `npm run build` passed. The formatter
  reported an inability to save its optional incremental cache, with exit code 0.
- `npm run integration:prepare` built and installed the disposable sandbox but
  failed to reload Obsidian: its CLI could not find a running runtime. The updated
  status integration tests have not run.

Performance fixture: six repositories with 1,200 generated leaves maintained one
active ignore process and skipped all generated leaves. Filtered scans took about
1.1–1.4 seconds versus 0.5–0.7 seconds unfiltered on these mostly empty directories;
Git startup overhead means filtering is not always faster.
