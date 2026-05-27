# Improvement Observations

Status: advisory, non-normative

This file records recurring or potentially useful process improvements noticed during repository
work. It is not a policy authority and does not authorize implementation. Policy belongs in
procedures, ADRs, product intent, or explicitly accepted plans.

Use this file only when an observation is useful to preserve but should not be auto-implemented as
part of the current task.

## Template

Copy this template for each observation.

```markdown
## YYYY-MM-DD: Short Observation Title

- Date:
- Related PR:
- Context:
- Category:
- Status: observed | escalated | superseded
- Observation:
- Current safe repair:
- Potential improvement:
- Why not auto-implemented:
- Confidence: high | medium | low
- Suggested priority: high | medium | low
- Escalation trigger:
- Superseded by issue/ADR:
```

## Categories

Use stable categories so repeated observations can be counted.

- `generated-file-boundary`
- `validation-gap`
- `agent-scope-risk`
- `authority-ambiguity`
- `test-coverage-gap`
- `documentation-discoverability`
- `release-process-risk`
- `tooling-friction`

## Escalation Rule

Three or more similar observations across unrelated pull requests or tasks should trigger a
recommendation to open an issue, plan, or ADR. A single high-impact safety, data-loss, release, or
authority observation may also justify immediate escalation.

Escalation remains advisory until a human accepts follow-up work.
