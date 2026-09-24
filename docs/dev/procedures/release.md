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
- Release PR CI runs `npm run release:check-versions` and
  `npm run release:check-metadata` as guardrails after the
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
- After successful asset upload, `publish-obsidian-assets` calls `release-sync`
  with the exact uploaded tag. An older retry never selects a newer release.
  Synchronization checks the latest stable tag, main ancestry, required assets,
  and the packaged manifest against the tagged source before opening a PR.
- `release-sync` also runs when `dev` advances and can be dispatched manually
  from `main` for recovery. A blank tag selects latest stable and performs the
  same asset verification. Failed or incomplete publication blocks recovery.
- Synchronization uses a `release-sync/<version>` helper branch, starting at the
  release commit, and merges `dev` into it without force pushes. Its PR targets
  `dev` and requests merge-commit auto-merge only after checking protections.
  Duplicate runs reuse the owned PR. Older owned PRs close only after a verified
  replacement has been opened and auto-merge enabled; branches are retained.
- Privileged synchronization runs trusted scripts from `main` with no dependency
  installation or candidate-code execution. `RELEASE_PLEASE_TOKEN` needs access
  to contents (including workflow changes), pull requests, branch-protection
  reads, and auto-merge. Its writes must trigger the required PR checks.
- `publish-beta` is a manual prerelease workflow for BRAT testing. It accepts an
  explicit source ref and semantic prerelease version, runs tests and linting,
  builds that ref, and publishes `main.js`, `styles.css`, and a release-only
  manifest under `external-note-folders-<version>`.
- Beta publication does not edit tracked version files or `versions.json`, does
  not mark the release as latest, and refuses to overwrite an existing tag.
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
9. Confirm the synchronization PR merges into `dev` after required checks pass.
   Routine synchronization requires no approving review. Inspect Actions and
   the PR when synchronization is blocked; no tracking issue is created.

## Synchronization Setup and Bootstrap

1. Land tooling through a feature PR into `dev`, then integrate into `main`.
2. Enable repository auto-merge and merge commits. Protect `dev` with strict
   (up-to-date) required checks `validate` and `conventional-commits`, required
   PRs with zero approvals, resolved threads, and enforcement for administrators.
   Disallow force pushes and deletion. Do not require linear history on `dev`;
   synchronization must preserve release ancestry. Retain existing `main` rules.
3. Create a one-time checked catch-up PR from current `main` into `dev`, using a
   helper branch if updating it is necessary. This includes both stable release
   metadata and the new tooling; syncing only an older release tag is insufficient.
4. Before enabling auto-merge on that PR, verify that pending required checks
   prevent merging. After checks pass and it merges, verify the stable commit
   is an ancestor of `dev` and run both metadata checks there. Verify the token
   can create/update a helper PR and request auto-merge without bypassing rules.
5. Dispatch `release-sync` from `main`; an already synchronized branch is a
   successful no-op. Verify `dev` has the beta validation scripts before using
   the stricter beta workflow. Do not retag or republish existing releases.

Do not treat the rollout as complete until these live checks pass. Repository
configuration is a one-time maintainer action; the workflow fails closed when
required protections or permissions are unavailable.

## Beta Workflow

1. Make the candidate commit available on a remote branch, normally `dev`.
   It must contain the latest stable release commit and agree across all tracked
   version files. Its baseline cannot be older than latest stable. Merge the
   release synchronization PR first if either condition fails.
2. From the `publish-beta` workflow on `main`, choose **Run workflow**.
3. Enter the exact source branch, tag, or commit and a new semantic prerelease
   version such as `2.0.1-beta.2`.
4. Confirm tests, linting, build, and release publication all succeeded.
5. Confirm the prerelease tag points to the resolved source commit and includes
   `main.js`, `styles.css`, and `manifest.json`.
6. Install or pin that prerelease in BRAT and test it in the real vault.

The requested version must be a valid semantic prerelease newer than latest
stable. Builds have read-only permissions; publication runs in a fresh job,
revalidates packaged metadata, and checks latest stable immediately before
creating the release. A stable release arriving after that final check is
handled by the next synchronization run; this is not an atomic lock across
stable and beta publication. Failure to resolve latest stable blocks publishing.

Beta artifacts change only the copied manifest. Release notes record source SHA,
source baseline, and artifact version. Tag creation is atomic and refuses an
existing tag. If uploading fails after tag creation, inspect the incomplete
release and use a new beta version; the workflow never overwrites existing tags.

Do not reuse a beta version or move its tag. Publish a new increment when the
candidate changes. Stable releases continue through Release Please.

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

- If synchronization fails or conflicts: inspect the `release-sync/<version>`
  PR and Actions summary. Resolve the conflict on that helper branch through a
  normal commit, or repair failed checks/permissions, then dispatch `release-sync`
  from `main` with the stable tag. Do not force-push or bypass protections.
- If a synchronization PR was closed without merging, inspect and reopen it
  before retrying. Unrecognized branches or PRs are not adopted automatically.
- If a newer stable release appears while synchronization runs, rerun for that
  release after its asset publication succeeds. An older callback never advances
  a newer incomplete release. If `dev` advances, the push trigger refreshes the PR.
- If all tracked versions agree but are older than latest stable, merge the
  synchronization PR. Metadata agreement alone does not prove freshness.
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
