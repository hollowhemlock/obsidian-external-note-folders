---
status: "Accepted"
date: "2026-05-30"
decision-makers: "Maintainers"
---

# File-Based Release Intent for Release-Relevant Changes

## Context and Problem Statement

ADR-0020 adopted Release Please for versioning, changelog generation, and release
PRs. That decision reduced manual release work, but it made release detection
dependent on conventional commit metadata that can drift at the pull request
merge boundary.

On 2026-05-30, Release Please skipped a merged feature/fix PR because the merge
commit title was not parseable as a conventional commit. The branch commits were
release-relevant, but Release Please reported no user-facing commits after the
last release. This exposed a weak contract for LLM- or agent-authored work:
release intent lived only in commit history and could be lost by a nonconforming
PR or merge title.

The repository needs release intent that is explicit, reviewable, and simple for
agents to update without manually bumping version files.

## Decision Drivers

- Keep release version bumps and changelog edits in dedicated release PRs
- Make release impact explicit before merge
- Give agents a stable file-based contract instead of relying only on prose or
  merge metadata
- Preserve the current Release Please workflow while reducing silent release
  skips
- Keep the workflow lightweight for a single-package Obsidian plugin

## Considered Options

- Keep Release Please only and enforce PR title conventions
- Adopt Changesets immediately
- Add repo-native release intent files while retaining Release Please
- Return to manual version bumps in normal PRs

## Decision Outcome

Adopt **repo-native release intent files while retaining Release Please**.

Release Please remains the current automation for release PR creation, version
file updates, changelog generation, GitHub release creation, and release asset
publication. Release intent files become the canonical review and recovery
artifact for release-relevant normal PRs.

Implementation choices:

- Store release intent files under `.release-intent/`.
- Require one release intent file for every normal PR with `patch`, `minor`, or
  `breaking` release impact.
- Do not require a release intent file for `No release impact`.
- Continue to prohibit normal feature/fix PRs from manually editing
  `package.json`, `manifest.json`, `CHANGELOG.md`, or `versions.json` for
  versioning.
- Require the PR title and intended merge or squash title to remain
  conventional-commit compatible until release automation consumes release
  intent files directly.
- Use release intent files to recover releases if Release Please skips a
  release-relevant merge because commit metadata is unparseable or incomplete.

### Consequences

### Positive

- Release impact is reviewable before merge in a file that agents can reliably
  create and update.
- Release recovery no longer depends on reconstructing intent from branch
  history, PR comments, or memory.
- The repository can later add CI checks around release intent without changing
  the human contract.
- Release Please can remain in place while the repository evaluates whether a
  Changesets-style or custom release flow is worth adopting.

### Neutral

- Release intent files are an additional artifact for release-relevant PRs.
- Until automation consumes these files, Release Please still depends on
  parseable conventional PR or merge titles.

### Negative / Trade-offs

- Reviewers must block release-relevant PRs that omit or contradict release
  intent files.
- Release PRs must remove consumed release intent files unless an archive
  workflow is introduced.
- This is an intermediate contract, not a complete replacement for Release
  Please.

## Pros and Cons of the Options

### Keep Release Please only and enforce PR title conventions

- Pros: Minimal process and no new files.
- Cons: Still keeps release intent in GitHub metadata instead of a durable,
  reviewable artifact.
- Why rejected: It addresses the observed failure mode but does not provide a
  stronger contract for agents.

### Adopt Changesets immediately

- Pros: Mature file-based release intent model with semver-aware automation.
- Cons: Adds dependency and workflow churn before the repository has confirmed
  the need to replace Release Please.
- Why rejected: The repository can capture the important contract now without
  changing the release toolchain in the same step.

### Add repo-native release intent files while retaining Release Please

- Pros: Gives humans and agents explicit release evidence while preserving the
  existing release PR checkpoint.
- Cons: Requires manual comparison and cleanup until automation is added.
- Why accepted: It is the smallest reversible change that fixes the canon gap
  exposed by the skipped release proposal.

### Return to manual version bumps in normal PRs

- Pros: Direct and easy to inspect in each PR.
- Cons: Reintroduces version conflicts, changelog drift, and human error.
- Why rejected: It conflicts with ADR-0020's dedicated release PR model.

## More Information

This ADR refines ADR-0020. It does not supersede Release Please as the current
release manager.

Future work may replace Release Please with Changesets or a repo-native release
script that consumes `.release-intent/` files directly. If that happens, the
file-based release intent contract should remain the source of truth and the
tooling should change around it.

### References

- [ADR-0020](0020-release-please-for-versioning-and-changelog.md)
- [.release-intent/README.md](../../../.release-intent/README.md)
- [docs/dev/procedures/release.md](../procedures/release.md)
