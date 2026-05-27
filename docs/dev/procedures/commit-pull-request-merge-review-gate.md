# Commit/Pull Request/Merge Review Gate

## Purpose

Define a strict, model-agnostic review contract for three stages:

1. Commit review
2. Pull request review
3. Merge gate

Reviews must also evaluate alignment with
[`docs/dev/product/intent.md`](../product/intent.md). Product intent is the
highest-level product authority; ADRs and procedures refine or constrain it.
Changing product intent does not automatically trigger code changes, but any
behavior, safety, or architecture change that conflicts with current product
intent must make that conflict explicit and resolve it through product-intent
documentation, ADR work, implementation work, or a tracked follow-up.

## Global Contract (All Stages)

### Required Inputs

- `context`: short task/issue summary
- `changed_files`: file list and key diffs
- `commit_sha`
- `test_evidence`: outputs for blocker-relevant validation commands
- `evidence_source`: `ci | local`
- `evidence_timestamp`: ISO-8601
- `ci_run_url` (required when blocker-relevant evidence is CI-backed; required for pull/merge blocker checks)
- `release_context`: `none | patch | minor | breaking`
- `product_intent_alignment`: product-intent principle(s), governing ADR/spec, or `not_applicable` with reason
- `product_intent_change`: `none | clarifies | changes`
- `open_risks`

### Optional Inputs

- `commit_messages` (required where applicable)
- `ci_status` (pull/merge)
- `override_request`: `{ requested_by, reason, scope, expires_at, follow_up_action }`

### Hard Global Rules

- Missing blocker-relevant evidence -> `BLOCK`
- `confidence=low` for any critical-path check -> `BLOCK`
- Required CI-backed checks presented without CI evidence -> `BLOCK`
- Stale or invalid `evidence_timestamp` -> `BLOCK`
- Behavior, safety, or architecture change without product-intent alignment evidence -> `BLOCK`
- Material conflict with product intent without an explicit product-intent/ADR update or tracked follow-up -> `BLOCK`
- Incomplete `override_request` -> keep `BLOCK`
- Override may only downgrade `BLOCK` to `PASS_WITH_WARNINGS` (never `PASS`)
- Product-intent documentation changes do not require implementation in the same change by default

### Evidence Provenance by Stage

- Commit review: `local` or `ci` evidence is acceptable. Local evidence must include exact commands and timestamp.
- Pull request review: blocker-relevant lint, format, and test checks must be `ci`-backed.
- Merge gate: blocker-relevant checks and release validation must be `ci`-backed.

### Required Output Schema

- `Decision`: `PASS | PASS_WITH_WARNINGS | BLOCK`
- `DecisionReasonCodes`: enum list (example: `MISSING_EVIDENCE`, `COMMIT_FORMAT_INVALID`, `TEST_GAP`, `SCOPE_MIXED`, `CI_MISSING`, `RELEASE_MISMATCH`, `PRODUCT_INTENT_MISSING`, `PRODUCT_INTENT_CONFLICT`, `UNRESOLVED_BLOCKERS`, `LOW_CONFIDENCE_CRITICAL`, `OVERRIDE_APPLIED`)
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
  - product intent alignment
  - product intent change handling
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

- Commit subject format/type correctness (`feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`)
- Atomic boundaries (single logical concern)
- TDD alignment when behavior changed (or explicit justified deviation)
- Scope alignment between stated intent and changed files
- Alignment with product intent when behavior, safety, or architecture changes
- Missing tests as blocker vs justified deviation

### Hard Rules

- Invalid commit format -> `BLOCK`
- Behavior changed without test evidence and without justified deviation -> `BLOCK`
- Unrelated concerns mixed in one commit -> `BLOCK`
- Behavior, safety, or architecture change missing product-intent alignment -> `BLOCK`

## Stage 2: Pull Request Review

### Focus

- Pull request template completeness
- CI expectations (lint, format:check, test)
- Release implications and semver mapping
- Product-intent alignment and whether the PR changes high-level intent
- Regression/edge-case findings with file-level evidence
- Explicit assumptions and caveats

### Hard Rules

- Missing or failing CI evidence -> `BLOCK`
- Incorrect release impact label -> `BLOCK`
- Material divergence between pull request scope and commit intent -> `BLOCK`
- Material divergence between pull request behavior and product intent without resolution -> `BLOCK`

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
- Product-intent/ADR conflicts resolved or explicitly tracked
- Post-merge checks when applicable (release assets + `versions.json` expectations)

### Hard Rules

- Output `BLOCK` unless blockers are exactly `none`
- Missing blocker-relevant evidence -> `BLOCK`
- Release pull request with missing required release evidence -> `BLOCK`
- Product-intent conflict without a documented resolution path -> `BLOCK`

## Governance Metadata

This section covers review-process governance metadata. It is separate from
product intent authority, whose source of truth is
[`docs/dev/product/intent.md`](../product/intent.md).

Status: advisory until the repository defines a canonical storage location and
validation automation for this review-process metadata.

Suggested fields:

- `prompt_pack_version` (semver)
- `owner`
- `last_validated_against` (AGENTS/docs/workflow commit SHA values)
- `review_cadence` (for example: monthly and on template/workflow/procedure changes)

Policy:

- Missing/expired governance metadata:
  - Commit/pull/merge review -> at most `PASS_WITH_WARNINGS`
  - Never block by itself until a repository-owned source of truth exists

## Minimum Validation Scenarios

1. Valid bugfix with CI provenance -> commit/pull/merge `PASS`
2. Invalid commit subject format -> commit `BLOCK`
3. Behavior change without tests or deviation note -> commit/pull `BLOCK`
4. `feat` behavior with `none` release impact label -> pull `BLOCK`
5. Release semver/changelog mismatch -> merge `BLOCK`
6. Mixed feature/refactor/tooling in one commit -> commit `BLOCK`
7. Local-only blocker evidence on pull/merge -> `BLOCK`
8. Low confidence on critical behavior classification -> `BLOCK`
9. Override requested without expiry/follow-up -> remains `BLOCK`
10. Missing governance metadata without a repo source of truth -> merge `PASS_WITH_WARNINGS`
11. Behavior change conflicts with product intent and has no product-intent/ADR update or follow-up -> `BLOCK`
12. Product-intent clarification with no implementation change and no claimed behavior change -> `PASS` when normal docs validation passes
