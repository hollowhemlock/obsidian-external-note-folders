# Semantic Tests

Semantic tests are the canonical oracle for core report and plan behavior. They run without
Obsidian, read committed fixture input, build production scan-result models, and compare pure core
outputs against expected JSON.

Use semantic tests when behavior can be tested without Obsidian:

- drift report classification
- adoption plan classification
- verify report classification
- reconcile dry-run planning
- marker migration planning
- ignored, skipped, malformed, duplicate, orphan, occupied, and unavailable states

Do not use modal markdown as the oracle here. Observed reports belong in sandbox debug output, not
semantic assertions.

## Fixture Expectations

Expected JSON files live under `test/fixtures/fixture/expected/<domain>/<scenario>.json`.

Expected JSON must be reviewed against the committed fixture world. Generated observed JSON may be
used as a draft, but it must not be blindly promoted to expected output.

Rows are compared as unordered sets by stable row identity unless a future scenario explicitly
requires order-sensitive behavior.
