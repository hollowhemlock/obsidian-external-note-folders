## Summary

- What changed?
- Why does it matter?

## Validation

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test`
- [ ] Manual verification completed (if behavior/UI changed)

## Release Impact

- [ ] No release impact
- [ ] Patch (`fix`)
- [ ] Minor (`feat`)
- [ ] Breaking (`!` or `BREAKING CHANGE`)

Release intent file, required for patch/minor/breaking: <!-- .release-intent/YYYY-MM-DD-short-slug.md -->

Intended merge/squash title, required for patch/minor/breaking: <!-- e.g., fix: skip ignored adoption descendants -->

Proposed changelog entry, required for patch/minor/breaking:

## ADR / Design References

- Related ADR(s): <!-- e.g., docs/dev/adr/0020-release-please-for-versioning-and-changelog.md -->
- Plan/issue links:

## UI Evidence (if applicable)

- Screenshot(s) / GIF(s):

## Notes for Reviewers

- Risks, edge cases, or follow-ups:

## LLM Agent Checklist (if authored/assisted by an agent)

- [ ] Commit messages follow `<type>: <description>` convention
- [ ] PR title and intended merge/squash title follow conventional commit convention when release-relevant
- [ ] Release impact matches PR template, release intent file, commits, and changed surface
- [ ] Scope is limited to task requirements
- [ ] Tests were added/updated for behavior changes
- [ ] Any assumptions are explicitly documented in this PR
