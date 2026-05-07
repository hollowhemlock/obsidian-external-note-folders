---
status: "Accepted"
date: "2026-03-03"
decision-makers: "Maintainers"
---

# Use Release Please for Versioning and Changelog

## Context and Problem Statement

The repository had no automated release pipeline. `docs/dev/plans/mvp.md` defined a release checklist, but version bumping, changelog generation, and release publication steps were still manual.

For an Obsidian plugin, releases also need consistent assets (`main.js`, `styles.css`, `manifest.json`) attached to GitHub releases. The project needs a low-maintenance workflow that keeps release notes and version metadata accurate from conventional commit messages.

## Decision Drivers

- Reduce manual release overhead and human error
- Generate predictable changelogs from conventional commits
- Keep release process transparent via reviewable pull requests
- Ensure published GitHub releases include required Obsidian plugin artifacts
- Keep `versions.json` reviewable before release publication
- Minimize custom release scripting

## Considered Options

* Manual tagging and handwritten changelog
* Changesets
* semantic-release

## Decision Outcome

Adopt **Release Please** as the release manager.

Implementation choices:

- Run `googleapis/release-please-action` on pushes to `main` with a
  maintainer-owned release token, not the default `GITHUB_TOKEN`
- Use a manifest-based setup (`.github/.release-please-manifest.json`) with config in `.github/release-please-config.json`
- Keep semver tags without a `v` prefix
- Generate/update `CHANGELOG.md` through Release Please
- Update `manifest.json` `version` via Release Please `extra-files` config
- Maintain `versions.json` in the release PR using a dedicated
  `release-versions` workflow that runs `npm run release:update-versions`
- Trigger a separate workflow on GitHub Release `published` to build and upload `main.js`, `styles.css`, and `manifest.json`
- Allow that release asset workflow to be manually rerun for an existing tag
- Pin release validation and GitHub Actions build tooling to Node 24

### Consequences

### Positive
- Changelog generation becomes automatic and consistent
- Version bumps are proposed in a dedicated release PR
- `versions.json` changes are reviewed before publication
- Obsidian release artifacts are published automatically after release publication

### Neutral
- Adds GitHub workflow and Release Please configuration files to maintain

### Negative / Trade-offs
- Release process now depends on commit message quality (`feat`, `fix`, etc.)
- Release automation requires a configured `RELEASE_PLEASE_TOKEN` secret
- Release PRs may temporarily show stale `versions.json` until the
  `release-versions` workflow commits generated metadata

## Pros and Cons of the Options

### Manual tagging and handwritten changelog
- Pros: No CI setup
- Cons: Error-prone, inconsistent, high maintainer overhead
- Why rejected: Does not scale and conflicts with repeatable release goals

### Changesets
- Pros: Strong multi-package workflows, explicit change intent
- Cons: Requires authoring/maintaining changeset files for each change
- Why rejected: Heavier workflow than needed for this single-package repository

### semantic-release
- Pros: Fully automated publishing from commit history
- Cons: Less human checkpointing before releases, more opinionated automation
- Why rejected: Team prefers release PR review before publishing

## More Information

### Non-Goals

- Publishing to external package registries
- Defining branching strategy beyond running release automation from `main`

### Future Considerations

If Release Please continues to create manual recovery work, replace it with a simpler Obsidian-specific version script and tag-driven release workflow.

### References

- [docs/dev/plans/mvp.md](../plans/mvp.md)
- [ADR-0010](0010-use-generator-obsidian-plugin.md)
- [ADR-0017](0017-testing-strategy-by-boundary.md)
