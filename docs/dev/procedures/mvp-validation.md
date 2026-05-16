# Procedure: MVP Validation

This procedure defines the repeatable validation flow for work implementing `docs/dev/plans/mvp.md`.

Use `docs/dev/procedures/mvp-implementation-workflow.md` before coding to define scope, sequencing, status tracking, and mutation safety expectations. Use this procedure after or during implementation to collect validation evidence.

## When to Use

Use this procedure for any change that affects:

- UUID generation, validation, or frontmatter handling
- marker parsing or writing
- path derivation, sanitization, or boundary checks
- external-root scanning or raw filesystem access
- command behavior (`Assign UUID`, `Open External Folder`, `Adopt existing external folders`, drift report, `Reconcile`)

## Baseline Commands

Run these before requesting review:

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

- `npm run fixtures:new-sandbox` creates a fresh sandbox vault and external root from committed fixtures.
- `npm run fixtures:refresh-sandbox` refreshes sandbox content while preserving `sandbox/vault/.obsidian`.
- `npm run fixtures:open-sandbox` opens the sandbox vault in Obsidian for manual verification.

Use a fresh sandbox at the start of a validation pass. Use refresh between scenarios when you want to preserve local Obsidian settings.

## Required Scenario Matrix

| Scenario | Setup | Expected Outcome |
| --- | --- | --- |
| External root missing | Point settings at a non-existent absolute path. | `Verify` reports `Error`; mutating commands abort without creating data elsewhere. |
| External root inaccessible | Use a detached drive, denied-permission folder, or similar inaccessible root. | Scan surfaces an `Error`; mutation preflight aborts; no partial writes occur. |
| Child directory inaccessible | Deny read access to a descendant directory while the configured root remains readable. | Scan reports a warning, skips that subtree, and continues classifying readable sibling folders. |
| Duplicate UUID in vault | Create two notes with the same `exnf` frontmatter value. | `Verify` reports duplicate-vault `Error`; non-adoption mutating commands abort. `Adopt existing external folders` reports the duplicate as a warning, excludes every note path carrying that UUID from adoption, and may still adopt unrelated unassigned rows. |
| Duplicate UUID in external root | Create two bound folders with marker files containing the same UUID. | `Verify` reports duplicate-external `Error`; non-adoption mutating commands abort. `Adopt existing external folders` reports the duplicate as a warning, blocks only candidate targets that already contain marker evidence, and may still adopt unrelated unassigned rows. |
| Malformed marker | Add BOM, extra content, extra lines, a non-canonical UUID, or a `<uuid>.exnf` filename/payload mismatch to a marker. | Marker is classified as malformed `Error`; non-adoption mutation preflights abort. `Adopt existing external folders` reports unrelated malformed markers as warnings, blocks candidate targets with malformed markers, and may still adopt unrelated unassigned rows. |
| Occupied target path | Create an unbound directory at the derived destination path before `Open External Folder`. | Command reports conflict and aborts; no auto-rename occurs. |
| Existing root adoption | Use unassigned notes and matching note-derived external folder paths. Unrelated existing `exnf`, marker files, skipped directories, or ignored directories may be present. Include one candidate whose target has ancestor or descendant marker evidence. | `Adopt existing external folders` shows exact safe matches in dry-run, reports unrelated state as warnings/blocked rows, blocks the overlapping marker candidate, writes markers before frontmatter after confirmation, and journals the run. |
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
