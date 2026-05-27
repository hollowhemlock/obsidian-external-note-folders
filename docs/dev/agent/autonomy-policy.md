# Agent Autonomy Policy

Status: active workflow authority

Last reviewed: 2026-05-26

This document defines what repository agents may do without asking for another human decision. It
governs autonomy boundaries only; it does not define product behavior.

## Authority Order

Use this order when deciding whether an agent may act autonomously:

1. Current user, system, and developer instructions for the task.
2. [Product Intent](../product/intent.md) for high-level product direction.
3. Accepted ADRs for architectural and safety decisions.
4. Repository procedures, including this policy and the review gate.
5. Plans, testing matrices, coverage ledgers, and task-local notes.
6. Existing implementation and tests.
7. [Improvement Observations](improvement-observations.md), which are advisory only.

This policy governs autonomy. It does not let an agent override product intent, accepted ADRs,
explicit user scope, or current task instructions.

## Autonomy Modes

### Task Execution

Agents may implement the task the user explicitly requested, using the smallest reasonable scope
that satisfies the request and repository authorities.

Agents may choose routine implementation details without asking when those details are reversible,
inside scope, and consistent with existing conventions.

### Autonomous Repair

Agents may autonomously repair validation or CI failures when all scope-preserving repair checks pass:

- The repair preserves the stated task or PR purpose.
- The repair preserves product intent, accepted ADRs, and procedure requirements.
- The repair preserves generated-file invariants.
- The repair does not introduce new product behavior, architecture, dependencies, or release impact.
- The repair touches only files related to the failing validation or changed scope.
- The repair does not reinterpret an advisory observation as a requirement.
- The repair can be validated with the failing check or a narrower equivalent local command.

If any check fails, the agent must stop and report options rather than implement under the label of
repair.

### Improvement Observation

Agents may record non-blocking improvement observations when they notice repeated friction,
maintainability risk, validation gaps, or authority ambiguity.

Improvement observations are advisory and non-normative. They do not authorize code changes, doc
changes, new tests, new dependencies, or scope expansion.

### Follow-Up Proposal And Escalation

Agents should recommend opening an issue, plan, or ADR when an observation recurs at least three
times across unrelated pull requests or tasks, or when a single observation reveals a high-impact
safety, data-loss, release, or authority risk.

Escalation is a recommendation, not an implementation mandate.

## Generated Files

Generated-file validation failures require special handling.

Output-only edits to generated files are invalid unless the user explicitly asks for a temporary or
manual generated-output edit. For durable changes, repair one of these ways:

- Remove the output-only edit if the generated output should remain unchanged.
- Edit the generator or source inputs when the intended change belongs in generated output and the
  generator/source change remains inside stated scope.
- Regenerate the file and commit the generated output when the generator/source already represents
  the intended behavior.

If changing the generator would add new behavior, architecture, dependency, or release impact beyond
the current scope, stop and propose the generator change instead of implementing it as repair.

## Prohibited Autonomous Changes

Agents must not:

- expand scope under the label of optimization;
- implement speculative improvements unless explicitly asked;
- convert advisory observations into policy, tests, or code without an explicit task;
- hide material uncertainty by presenting a guess as a repair;
- resolve product-intent or ADR conflicts silently;
- rewrite history, merge, delete branches, or force-push unless explicitly authorized;
- treat successful local validation as a substitute for required CI-backed evidence at pull request
  or merge gate stages.

## Reporting Requirements

When performing autonomous repair, report:

- the failing validation or CI check;
- the observed root cause;
- why the repair is scope-preserving;
- files changed;
- validation commands and results;
- whether generated files changed and why.

When recording an improvement observation, use the strict template in
[Improvement Observations](improvement-observations.md).
