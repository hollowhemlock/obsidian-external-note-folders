# Procedure: Release with Release Please

This procedure defines how releases are generated, reviewed, and published in this repository.

## Automation Overview

- `release-please` workflow runs on pushes to `main`.
- It opens/updates a release PR with:
  - version bump in `package.json`
  - version bump in `manifest.json`
  - generated `CHANGELOG.md`
- When the release PR is merged, Release Please creates a GitHub release and tag.
- `publish-obsidian-assets` runs on release publish and:
  - builds artifacts
  - validates tag version equals `manifest.json` version
  - updates and commits `versions.json` on `main`
  - uploads `main.js`, `styles.css`, `manifest.json`, `versions.json` to the release

## Human Workflow

1. Merge conventional-commit PRs into `main`.
2. Wait for/refresh the release PR created by Release Please.
3. Review the release PR for:
   - correct semver bump
   - accurate changelog entries
   - expected files changed only
4. Merge the release PR.
5. Confirm GitHub release exists and assets are attached.
6. Verify `versions.json` was updated on `main`.

## LLM Agent Workflow

1. Ensure commit subjects match `<type>: <description>`.
2. Do not manually edit release PR versions unless requested.
3. Before merge guidance, verify CI status on the release PR.
4. After release, verify:
   - tag and `manifest.json` version match
   - release assets include all required files
   - `versions.json` contains the new version key
5. If release job fails, diagnose root cause first; do not retag blindly.

## Failure and Recovery

- If tag/version mismatch fails release: fix `manifest.json` version via release PR and re-run release.
- If build fails: fix code/build pipeline on `main`; release-please will update release PR.
- If `versions.json` update fails to push: resolve branch protection or permission settings, then re-run the workflow.

## Conventions

- Use conventional commits (`feat`, `fix`, `docs`, `test`, `refactor`, `dev`, etc.).
- Treat release PRs as reviewable artifacts, not auto-merge by default.
