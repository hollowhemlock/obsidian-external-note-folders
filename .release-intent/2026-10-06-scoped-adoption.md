---
impact: patch
type: fix
area: adoption
---

# Allow selected adoption around intentional exclusions

Allow checked folders to be adopted with a new UUID despite intentionally excluded
descendants. Share Git-aware scoped checks across selected-folder adoption and setup
of existing unmarked folders. Preserve fresh vault/reservation checks, known conflict
evidence, exclusive marker-first writes, and confirmed recovery of the same journal
when omissions change. Excluded targets remain unavailable. Legacy journals, imported
identity restoration, bulk adoption, missing-folder setup, and other repairs keep
their existing rules.

Label discovered Git repository roots and show nearest containing repository context
in the shared Obsidian/offline report. Leaf navigation, counts, CSV schemas, and
binding-health colors remain unchanged. No settings, dependencies, or migration.

Product alignment: product-intent principles 6 and 8, ADR-0031, ADR-0032, ADR-0034,
and the scoped adoption/repository state-matrix cases.

Validation evidence (local, 2026-10-06T22:01:00Z):

- Baseline `npm run test`: 612 tests passed. Flutter-exclusion adoption, parent
  availability, and repository-metadata regressions failed before implementation.
- Final `npm run test`: 623 tests passed across 67 files. One preceding run hit a
  transient Windows EPERM during the existing atomic journal replacement; the
  complete rerun passed without changing or weakening the test.
- `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, `npm run build`,
  and `npm run docs:adr:index` passed. Formatting's optional incremental cache
  could not be saved in the restricted environment; checks completed successfully.
- Sandbox preparation built/reset/installed successfully. Local CLI access required
  unrestricted process access; explicit reload and version/vault preflight verified
  Obsidian 1.13.7 and the sandbox before running Vitest's integration configuration.
- 29 rendered scenarios passed across the full run and focused reruns. Five long
  existing UI checks initially timed out with `document.hidden === true`; all passed
  with background throttling temporarily disabled. The original flag was restored.
  New checks cover outer/repo/inner previews, collapsed omission provenance, both
  report hosts, repository navigation, payload preservation, and setup recovery
  after plugin restart with changed scope and unchanged journal UUID/marker bytes.

Commit review: focused self-review of the task diff from
`fb68813449f32fac1760105faba863be7e11c7db`.

- Decision: PASS; confidence: high; unresolved findings and missing evidence: none.
- Repairs from review: block overlapping pending operations before a new journal;
  retain known marker-link evidence; keep optional repository labels independent
  of unfiltered scan success; check pending operations at setup preview as well
  as execution and resume.
- Checklist: one adoption/orientation scope, regression evidence, patch intent,
  and accepted guidance synchronized. High-level product intent is unchanged.
- Override: none. No merge/release requested; CI-backed merge clearance is separate.
