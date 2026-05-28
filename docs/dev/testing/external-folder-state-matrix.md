# External Folder State Matrix

Status: Living testing reference

Last updated: 2026-05-23

Scope: Exhaustive state taxonomy for external-folder and vault identity behavior across the plugin's
user-facing commands. This note is not an ADR and does not define product behavior by itself.
Product behavior remains defined by code, specs, ADRs, and user-facing docs. Use this matrix to
flesh out semantic fixtures, integration smoke tests, mutation tests, and regression cases.
Maintenance guidance lives in [Testing Strategy](README.md).

## Commands In Scope

| Command | Mutates vault | Mutates external root | Primary risk |
| --- | --- | --- | --- |
| `Assign external folder identifier` | Yes | No | Minting identity when unsafe |
| `Open external folder` | No, except explicit recovery adoption | Sometimes marker create/adopt | Opening or adopting the wrong folder |
| `Adopt existing external folders` | Yes | Yes | Bulk identity writes |
| `Report external folder drift` | No | No | Silent misclassification |
| `Reconcile external folders` | No | Yes | Moving the wrong folder |
| `Migrate legacy marker files` | No | Yes | Marker migration or data loss |

`VerifyReport` is not a command, but it is test-relevant because it gates assignment and models
integrity state.

## Canonical State Axes

### Global And Scan State

| ID | State | Commands affected |
| --- | --- | --- |
| G0 | External root unset | All scan-dependent commands |
| G1 | External root relative | All scan-dependent commands |
| G2 | External root missing | All scan-dependent commands |
| G3 | External root path is a file | All scan-dependent commands |
| G4 | External root unreadable | All scan-dependent commands |
| G5 | External root valid and empty | All commands |
| G6 | External root valid with readable descendants | All commands |
| G7 | External root has unreadable descendant | Reports warning; affected target may block row |
| G8 | External root has symlink, junction, or reparse descendant | Skipped; must not escape root |
| G9 | Ignore config valid and matches unrelated subtree | All scans should skip subtree |
| G10 | Ignore config matches expected or bound folder | Ignored/unchecked or blocked row |
| G11 | Ignore config invalid: `!` negation | Global blocker |
| G12 | Ignore config invalid: Windows drive or UNC absolute path | Global blocker |
| G13 | Case or Unicode variant paths under root | Path identity and collision tests |
| G14 | Root contains this plugin repo or test fixtures | Broad-root noise tests |

### Vault Note State

| ID | State | Meaning |
| --- | --- | --- |
| V0 | No active file | Active-note commands stop |
| V1 | Active file is not Markdown | Active-note commands stop |
| V2 | Markdown note has no `exnf` | Assign/adoption candidate; open stops |
| V3 | Markdown note has valid canonical `exnf` | Bound identity candidate |
| V4 | Markdown note has malformed `exnf` | Integrity error |
| V5 | Markdown note has non-string `exnf` | Integrity error |
| V6 | Markdown note has uppercase or noncanonical UUID | Integrity error |
| V7 | Two notes share the same valid `exnf` | Duplicate vault identity |
| V8 | More than two notes share the same `exnf` | Duplicate vault identity scale case |
| V9 | Plain note path derives target, such as `A/B.md -> A/B` | Derivation baseline |
| V10 | Folder note derives parent, such as `A/A.md -> A` | Folder-note baseline |
| V11 | Two unassigned notes derive the same target | Adoption duplicate target blocker |
| V12 | Two assigned notes derive the same target | Verify/drift derived collision |
| V13 | Note path case/Unicode variant collides on platform identity | Path policy |
| V14 | Note has valid `exnf` but expected folder is ignored | Ignored/unchecked |
| V15 | Note has valid `exnf` but actual marker is off-path | Drift/reconcile |
| V16 | Note has valid `exnf` but no marker anywhere | Unavailable/missing |
| V17 | Note has valid `exnf`; expected path occupied by unmarked folder | Occupied target |
| V18 | Note has valid `exnf`; expected path occupied by another UUID | Occupied/mismatch |
| V19 | Note has valid `exnf`; expected path contains malformed marker | Integrity/error |

