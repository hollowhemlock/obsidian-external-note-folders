# ADR Review Checklist

Use this checklist when reviewing an Architecture Decision Record before accepting it.

## Structural Completeness

- [ ] All template sections are present and filled in (not just placeholder text)
- [ ] Status, Date, and Participants are set
- [ ] ADR number is assigned and title is descriptive

## Context & Motivation

- [ ] Clearly explains *why* a decision is needed now
- [ ] A new team member could understand the problem without prior context
- [ ] Technical, organizational, and timeline constraints are stated

## Decision Drivers

- [ ] Drivers are specific and traceable to real requirements or constraints
- [ ] No vague or generic drivers (e.g., "best practice" without justification)

## Decision Clarity

- [ ] The decision is stated unambiguously in one or two sentences
- [ ] Someone could implement or enforce it without asking follow-up questions

## Alternatives Considered

- [ ] At least two alternatives are considered (including the chosen option)
- [ ] Pros and cons are concrete and specific, not vague
- [ ] Reasoning for rejection/acceptance of each alternative is clear and honest — no straw-man dismissals
- [ ] Effort and complexity of each alternative is addressed

## Consequences & Trade-offs

- [ ] Positive consequences are realistic, not aspirational
- [ ] Negative consequences and trade-offs are acknowledged openly
- [ ] Consequences suggest what to monitor or mitigate

## Non-Goals

- [ ] Non-goals clearly bound the decision and prevent scope creep
- [ ] Nothing listed here contradicts the decision or its consequences

## Future Considerations

- [ ] Identifies conditions that would trigger revisiting this decision
- [ ] States what must remain true if the implementation changes later
- [ ] Required guardrails are documented

## References

- [ ] Related ADRs, issues, or external docs are linked
- [ ] No orphan references to decisions or systems without links

## Overall Quality

- [ ] Tone is neutral and factual
- [ ] Content is concise — no unnecessary background or justification
- [ ] No jargon without explanation

## Review Outcome

Rate the ADR as one of:

- **Ready to Accept** — all sections are complete and clear
- **Revise and Re-review** — minor gaps or unclear sections need rework
- **Major Rework Needed** — missing sections, weak analysis, or unclear decision
