# Procedure: MVP Validation

Status: Maintained baseline validation procedure; the filename reflects its MVP origin.

Use the current task, [product intent](../product/intent.md), and
[testing guide](../testing/README.md) to choose relevant checks. The historical
MVP plan and phase workflow are context, not the current backlog. Collect
validation evidence against the actual code revision being reviewed.

## When to Use

Use this procedure for any change that affects:

- UUID generation, validation, or frontmatter handling
- marker parsing or writing
- path derivation, sanitization, or boundary checks
- external-root scanning or raw filesystem access
- command behavior, including setup/open, bulk and single-folder adoption,
  reconciliation, marker migration, and journal recovery
- shared status analysis, offline HTML, report filtering/exports, and Obsidian status-tab behavior

## Baseline Commands

For documentation-only local work, check changed-file formatting, relative links
and anchors, and claims against their source code or configuration. The current
`npm run format:check` configuration excludes Markdown, so it does not validate
prose layout; inspect Markdown structure and run `git diff --check` as well.
There is no need to reset the Obsidian sandbox solely for prose changes. Normal required CI
and the [review gate](commit-pull-request-merge-review-gate.md) still apply to PRs
and merges.

For code changes, run these before requesting review:

```bash
npm run lint
npm run format:check
npm run test
```

Also run this when the change touches fixture-driven flows, raw filesystem integration, or Obsidian command wiring and a prepared Obsidian CLI environment is available:

```bash
npm run test:integration
```

If no local Obsidian CLI environment or `self-hosted` + `obsidian-cli` runner is available, record the skip reason in the PR instead of treating the integration lane as a required PR check.

## Fixture Setup

- `npm run fixtures:new-sandbox` fully replaces the sandbox vault and external root from committed
  fixtures, opens the sandbox vault if needed, then reloads Obsidian with that vault as the CLI
  target.
- The primary Git checkout owns the repository sandbox and Obsidian runtime. Worktrees may edit and
  run headless validation, but sandbox reset, development, opening, and CLI integration fail before
  mutation or Obsidian control.
- If Windows reports a persistent lock during reset, close Obsidian and rerun the command.
- `npm run vault:open -- sandbox` opens the sandbox vault in Obsidian for manual verification.

Use a fresh sandbox at the start of each validation pass or scenario. Sandbox-local Obsidian
settings are disposable and are replaced during reset.

## Required Scenario Matrix

| Scenario | Setup | Expected Outcome |
| --- | --- | --- |
| External root missing | Point settings at a non-existent absolute path. | Scan-dependent commands report `Error` and external-root mutations abort. Vault-only assignment still succeeds. |
| External root inaccessible | Use a detached drive, denied-permission folder, or similar inaccessible root. | Scan-dependent commands surface an `Error` and external-root mutation preflight aborts. Vault-only assignment still succeeds. |
| Child directory inaccessible | Deny read access to a descendant directory while the configured root remains readable. | Scan reports a warning, skips that subtree, and continues classifying readable sibling folders. |
| Duplicate UUID in vault | Create two notes with the same `exnf` frontmatter value. | `Verify` reports duplicate-vault `Error`; UUID-sensitive recovery/reconcile operations block. Assignment to an unrelated unassigned note generates a different UUID. Adoption excludes every note path carrying the duplicate UUID and may still adopt unrelated rows. |
| Duplicate UUID in external root | Create two bound folders with marker files containing the same UUID. | `Verify` reports duplicate-external `Error`; imported-marker restoration and UUID-sensitive recovery/reconcile operations block. Vault-only assignment is unaffected. Adoption blocks only overlapping candidates and may still adopt unrelated rows. |
| Malformed marker | Add an invalid UUID marker filename or a legacy `.exnf` file with BOM, extra lines, extra content, or a non-canonical UUID. | Marker is classified as malformed; affected mutation blocks. Canonical marker bodies are not read. |
| UUID-named marker authority | Test empty, arbitrary text, multiline, mismatching, binary, and unreadable `<uuid>.exnf` bodies. | Every folder is identified by the filename UUID without reading content. New writes remain empty. |
| Pragmatic setup | Run `Set up external folder` for a missing target, an unmarked exact target, and an exact target with one imported marker identity. | Missing setup is targeted and immediate; unmarked adoption confirms; imported restoration confirms only after complete UUID uniqueness proof. |
| Setup interruption | Fault after folder creation, marker write, and frontmatter write. | A note-specific setup journal is offered for idempotent resume with the same UUID and no deletion. |
| Occupied target path | Create an unbound directory at the derived destination path before `Open External Folder`. | Command reports conflict and aborts; no auto-rename occurs. |
| Existing root adoption | Use unassigned notes and matching note-derived external folder paths. Unrelated existing `exnf`, marker files, skipped directories, or ignored directories may be present. Include one candidate whose target has ancestor or descendant marker evidence. | `Adopt exact-path external folders` shows exact safe matches in dry-run, reports unrelated state as warnings/blocked rows, blocks the overlapping marker candidate, writes markers before frontmatter after confirmation, and journals the run. |
| Moved unassigned folder suggestion | Move an unassigned note away from an equivalently named unmarked folder, then add duplicate-name, ignored, skipped, marked, and exact-candidate branches. | `Suggest moved external folder matches` reports only unique checked eligible pairs, summarizes ambiguity, marks unchecked evidence, and performs no mutation. |
| Legacy marker migration | Create a folder with fixed `.exnf` and no matching `<uuid>.exnf`. | `Migrate legacy marker files` shows a dry-run rename from `.exnf` to `<uuid>.exnf`, executes only after confirmation, journals the rename, and never overwrites an existing UUID-named marker. |
| Root escape / reparse point attempt | Create a symlink, junction, or other reparse point under the external root. | Scan and mutation stay within the configured root and do not follow the escape path. |

## Manual Verification Notes

- For manual Obsidian checks, confirm user-facing notices are grouped and actionable.
- When a command aborts on integrity issues, confirm no new folders, markers, or note mutations were created.
- When `Verify` runs during or after mutating work, confirm any stale result is labeled accordingly if caching is involved.

## Release-Adjacent Verification

For release candidates and release PR review:

- Confirm the release PR includes the expected `CHANGELOG.md`, `package.json`, and `manifest.json` changes.
- After the release PR is merged, confirm the GitHub release exists, required assets are attached, and `versions.json` is updated on `main`.

## Recording Results

Capture validation evidence in the PR description:

- commands run
- manual scenarios exercised
- any skipped scenarios and why
- residual risks or follow-ups