### Expected External Folder State For A Note

| ID | State | Meaning |
| --- | --- | --- |
| T0 | Expected folder missing | Create/recovery/missing |
| T1 | Expected path exists as file | Occupied/block |
| T2 | Expected path exists as directory, empty, unmarked | Adoption/open-confirm/reconcile occupied |
| T3 | Expected path exists as directory, nonempty, unmarked | Same as T2, plus payload preservation |
| T4 | Expected folder has matching `<uuid>.exnf` | Healthy fast path |
| T5 | Expected folder has matching legacy `.exnf` only | Legacy read/migration |
| T6 | Expected folder has matching uuid marker and legacy marker with same UUID | Legacy stale/migration evidence |
| T7 | Expected folder has matching uuid marker and legacy marker with different UUID | Marker conflict |
| T8 | Expected folder has valid marker for different UUID | Mismatched/occupied |
| T9 | Expected folder has malformed uuid-named marker | Malformed |
| T10 | Expected folder has malformed legacy marker | Malformed |
| T11 | Expected folder has multiple uuid markers, one matching active note | Current plus stale/orphan |
| T12 | Expected folder has multiple uuid markers, none matching active note | Occupied/conflict candidates |
| T13 | Expected folder has duplicate markers for same UUID via legacy plus uuid-named | Migration/conflict |
| T14 | Expected folder has marker filename UUID not matching file payload | Malformed/conflict |
| T15 | Expected folder has marker for UUID whose owner note is known | Owner-note display |
| T16 | Expected folder has marker for UUID with no owner note | Orphan evidence |
| T17 | Expected folder is ignored by settings | Ignored target |
| T18 | Expected folder is inside skipped/unreadable subtree | Skipped target |
| T19 | Expected folder is symlink, junction, or reparse point | Fail closed or skipped |
| T20 | Expected folder parent missing | Create path |
| T21 | Expected folder parent unreadable | Access error |
| T22 | Expected folder crosses root boundary after resolution | Fail closed |
| T23 | Expected folder has child bound marker | Overlap conflict |
| T24 | Expected folder is child of existing bound marker | Overlap/descendant conflict |

### Root-Wide External Evidence

| ID | State | Meaning |
| --- | --- | --- |
| R0 | No markers anywhere | No bindings |
| R1 | One marker matching a vault UUID at expected path | Healthy |
| R2 | One marker matching a vault UUID off expected path | Unexpected drift |
| R3 | Multiple markers for same vault UUID in different folders | Duplicate external identity |
| R4 | Marker UUID has no matching vault note | Orphan |
| R5 | Multiple orphan markers with same UUID | Duplicate orphan evidence |
| R6 | Malformed marker unrelated to candidate target | Warning/error depending command |
| R7 | Malformed marker on candidate target | Row blocker |
| R8 | Legacy markers only | Migration candidates |
| R9 | Mixed legacy and uuid-named markers | Migration/conflict cases |
| R10 | Existing unrelated vault identities | Adoption warnings only |
| R11 | Existing unrelated external markers | Adoption warnings only |
| R12 | Ignored subtree contains markers | Invisible to scan evidence |
| R13 | Ignored subtree contains malformed markers | Invisible; no malformed warning |
| R14 | Skipped subtree contains unknown markers | Skipped warning only |
| R15 | Exact-name candidate folder unmarked | Open recovery/adoption candidate |
| R16 | Exact-name candidate folder marked active UUID | Recovery match |
| R17 | Exact-name candidate folder marked other UUID | Display-only candidate |
| R18 | Multiple exact-name candidates | Modal list; no ambiguous auto-adopt |
| R19 | Ancestor container directories of matched folders | Not unmatched external folders |
| R20 | Descendant directories under marked folders | Not unmatched external folders |
| R21 | Case or Unicode duplicate external targets | Collision |
| R22 | External folder contains important payload files | Mutation must preserve |

