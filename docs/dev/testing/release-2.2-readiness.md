# 2.2 release readiness

Status: validation complete for integration; the maintainer accepted deferring the
beta.8 reconciliation presentation issue to a future update. Stable publication is not authorized by this task. Leave the
Release Please PR unmerged and do not enable auto-merge on it.

## Ownership and approved evidence exception

The maintainer approved integration merges and this local GUI evidence exception
on 2026-10-09 (America/Los_Angeles). The implementation agent owns code, tests,
documentation, integration, and evidence collection. Normal-use beta observations
belong to the maintainer; automated results must not be presented as user feedback.

| Exception field | Accepted value |
| --- | --- |
| Requested/approved by | Repository maintainer, explicit task instruction |
| Reason | Desktop tests use the existing Obsidian sandbox; no Actions runner is registered |
| Scope | Local Obsidian GUI integration and manual acceptance evidence for the 2.2 integration/release sequence |
| Required evidence | Exact revision, commands, environment, results, and relevant logs/screenshots |
| Expires at | 2.2.0 publication or 2026-11-08T23:59:59-08:00, whichever occurs first |
| Follow-up action | Reassess GUI evidence policy before the next minor release |

Only GUI provenance is excepted. Lint, formatting, unit/adapter tests, build, and
release checks remain CI-backed. Failed GUI tests and unproven safety behavior
remain blockers. Review decisions using this exception are PASS_WITH_WARNINGS with
OVERRIDE_APPLIED. No branch protections are bypassed or changed.

## Integration and candidate chain

