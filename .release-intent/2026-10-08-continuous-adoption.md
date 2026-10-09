---
impact: patch
type: fix
area: adoption
---

# Keep selected adoption continuous and verified

Publish immutable working report revisions after verified selected adoption and
resume. Update identity columns, statuses, counts, known-marker evidence, and
navigation without a full refresh. Preserve forensic scans, discovery scope,
unreadable evidence, export consistency, and browsing context. Keep evidence colors
independent of temporary action availability and distinguish descendant history.

Show persistent locally checked note suggestions and prepare an immediate preview
after explicit selection. Preserve confirmation, fresh checks, marker-first writes,
and journal recovery. Reduce repeated inspections, bound note reads to eight, and
reuse exact-content parsing only within a workflow under a 16 MiB byte budget.
No new settings, dependencies, CSV columns, or journal migrations. No beta release
is included in this change.

Product alignment: new product-intent principle 9, amended ADR-0032, ADR-0034, and
the continuous selected-folder adoption state matrix.

## Local performance evidence

Windows primary checkout, same controller fixtures and test runner. Baseline source:
`c657238d9fc676d07ee16ddf2bba41c2ad60d5b1`. The baseline unit suite passed 635 tests.
The new completion regression failed before implementation. Run the measurement with:

```text
npx vitest run src/obsidian/GroupAdoptionController.test.ts -t "measures adoption"
```

Milliseconds, rounded. “First/next” means successive adoptions in one fixture,
not a claim about cold filesystem caches. Confirmation includes adapter effects
and final verification, with a mock completion consumer; UI rebuild time is separate.

| Fixture/run | Preview before | Preview after | Confirm before | Confirm after |
| --- | ---: | ---: | ---: | ---: |
| Ordinary, first | 69 | 77 | 367 | 317 |
| Ordinary, next | 65 | 69 | 345 | 295 |
| Repository with exclusions, first | 240 | 249 | 1208 | 1024 |
| Repository fixture, next sibling outside repository | 68 | 76 | 337 | 313 |
| 600-note vault, first | 230 | 207 | 1076 | 654 |
| 600-note vault, next | 206 | 185 | 1044 | 604 |
| Relocation, first | 69 | 72 | 364 | 404 |
| Relocation, next | 67 | 73 | 364 | 399 |

Baseline used six scoped inspections per adoption. New adoption without relocation
uses five: preview, confirmation preflight, marker, note, final verification.
Relocation adds its necessary move preflight and remains at six. Tests enforce these
work budgets without wall-clock thresholds.

The final benchmark records enumeration, read, parse, concurrency, and Git process
counts per inspection. Ordinary inspections launch one Git availability process;
the repository fixture launches four processes per inspection, reusing its ignore
process across that inspection. After the 600-note preview parses 600 notes, each
subsequent inspection still reads all 600/601 notes but parses only changed content
(one new note in final verification). The next adoption starts a new parse cache.
Maximum queued reads was eight. Directory enumerations increase from 3/4 to 8/9
after creation of the journal directories; those are included in the fresh vault walk.

The larger vault's final measured confirmation improved by about 39–42%; repository
confirmation remains about one second, dominated by repeated fresh Git checks.
Relocation did not improve in this run. Earlier intermediate measurements were faster;
these figures deliberately report the final run rather than selecting the best result.
This is an improvement in bounded repeated work, not a claim that every real-world
vault now has negligible latency.

## Validation and focused review

Local evidence, 2026-10-09T01:30:00Z (Windows, Obsidian 1.13.7). No CI results
or beta publication are claimed here.

- `npm run test`: 652 tests across 72 files passed, including core, session,
  controller, storage, journal, exclusion, and recovery regressions.
- `npm run lint`, `npm run format:check`, and `npm run build`: passed.
  The final suggestion rendering adjustment also passed targeted ESLint and dprint
  checks and the subsequent sandbox build.
- `npx vitest run --config vitest.integration.config.ts
  test/integration/continuous-adoption.integration.test.ts
  test/integration/group-adoption.integration.test.ts
  test/integration/leaf-report.integration.test.ts
  test/integration/scoped-adoption.integration.test.ts`: 18 tests across four files
  passed. The local wrapper temporarily disabled sandbox background throttling and
  restored its previous value afterward. This used the existing GUI workflow.
- `npm run sandbox:refresh`: passed; plugin artifacts installed and the sandbox
  plugin reloaded with notes, settings, and journals preserved.
- `git diff --check`: passed.

Focused self-review covered the full task diff against the baseline above. Repairs
from review preserve known UUID ownership while marking failed rereads unchecked,
retain discovery scope and pending overlays correctly, pin exports during rendering,
ship existing dialog styles in the compiled artifact, and keep blocked suggestion
reasons visible after selection. The latter had a failing rendered regression before
its fix. Rendered fixture names and report cleanup isolate repeated test runs.

Commit review decision: **PASS**, high confidence, no unresolved actionable findings.
Scope, regression evidence, patch impact, and product-intent alignment are satisfied;
principle 9 explicitly changes intent and ADR-0032 refines it. No override or missing
local evidence. Timing limitations are recorded above. This is local commit evidence,
not a pull-request or merge gate decision; those require current CI evidence.