### Journal And Execution State

| ID | State | Applies to |
| --- | --- | --- |
| J0 | No journal | Normal dry-run |
| J1 | One incomplete adoption journal | Resume modal |
| J2 | Multiple incomplete adoption journals | Block |
| J3 | Completed stale journal | Never blocks |
| J4 | Corrupt journal JSON | Report/block cleanly |
| J5 | Journal wrong kind/version | Block |
| J6 | Journal points to missing external root | Resume fails cleanly |
| J7 | Marker-write failed before mutation | Resume retries row |
| J8 | Marker committed, frontmatter missing | Resume writes frontmatter only |
| J9 | Frontmatter committed, marker missing | Should be impossible; report/block if found |
| J10 | Manual mutation between failure and resume | Resume preflight blocks |
| J11 | Reconcile move journal incomplete | Resume/failure reporting if supported |
| J12 | Marker migration journal incomplete | Resume/failure reporting if supported |
| J13 | Preflight plan changed before apply | Open new plan; no mutation sequence increment |
| J14 | Concurrent command during mutation | Serialized or stale-plan blocked |
| J15 | External write succeeds, notice/modal fails | Data state remains recoverable |

## Command-Specific Test Matrix

### Assign External Folder Identifier

| Combination | Expected behavior |
| --- | --- |
| V0 or V1 | No-op notice |
| V2 + G5/G6 + no integrity errors | Writes valid note UUID only |
| V2 + any verify integrity error | Blocks and opens/report verify details |
| V3 | Reports existing identity; does not rewrite |
| V4/V5/V6 | Blocks invalid frontmatter |
| V7/V8 anywhere in vault | Blocks assignment due duplicate identity |
| R3/R6/R7/R9/G11/G12 | Blocks via verify integrity |
| G7/G8 unrelated | Warning only unless verify treats as integrity |
| Any T state | Irrelevant; assign must not create or write external folders |

### Open External Folder

| Combination | Expected behavior |
| --- | --- |
| V0 or V1 | Stop |
| V2 | Notice: assign/adopt first; no scan |
| V4/V5/V6 | Block invalid identity |
| V3 + T4 | Fast-open expected; no fallback scan |
| V3 + T5 matching legacy | Open if legacy read is supported, or route migration if policy says legacy is not openable |
| V3 + T0 + R0 | Recovery modal offers create expected |
| V3 + T0 + R2 single off-path active UUID | Open actual folder; show drift modal |
| V3 + T0 + R3 duplicate active UUID | No auto-open; modal blocks ambiguity |
| V3 + T2/T3 + R0 | Modal offers write marker/adopt expected |
| V3 + T2/T3 + R2 | Opens actual off-path; reports expected occupied |
| V3 + T8/T9/T10/T13/T14 + R0 | Block expected path; modal shows issue |
| V3 + T17 | Modal says expected ignored; no create/adopt |
| V3 + T18/T19/T22 | Fail closed |
| V3 + R12/R13 active UUID inside ignored subtree | Ignored marker invisible; behaves as no match |
| V3 + R15/R16/R17/R18 | Modal lists exact-name candidates with marker status |
| V3 + candidate malformed | Display malformed candidate; no adoption |
| Confirm adoption + marker appears before confirm | Revalidation blocks |
| Confirm create + folder appears before confirm | Revalidation blocks or converts to occupied flow |
| File-manager open fails | Data unchanged; clear error/notice |

### Report External Folder Drift

