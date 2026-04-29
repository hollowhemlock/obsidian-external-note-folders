# Procedure: MVP Implementation Workflow

This procedure turns `docs/dev/plans/mvp.md` into an implementation sequence. Use it before coding any MVP item, before starting Phase 0.5 reconciliation-report work, and before starting Phase 1 reconcile execution work.

## Purpose

The MVP plan defines scope. This workflow defines how to move through that scope without losing safety, reviewability, or validation evidence.

Use this procedure with:

- `docs/dev/procedures/tdd-workflow.md`
- `docs/dev/procedures/mvp-validation.md`
- `docs/dev/procedures/commit-pull-request-merge-review-gate.md`

## Phase Status Audit

Before starting implementation, audit `docs/dev/plans/mvp.md` against the current code.

For each checklist item, classify it as:

- `done`: implemented, covered by automated tests or documented manual evidence.
- `partial`: implemented but missing tests, docs, manual validation, or known edge cases.
- `missing`: not implemented.
- `deferred`: intentionally not part of the current phase.

Record the audit in the issue, branch notes, or pull request description. Do not mark an item `done` based only on code existing; it also needs evidence appropriate to its risk.

## Work Item Definition

Each implementation item must have a narrow work statement before coding:

- Plan item reference from `docs/dev/plans/mvp.md`.
- Owning module or boundary, such as core, Obsidian adapter, storage, UI, scripts, or docs.
- Expected behavior in one or two sentences.
- Test type: unit, integration, manual, or documented no-test deviation.
- Validation commands to run before review.
- Safety impact: `read-only`, `frontmatter mutation`, `external create/write`, `external move`, or `release/tooling`.

If the safety impact is `external create/write` or `external move`, identify the preflight checks that must pass before mutation and the exact conditions that abort mutation.

## Implementation Sequence

Use this default order unless a bug fix requires a narrower path:

1. Core pure functions and contracts.
2. Storage/filesystem adapters.
3. Obsidian adapter wiring.
4. Commands and notices/modals.
5. Integration fixtures and manual scenario coverage.
6. README and user-facing documentation.

Do not implement command behavior before the underlying core and storage rules are testable. Command wiring should compose already-tested boundaries rather than hide policy inside UI code.

## Test-Driven Cycle

For behavior changes, follow Red -> Green -> Refactor from `tdd-workflow.md`.

Required minimums:

- Core policies need unit tests.
- Filesystem behavior needs unit tests with temporary directories or integration tests when Obsidian wiring matters.
- Obsidian command behavior needs integration or manual validation evidence if it cannot be reliably unit tested.
- Documentation-only and tooling-only changes may skip tests with an explicit deviation note.

## Mutation Safety Gate

Before coding any mutating behavior, write down the mutation contract:

- What is allowed to be created, written, or moved.
- What must never be deleted or overwritten.
- Which scan or preflight result blocks the mutation.
- How conflicts are reported to the user.
- What partial-write state is possible if the operation is interrupted.
- How a later `Verify` or re-scan reports that partial state.

Mutating implementation must fail closed. If scan integrity, path identity, external-root access, or marker validity is uncertain, abort the mutation.

## Phase 0 Exit Gate

Phase 0 is not complete until all of these are true:

- Every Phase 0 checklist item is classified as `done` or explicitly `deferred`.
- `npm run lint`, `npm run format:check`, `npm run test`, and `npm run build` pass.
- `npm run test:integration` passes or the pull request records why it was skipped.
- The required scenario matrix in `mvp-validation.md` has been executed or explicitly deferred with risk notes.
- README describes current user behavior, no-deletion guarantees, command semantics, and known limitations.
- Review evidence satisfies `commit-pull-request-merge-review-gate.md`.

Do not start Phase 0.5 reconciliation-report work while any Phase 0 done criterion is unresolved, unless the work is an isolated spike that will be deleted or reworked before merge.

## Phase 0.5 Reconciliation Report Entry Gate

Before implementing the read-only reconciliation report, create a work note or pull request section that defines:

- Report inputs and outputs.
- Scan snapshot rules.
- Drift categories, including missing expected folders, unexpected bound folders, orphaned bound folders, and occupied target paths.
- Match heuristics and confidence labels.
- Copyable report format.
- Evidence that the command cannot perform filesystem or vault mutations.
- Manual validation scenarios.

Phase 0.5 is read-only work, but it informs later filesystem-moving behavior. Keep it conservative: suggestions are diagnostic evidence, not instructions to mutate.

Do not start Phase 1 reconcile execution while any Phase 0.5 done criterion is unresolved, unless the work is an isolated spike that will be deleted or reworked before merge.

## Phase 1 Reconcile Entry Gate

Before implementing reconcile execution, create a reconcile work note or pull request section that defines:

- Planner inputs and outputs.
- Immutable scan snapshot rules.
- Dry-run display semantics.
- Execute confirmation semantics.
- Conflict categories and skip behavior.
- Journal entry format.
- Interruption behavior and how the next re-scan recovers.
- Manual validation scenarios.

Reconcile execution is filesystem-moving work. Treat it as higher risk than Phase 0 folder creation and Phase 0.5 reporting.

## Reconcile Implementation Order

Implement Phase 0.5 reconciliation reporting in this order:

1. Pure drift classifier that produces expected, missing, unexpected, orphaned, occupied, and error categories from scan snapshots.
2. Unit tests for classifier cases.
3. Pure match suggester with conservative confidence labels.
4. Unit tests for same-parent rename and normalized basename cases.
5. Read-only command/modal with copyable report output.
6. Console summary logging with the `[external-note-folders]` prefix.
7. Manual validation matrix from `mvp-validation.md`, expanded for drift reporting.

Do not add move, rename, relink, marker-write, or frontmatter-write behavior in Phase 0.5.

Implement Phase 1 reconcile execution in this order:

1. Pure planner that produces moves, skips, conflicts, and warnings from scan snapshots.
2. Unit tests for planner cases, including occupied targets and ancestor/descendant marker collisions.
3. Dry-run command/modal with no filesystem mutation.
4. Execution journal format and writer.
5. Move executor with boundary checks, no-overwrite behavior, and stop-on-first-failure behavior.
6. Command serialization integration.
7. Manual validation matrix from `mvp-validation.md`, expanded for reconcile.

Do not add execute mode until dry-run planning is test-covered and manually understandable.

## Review Handoff

Every pull request implementing MVP behavior should include:

- Plan item references.
- Status audit changes.
- Tests added or explicit no-test deviations.
- Commands run with timestamps or CI links.
- Manual scenarios exercised.
- Residual risks and follow-up items.

If the pull request changes filesystem mutation behavior, include a short mutation safety summary.
