---
impact: patch
type: fix
area: recovery
---

# Preserve completed setup when folder opening fails

Keep a resumed scoped setup successful when the file manager cannot open its
completed binding. Report the opening failure separately without reopening the
journal or repeating writes. Add recovery/concurrency fault coverage, a bounded
read-only sandbox readiness check, Windows adapter CI, and a short onboarding
walkthrough as the 2.2 stabilization work.

Alignment: product intent principles 3 (no deletions), 4 (explicit mutation),
and 9 (continuous binding); ADR-0031 and state matrix J19. No settings,
dependencies, migrations, or version metadata changes. This patch completes the
larger 2.2 feature integration; stable publication remains a separate decision.

Evidence and the approved local GUI exception are recorded in
`docs/dev/testing/release-2.2-readiness.md`.
