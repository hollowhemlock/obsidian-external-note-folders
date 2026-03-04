# Commit/Pull Request/Merge Review Gate (v2)

## Purpose

Define a strict, model-agnostic review contract for three stages:

1. Commit review
2. Pull request review
3. Merge gate

## Global Contract (All Stages)

### Required Inputs

- `context`: short task/issue summary
- `changed_files`: file list and key diffs
- `commit_sha`
- `test_evidence`: outputs for `npm run lint`, `npm run format:check`, `npm run test`
- `evidence_source`: `ci | local`
- `evidence_timestamp`: ISO-8601
- `ci_run_url` (required for pull/merge; preferred for commit)
- `release_context`: `none | patch | minor | breaking`
- `open_risks`

### Optional Inputs

- `commit_messages` (required where applicable)
- `ci_status` (pull/merge)
- `override_request`: `{ requested_by, reason, scope, expires_at, follow_up_action }`

### Hard Global Rules

- Missing blocker-relevant evidence -> `BLOCK`
- `confidence=low` for any critical-path check -> `BLOCK`
- Blocker checks backed only by `local` evidence -> `BLOCK`
- Stale or invalid `evidence_timestamp` -> `BLOCK`
- Incomplete `override_request` -> keep `BLOCK`
- Override may only downgrade `BLOCK` to `PASS_WITH_WARNINGS` (never `PASS`)

### Required Output Schema

- `Decision`: `PASS | PASS_WITH_WARNINGS | BLOCK`
- `DecisionReasonCodes`: enum list (example: `MISSING_EVIDENCE`, `COMMIT_FORMAT_INVALID`, `TEST_GAP`, `SCOPE_MIXED`, `CI_MISSING`, `RELEASE_MISMATCH`, `UNRESOLVED_BLOCKERS`, `LOW_CONFIDENCE_CRITICAL`, `OVERRIDE_APPLIED`)
- `Confidence`: `high | medium | low`
- `Findings` (severity ordered):
  - `severity`: `critical | high | medium | low`
  - `location`: file/path/workflow area
  - `evidence`
  - `required_fix`
- `ChecklistStatus`:
  - conventional commit format `<type>: <description>`
  - atomicity/scope
  - tests updated for behavior changes
  - validation commands present
  - release impact correctness
- `MissingEvidence`: list or `none`
- `OverrideStatus`: `none | requested | applied | rejected`
- `MergeReadiness`:
  - `blockers`: list or `none`
  - `clearance_actions`: exact commands/edits needed

### Deterministic Decision Logic

1. Any hard-rule violation -> `BLOCK`
2. No hard-rule violations, unresolved medium/high risk -> `PASS_WITH_WARNINGS`
3. Required checks pass and no unresolved blockers -> `PASS`

## Stage 1: Commit Review

### Focus

- Commit subject format/type correctness (`feat|fix|bug|docs|test|refactor|dev|...`)
- Atomic boundaries (single logical concern)
- TDD alignment when behavior changed (or explicit justified deviation)
- Scope alignment between stated intent and changed files
- Missing tests as blocker vs justified deviation

### Hard Rules

- Invalid commit format -> `BLOCK`
- Behavior changed without test evidence and without justified deviation -> `BLOCK`
- Unrelated concerns mixed in one commit -> `BLOCK`

## Stage 2: Pull Request Review

### Focus

- Pull request template completeness
- CI expectations (lint, format:check, test)
- Release implications and semver mapping
- Regression/edge-case findings with file-level evidence
- Explicit assumptions and caveats

### Hard Rules

- Missing or failing CI evidence -> `BLOCK`
- Incorrect release impact label -> `BLOCK`
- Material divergence between pull request scope and commit intent -> `BLOCK`

### Release Triangulation Rule

Require consistency across:

- `declared_release_impact` (pull request metadata)
- `semantic_intent` (commit types/messages)
- `changed_surface` (actual behavioral/code impact)

Any material inconsistency -> `BLOCK`.

## Stage 3: Merge Gate

### Focus

- Final go/no-go
- Unresolved findings from prior stages
- Conventional-commit/release compatibility
- Release pull request checks (semver/changelog/files changed)
- Post-merge checks when applicable (release assets + `versions.json` expectations)

### Hard Rules

- Output `BLOCK` unless blockers are exactly `none`
- Missing blocker-relevant evidence -> `BLOCK`
- Release pull request with missing/expired governance metadata -> `BLOCK`

## Governance Metadata

Required:

- `prompt_pack_version` (semver)
- `owner`
- `last_validated_against` (AGENTS/docs/workflow commit SHA values)
- `review_cadence` (for example: monthly and on template/workflow/procedure changes)

Policy:

- Missing/expired governance metadata:
  - Commit/pull review -> at least `PASS_WITH_WARNINGS`
  - Merge gate on release pull request -> `BLOCK`

## Minimum Validation Scenarios

1. Valid bugfix with CI provenance -> commit/pull/merge `PASS`
2. Invalid commit subject format -> commit `BLOCK`
3. Behavior change without tests or deviation note -> commit/pull `BLOCK`
4. `feat` behavior with `none` release impact label -> pull `BLOCK`
5. Release semver/changelog mismatch -> merge `BLOCK`
6. Mixed feature/refactor/tooling in one commit -> commit `BLOCK`
7. Local-only blocker evidence -> `BLOCK`
8. Low confidence on critical behavior classification -> `BLOCK`
9. Override requested without expiry/follow-up -> remains `BLOCK`
10. Stale governance metadata on release merge gate -> `BLOCK`