| Combination | Expected classification |
| --- | --- |
| V3 + T4 | Healthy/no drift |
| V3 + T0 + R0 | Missing expected folder |
| V3 + T0 + R2 | Unexpected path + suggestion |
| V3 + T2/T3 + no marker | Missing expected + occupied target + medium suggestion |
| V3 + T8 | Occupied/mismatch plus orphan/owner context |
| V3 + T17 | Ignored/unchecked, not healthy/missing/drifted |
| V3 + R4 | Orphan folder |
| V7/V8 | Error duplicate vault UUID |
| R3 | Error duplicate external UUID |
| R6 | Malformed marker error |
| G7/G8 | Warnings |
| G11/G12 | Invalid ignore error; classification omitted if evidence is ambiguous |
| R12/R13 | Ignored markers invisible; only ignored count/path warning if reported |
| T23/T24 | Overlap/occupied/malformed-derived conflict as appropriate |
| Case/Unicode collisions | Collision error or deterministic classification |

### Adopt Existing External Folders

| Combination | Expected row |
| --- | --- |
| V2 + exact T2/T3 + unique target | `adopt` |
| V2 + T0 | No row; adoption reports are external-root driven and do not enumerate unbound vault notes whose derived folders are absent |
| V2 + target ignored T17 | `blocked-note`: `ignored-target` |
| V2 + target skipped T18 | `blocked-note`: `target-skipped` |
| V2 + T4/T5/T8 | `blocked-note`: `target-already-bound` |
| V2 + T9/T10/T14 | `blocked-note`: `target-has-malformed-marker` |
| V2 + T23/T24 | Blocked overlap/conflict |
| V2 + duplicate derived target V11 | Blocked duplicate-note-target |
| V2 + duplicate matching external directories via case/Unicode | Blocked duplicate-target-directory |
| V3/V4/V5/V6 | Existing/invalid vault identity warning; not adoptable |
| R10/R11 unrelated | Warning only; safe rows still adopt |
| R6 unrelated malformed | Warning only; safe rows still adopt |
| G7 unrelated skipped | Warning only; safe rows still adopt |
| G11/G12/root access failure | Global blocker |
| J1 | Resume modal instead of new plan |
| J2 | Block and ask manual inspection |
| J3 | Ignored |
| Apply: marker write succeeds then frontmatter fails | Journal incomplete; resume supported |
| Apply: frontmatter write attempted with marker changed | Stops on first failure |
| Rerun after success | 0 adoptable for adopted rows; payload preserved |

### Reconcile External Folders

| Combination | Expected row |
| --- | --- |
| V3 + T4 | `already-correct` |
| V3 + T0 + R2 | `move` actual folder to expected |
| V3 + T2/T3 + R2 | `conflict`: `target-unmarked-occupied` |
| V3 + T8/T9/T10 + R2 | `conflict`: target already bound or malformed |
| V3 + T17 | `conflict`: `target-ignored` |
| V3 + R0 | `unavailable` |
| R4 | `orphan` |
| R3 | Duplicate external UUID error or conflict |
| V7/V8 | Duplicate vault UUID error |
| G7 unrelated | Warning; plan still builds |
| Target parent missing | Move creates parent if policy supports, otherwise conflict |
| Target parent unreadable | Execution failure with journal |
| Move destination appears after dry-run | Preflight/execute conflict |
| Move source disappears after dry-run | Execution failure; journal |
| Move crosses root/symlink boundary | Block |
| Payload files inside moved folder | Preserved |
| Folder already moved by user before execute | Preflight changed or execution no-op/conflict |

### Migrate Legacy Marker Files

