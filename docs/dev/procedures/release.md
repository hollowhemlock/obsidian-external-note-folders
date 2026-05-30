# Procedure: Release with Release Please

This procedure defines how releases are generated, reviewed, and published in this repository.

## Automation Overview

- `release-please` workflow runs on pushes to `main`.
- It requires the `RELEASE_PLEASE_TOKEN` repository secret so release PR updates
  and release publication can trigger follow-up workflows.
- It opens/updates a release PR with:
  - version bump in `package.json`
  - version bump in `manifest.json`
  - generated `CHANGELOG.md`
- `release-versions` runs on Release Please PR branches and commits generated
  `versions.json` updates before release publication.
- Release PR CI runs `npm run release:check-versions` as a guardrail after the
  generated metadata commit.
- Opening or updating the release PR requires repository Actions workflow
  permissions with read/write access and GitHub Actions pull request creation
  enabled.
- When the release PR is merged, Release Please creates a GitHub release and tag (without a `v` prefix).
- `publish-obsidian-assets` runs on release publish and:
  - builds artifacts with Node 24
  - validates tag version equals `manifest.json` version
  - uploads `main.js`, `styles.css`, and `manifest.json` to the release
- `publish-obsidian-assets` can also be run manually with a `tag` input to retry
  asset publishing for an existing release. Manual runs use the workflow from
  `main`, check out the requested tag, build that exact tag, and upload assets
  back to the same release tag.
- `versions.json` is updated in the release PR before release publication; it is
  not committed by the post-release asset workflow.
- `.release-intent/*.md` files are canonical review and recovery evidence for
  release-relevant normal PRs. Release Please does not currently consume them
  directly, so conventional PR and merge titles still matter.

## Human Workflow

1. Merge PRs into `main` only when release impact, release intent files, PR
   titles, and intended merge or squash titles agree.
2. Wait for/refresh the release PR created by Release Please. If no release PR
   appears after a release-relevant merge, inspect the Release Please workflow
   logs before assuming no release is needed.
3. Wait for `release-versions` to update `versions.json` if the release PR
   changed `manifest.json` version.
4. Review the release PR for:
   - correct semver bump
   - accurate changelog entries
   - expected files changed only, including generated `versions.json`
   - coverage of outstanding `.release-intent/*.md` entries
5. Merge the release PR.
6. Confirm the GitHub release was created and release assets are attached.
7. Confirm the `publish-obsidian-assets` workflow completed successfully.
8. Verify `versions.json` contains the released version on `main`.

## LLM Agent Workflow

1. Classify release impact as `none`, `patch`, `minor`, or `breaking`.
2. For `patch`, `minor`, or `breaking`, add a matching
   `.release-intent/YYYY-MM-DD-short-slug.md` file and fill the PR template
   release impact fields.
3. Ensure commit subjects, PR title, and intended merge or squash title match
   `<type>: <description>` conventions and agree with the release intent.
4. Do not manually edit release PR versions unless requested.
5. If release PR CI reports stale `versions.json`, first check whether
   `release-versions` ran, failed, or is waiting on the `RELEASE_PLEASE_TOKEN`
   secret. Only manually run `npm run release:update-versions` if the workflow
   is unavailable.
6. Before merge guidance, verify CI status on the release PR.
7. After release, verify:
   - tag and `manifest.json` version match
   - release assets include all required files
   - `versions.json` contains the new version key
8. If release job fails, diagnose root cause first; do not retag blindly.

## Failure and Recovery

- If Release Please updates its release branch but cannot open a pull request:
  enable read/write workflow permissions and GitHub Actions pull request
  creation, then re-run the workflow; alternatively, manually open a PR from the
  generated release branch.
- If Release Please or `release-versions` reports missing `RELEASE_PLEASE_TOKEN`:
  add the repository secret and re-run the failed workflow.
- If `versions.json` is stale: check the `release-versions` workflow first. If
  manual recovery is still required, run `npm run release:update-versions`,
  commit the result to the release PR branch, and let CI re-check it.
- If Release Please reports no user-facing commits after a release-relevant
  merge: check whether the merge commit or PR title was non-conventional. Use
  `.release-intent/*.md` files and the PR template as the release recovery
  source; do not silently accept the skipped proposal.
- If tag/version mismatch fails release: fix `manifest.json` version via release PR and re-run release.
- If build fails before release: fix code/build pipeline on `main`; Release
  Please will update the release PR.
- If asset publishing fails after release: fix the workflow on `main`, then run
  `publish-obsidian-assets` manually with the existing release tag. Do not retag
  unless the tag or manifest version is wrong.

## Conventions

- Use the enforced conventional commit types from repo policy: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Use `.release-intent/*.md` files for release-relevant normal PRs.
- Treat release PRs as reviewable artifacts, not auto-merge by default.
- Use Node 24 for local release validation and GitHub Actions release builds.
