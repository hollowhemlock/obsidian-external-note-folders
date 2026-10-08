---
impact: patch
type: fix
area: audit
---

# Declare and update the bundled YAML parser

Declare `yaml` as a direct runtime dependency and update the locked parser from
2.8.2 to 2.9.1. Physical status scans and adoption inspections retain strict
duplicate-key checks and bounded alias expansion. Parser failures remain visible
as unchecked frontmatter while other readable notes continue to be scanned.

The parser remains bundled in `main.js`; users need no additional installation.
Remove obsolete YAML dependency exceptions in the scanner and adapter tests, and
clarify the existing audit documentation. Plugin version metadata and journal
formats are unchanged.

Product alignment: product-intent principle 8 (reports minimize silent failure)
and ADR-0034's physical status scans. High-level product intent is unchanged.

## Local validation

Evidence timestamp: 2026-10-08T14:38:39Z. Reviewed task diff against base commit
`7ddf1e3`; evidence source is local.

- `npm ci --no-audit --no-fund` succeeded; `npm ls yaml --depth=0` confirmed the
  direct dependency resolves to 2.9.1. Existing tooling peer-dependency warnings
  did not prevent installation. The lockfile diff changes only YAML and its root
  declaration.
- `npm test -- scripts/adoption-audit.test.ts` passed all 19 cases before and
  after the update, including five new compatibility and resource-failure cases.
- `npm test` passed 635 tests across 68 files.
- `npm run lint`, `npm run format:check`, and `git diff --check` passed. Lint was
  rerun without warnings after removing obsolete YAML exceptions.
- `npm run sandbox:refresh` passed TypeScript compilation and the production
  build, installed the artifacts, and confirmed the sandbox plugin reloaded.
  No fixture reset was used.
- `npm run release:check-versions`, `npm run release:check-metadata`, and
  `npm run release:check-assets` passed. `npm run docs:adr:index` followed by
  `git diff --exit-code -- docs/dev/adr/README.md` confirmed the index is unchanged.
- A read-only Node check confirmed the production bundle contains the updated
  parser's `RESOURCE_EXHAUSTION` handling and no external YAML import.

## Commit review

- Decision: PASS. DecisionReasonCodes: none. Confidence: high.
- Findings: none after focused self-review of the complete task diff.
- ChecklistStatus: one dependency-fix scope; parsing coverage, documentation,
  local validation, patch release intent, and product alignment are present.
  The staged diff requires a conventional `fix` commit.
- MissingEvidence: none for the local commit gate. CI and a full live status scan
  were not evaluated; sandbox reload and adapter tests passed.
- OverrideStatus: none. Product intent change: none.
- MergeReadiness: not assessed; merging and release publication are outside this
  task, and their CI-backed gates remain required.