| Combination | Expected row |
| --- | --- |
| Legacy `.exnf` valid, no uuid-named marker | Rename candidate |
| Legacy `.exnf` valid, matching `<uuid>.exnf` exists | Already migrated/stale cleanup evidence |
| Legacy `.exnf` valid, different uuid-named marker exists | Conflict blocker |
| Legacy `.exnf` malformed | Global blocker |
| Uuid-named marker malformed | Global blocker |
| Legacy marker filename plus payload mismatch | Malformed/block |
| Ignored subtree with legacy markers | Invisible/no migration |
| Skipped subtree with possible legacy markers | Skipped warning |
| Target `<uuid>.exnf` appears before execute | Preflight changed/block |
| Legacy marker changes UUID before execute | Execution fail closed |
| Rename succeeds but journal write fails | Recoverable state documented |
| Legacy marker absent before execute | Execution fail closed |
| Duplicate legacy markers same UUID in different folders | Duplicate external identity or migration blocker |

### Verify Report And Integrity Preflight

| Combination | Expected behavior |
| --- | --- |
| V3 + T4 | OK |
| V3 + R0 | Unavailable |
| V3 + T17 | Ignored/unchecked |
| V7/V8 | Error |
| R3 | Error |
| R6/R7 | Error |
| R8 | Warning: legacy marker should migrate |
| G7/G8 | Warning |
| G11/G12 | Error |
| V12 derived target collision | Error |
| R4 orphan marker | Warning row |
| R12 ignored orphan marker | Invisible |
| G4 unreadable root | Access error; classification omitted |

## Highest-Value Fixture Scenarios

Do not build one giant fixture for everything. Use a small number of omnibus fixtures for reports,
plus focused fixtures for mutation commands.

| Scenario | Purpose |
| --- | --- |
| `drift-report/basic-drift-matrix` | Expected/missing/orphan/unexpected/occupied/suggestion |
| `verify/duplicate-vault-uuid` | Duplicate frontmatter identity |
| `verify/duplicate-external-uuid` | Copied marker in two folders |
| `verify/ignored-bound-folder` | Ignored/unchecked, not missing |
| `verify/invalid-ignore-settings` | Global blocker |
| `open/fast-path-valid-expected` | Expected marker opens without scan |
| `open/missing-expected-single-offpath` | Recovery opens actual and reports drift |
| `open/missing-expected-duplicate-offpath` | Duplicate active UUID blocks auto-open |
| `open/unmarked-expected-confirm` | Explicit marker adoption with revalidation |
| `open/malformed-expected-with-candidates` | Modal lists candidates and blocks unsafe target |
| `adoption/mixed-root-safe-partial` | Unrelated markers/skips do not suppress safe rows |
| `adoption/target-marker-blockers` | Valid/malformed/mismatched marker on candidate blocks only row |
| `adoption/ignored-and-skipped-targets` | Ignored/skipped target rows block specifically |
| `adoption/duplicate-derived-targets` | No row adopted when notes collide |
| `adoption/resume-frontmatter-failure` | Marker committed, frontmatter pending |
| `reconcile/move-with-occupied-target` | Move row plus target conflict row |
| `reconcile/ignored-target` | Ignored target is conflict, not unavailable |
| `reconcile/source-missing-or-duplicate` | Unavailable/duplicate behavior |
| `migration/basic-legacy-to-uuid` | `.exnf` renamed to `<uuid>.exnf` |
| `migration/conflicting-new-marker` | Legacy migration conflict |
| `migration/ignored-legacy-subtree` | Ignored legacy marker invisible |

## Coverage Model

| Layer | Coverage target |
| --- | --- |
| Core semantic tests | Every classification row/state above |
| Integration smoke | Command registration, modal appears, copyable report, settings load |
| Integration mutation | Adoption apply, reconcile move, marker migration rename, journal/resume |
| Scanner fidelity | Production Obsidian scan equals fixture scanner for every new semantic fixture domain |
| Regression fixtures | Broad-root repo noise, ignored subtrees, EPERM/skipped dirs, payload preservation |

Coverage tracking lives in
[External Folder State Coverage](external-folder-state-coverage.json). The ledger must account for
every canonical state ID in this matrix as either covered by a committed scenario or planned for a
specific future fixture group. `npm run test` validates that the ledger stays synchronized with this
matrix and with committed expected JSON.