- Baseline: `78e66035d9e4f090078364748f782dce6e219bde`, published as 2.2.0-beta.8.
- [#49](https://github.com/hollowhemlock/obsidian-external-note-folders/pull/49): health/status, merged into dev as `3369295ce3dcb7855fdb5bc8028e514b72648164`.
- [#50](https://github.com/hollowhemlock/obsidian-external-note-folders/pull/50): missing-marker repair, merged into dev as `463d9ae4f3ab5cfc705105ef9176e76b7f249cc5` after fresh CI.
- [#51](https://github.com/hollowhemlock/obsidian-external-note-folders/pull/51): scoped and continuous adoption, retargeted and merged into dev as `4e281c571507d3af5c9a2b438560f8cd59d5473c` after fresh CI.
- Readiness changes: bounded reload readiness, remaining safety tests, Windows adapter CI, onboarding, and this evidence record.
- [#52](https://github.com/hollowhemlock/obsidian-external-note-folders/pull/52): readiness changes; runtime candidate `5ad9454bf2fe2c640d31369a862aa4707865968b`.
- [2.2.0-beta.9](https://github.com/hollowhemlock/obsidian-external-note-folders/releases/tag/external-note-folders-2.2.0-beta.9) points to that exact runtime candidate; [build/publication](https://github.com/hollowhemlock/obsidian-external-note-folders/actions/runs/38020662070) passed. Later readiness commits change CI or this evidence record only.
- Dev/main integration and the generated stable PR are linked from #52. Stable remains withheld pending a separate publication request.

Use merge commits into dev, then a conventional feature squash merge into main as
required by its linear-history policy. Compare the tested candidate's tree with
the main integration result. Review generated release-only differences separately.
Substantive source/build changes require affected validation again.

## Maintainer-only acceptance

No external testers or waiting period are required. Independent first-use usability
remains unvalidated and is not a release blocker for this maintainer-only cycle.

| Journey | Evidence/status |
| --- | --- |
| Fresh-vault onboarding from README | Agent walkthrough passed; actual sandbox screenshot in README |
| Setup and identity verification | Local setup GUI tests and walkthrough passed |
| Several consecutive adoptions without refresh | Local continuous-adoption GUI test passed |
| Sole, ambiguous, and blocked note suggestions | Controller tests plus rendered sole/blocked suggestion checks passed |
| Missing-marker restoration | Local marker-repair GUI test passed across entry points |
| Interrupted operation and restart recovery | Local scoped/group-adoption GUI tests passed with restart |
| Normal-use observations, confusing decisions, unnecessary steps, delays | Beta.8: status hides a destination bound-parent conflict behind its coverage restriction; maintainer accepted deferral on 2026-10-09 |

Each observation records version, environment, expected/actual behavior, and outcome.
Retest affected journeys after fixes. Preserve settings and representative journals
when upgrading from 2.1.0; do not reset the upgrade fixture between installations.
Use downloaded beta assets for packaged smoke checks, without rebuilding over them.

### Maintainer observation: scoped reconciliation

On 2026-10-09 the maintainer supplied a beta.8 status report for `KeyPass` on Windows.
The note and local marker match by UUID, but the actual folder is under
`projects/software/KeyPass` and the note-derived destination is under
`projects/system-setup/chezmoi/KeyPass`. The report correctly distinguishes matching
identity from path drift, then disables moving because complete checked coverage
is unavailable. No overwritten identity, lost content, or completed-write failure
was reported.

The subsequent reconcile plan reports a concrete destination conflict: the target
folder lies inside another bound folder. The status page does not explain that
bound-parent relationship. Removing the coverage gate alone would therefore not
make this move safe. The maintainer explicitly accepted deferring the complexity
to a future update and suggested consolidating reconciliation into status instead
of keeping a separate command.

Follow-up scope: show the destination's bound ancestor and its associated note
prominently in status; design per-binding reconcile previews/actions in that page;
decide the command's retirement and hotkey compatibility explicitly. Scoped move
eligibility needs checks for known competing locations, source/destination topology,
fresh ownership, exclusions, concurrency, journaling, and resume. Do not reuse
adoption availability as move authorization. This is an accepted 2.2 limitation,
not authorization to remove the command or relax safety checks in this release.

## Validation evidence

- Fresh baseline `npm run test`: 652 tests / 72 files passed on 2026-10-09 local date.
- Existing head-specific CI and GUI evidence is recorded in #49, #50, #51 and their
  release-intent files. Those records do not prove the final readiness candidate.
- Targeted readiness/CLI/setup/storage checks: 54 tests passed. The new scoped-resume
  opener regression failed before the fix; the readiness helper initially failed
  before implementation. Root unavailability preserves the journal and propagates
  its access error for the existing command error UI.
- `npm run test`: 663 tests / 73 files passed at 2026-10-10T03:12:49Z.
- `npm run lint`, `npm run format:check`, `npm run build`,
  `npm run release:check-metadata`, `npm run release:check-versions`, and
  `npm run release:check-assets`: passed locally on the readiness changes.
- An initial GUI run passed 30 tests, but the first preparation logged a zero-exit
  CLI command error. Preparation now rejects those errors and retries startup.
  That first run is not accepted as final-candidate evidence.
- The confirmed-reload run passed 28/30; two keyboard-focus tests failed while
  backgrounded and passed alone and as a nine-test file. Those checks now explicitly
  focus the sandbox and assert focus before exercising navigation, with failure
  diagnostics retained. The next full run passed those checks but timed out in
  continuous adoption (29/30). Additional timeout diagnostics were added before
  the clean-fixture final run below.
- Agent-executed onboarding walkthrough created `Projects/Example.md`, its matching
  empty marker, and a green Healthy row using the README steps. Folder-opening was
  captured through the same adapter used by integration tests.
- Clean-fixture final GUI run at 2026-10-10T03:22:12Z: **30/30 tests in 11 files passed**
  (96.24 seconds), Windows, Node 24, Obsidian 1.13.7. Commands:
  `npm run integration:prepare`, then `npx jiti tmp/run-stable-22-gui.ts`, which invokes
  `vitest run --config vitest.integration.config.ts` while temporarily disabling
  sandbox background throttling and restoring it in `finally`. Keyboard checks
  explicitly focus the sandbox. No tests were skipped in this final run.
  Logs: `tmp/stable-22-gui-reviewed-prepare.log` and `tmp/stable-22-gui-reviewed.log`.
  The intermittent timeout is retained as validation-friction follow-up, not claimed
  as a diagnosed runtime defect or a fixed product bug.
- Actual onboarding screenshot: `docs/images/status-2.2.png`, visually inspected.
- [Cross-platform CI](https://github.com/hollowhemlock/obsidian-external-note-folders/actions/runs/38020953632) passed on `20e9310`: Linux lint, format, build, metadata/assets and 662 tests (one platform-specific skip); Windows 317 tests / 28 files, with no skips. The first Windows run exposed fixture paths using the runner's 8.3 TEMP alias. CI now uses the canonical runner-owned temporary directory; no tests or production path checks were weakened.
- Downloaded beta.9 assets were checked against GitHub SHA-256 digests:

  | Asset | SHA-256 |
  | --- | --- |
  | `main.js` | `37c81e45c6964a5f2617c0b15eeb24e81476a5cfbe5816ecca62810b7ce503be` |
  | `manifest.json` | `c3431c95a598823c11b3390dbd92a04158992c3e846c8b062c8ec83764a15b06` |
  | `styles.css` | `2d8eb5589ce5364535ccf922dda7d92191fded7a93cba37a4523db510a288a89` |

- Packaged upgrade: installed downloaded 2.1.0 assets into a clean disposable sandbox, interrupted setup after marker creation, then installed downloaded beta.9 assets without resetting data. At 2026-10-10T03:34:08Z the same legacy journal completed with its original UUID; settings bytes, note body, and marker modification time were preserved. The initial smoke helper stubbed the wrong opening method, so its opening assertion is excluded; the separate GUI setup checks cover opening. Logs/state: `tmp/stable-22-upgrade-before.json`, `tmp/stable-22-upgrade-after.json`, `tmp/stable-22-upgrade-verified.log`.
- Packaged fresh installation: reset the disposable sandbox, installed downloaded beta.9 assets, confirmed the loaded manifest version, and completed the README setup walkthrough with a healthy binding. The sandbox external root was initialized as its own Git context so the enclosing development checkout's sandbox ignore rule did not hide the fixture. Continuous-adoption smoke passed. A leftover filtered onboarding report interfered with the first marker-repair smoke; after closing it, the marker-repair test passed across setup, recovery, status, and offline-report entry points at 2026-10-10T03:36:22Z. Logs: `tmp/stable-22-packaged-onboarding.log`, `tmp/stable-22-packaged-gui.log`, `tmp/stable-22-packaged-marker.log`.

Data-integrity defects, unsafe mutation eligibility, broken recovery, misleading
success, incomplete core journeys, and failed required checks block readiness.
Performance limitations and lower-impact usability issues need explicit follow-ups.
Keep release publication, a permanent GUI runner, broad UI refactoring, external
recruitment, and Community-directory submission outside this task.
