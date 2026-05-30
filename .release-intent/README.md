# Release Intent Files

This directory stores release intent for release-relevant normal pull requests.
It is review evidence for humans and agents; Release Please remains the current
tool that opens release PRs, bumps version files, and publishes releases.

Do not add a release intent file for changes with `No release impact`.

## When to Add a File

Add one file for any pull request that selects one of these release impacts:

- `patch`
- `minor`
- `breaking`

Name files with a date and short slug:

```text
.release-intent/YYYY-MM-DD-short-slug.md
```

## File Format

```markdown
---
impact: patch
type: fix
area: adoption
---

# Prevent ignored adoption descendants

User-visible change:

- Adoption skips folders under ignored external-root paths.

Validation:

- `npm run test`
```

Allowed `impact` values are `patch`, `minor`, and `breaking`.

Allowed `type` values follow the repository's conventional commit policy:
`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, and `revert`.

The title and user-visible change text should be suitable for a changelog entry.

## Review Rules

- The pull request template release impact must match the release intent file.
- The pull request title and intended merge or squash title must be conventional
  and must match the selected release impact.
- Normal feature and fix PRs must not edit `package.json`, `manifest.json`,
  `CHANGELOG.md`, or `versions.json` for versioning.
- If Release Please does not propose a release after a release-relevant merge,
  use these files as the recovery source instead of accepting a silent skip.

## Release PR Handling

When a release PR is reviewed, compare its changelog and semver bump against any
outstanding release intent files. After the release PR captures an intent file's
entry, the release PR should remove the consumed file unless the repository has
introduced an archive workflow.
