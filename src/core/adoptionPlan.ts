import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import {
  normalizeDisplayPath,
  toExternalRelativeDisplayPath
} from './displayPath.ts';
import { formatIgnoredDirectoryWarnings } from './externalRootIgnore.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

const RESIDUAL_SAMPLE_LIMIT = 5;

export interface AdoptionAdoptRow {
  externalFolder: string;
  folderPath: string;
  kind: 'adopt';
  notePath: string;
}

export type AdoptionBlockedNoteReason =
  | 'ancestor-bound-folder'
  | 'ancestor-identified-note'
  | 'derived-path-error'
  | 'descendant-bound-folder'
  | 'descendant-identified-note'
  | 'duplicate-note-target'
  | 'duplicate-target-directory'
  | 'ignored-target'
  | 'target-already-bound'
  | 'target-already-identified'
  | 'target-has-malformed-marker'
  | 'target-skipped';

export interface AdoptionBlockedNoteRow {
  externalFolder: null | string;
  kind: 'blocked-note';
  message: string;
  notePath: string;
  reason: AdoptionBlockedNoteReason;
}

export interface AdoptionPlan {
  errors: string[];
  externalRootPath: string;
  hasGlobalErrors: boolean;
  markdownReport: string;
  mutationSequence: number;
  residualGroups: AdoptionResidualGroup[];
  rows: AdoptionPlanRow[];
  summary: AdoptionPlanSummary;
  summaryText: string;
  warnings: string[];
}

export type AdoptionPlanRow =
  | AdoptionAdoptRow
  | AdoptionBlockedNoteRow;

export interface AdoptionPlanSummary {
  adoptableLeafMatches: number;
  blockedCandidates: number;
  errorCount: number;
  prunedExistingBindings: number;
  residualDirectories: number;
  suppressedAncestorCandidates: number;
  warningCount: number;
}

export interface AdoptionResidualGroup {
  directoryCount: number;
  groupPath: string;
  samplePaths: string[];
}

interface AdoptionPlanningResult {
  prunedExistingBindings: number;
  residualGroups: AdoptionResidualGroup[];
  rows: AdoptionPlanRow[];
  suppressedAncestorCandidates: number;
}

interface DirectoryCandidate {
  folderPath: string;
  identity: string;
}

interface IdentifiedNoteTarget {
  identity: string;
  message: string;
}

interface MarkerIdentity {
  identity: string;
  kind: 'malformed' | 'valid';
  message: string;
}

interface NoteCandidate {
  externalFolder: string;
  folderPath: string;
  identity: string;
  notePath: string;
}

interface NoteCandidateBuildResult {
  blockedRows: AdoptionBlockedNoteRow[];
  noteCandidates: NoteCandidate[];
}

interface PlannerContext {
  directoryCandidatesByIdentity: Map<string, DirectoryCandidate[]>;
  externalScan: ExternalScanResult;
  identifiedNoteTargets: IdentifiedNoteTarget[];
  ignoredDirectoryIdentities: ReadonlySet<string>;
  markerIdentities: MarkerIdentity[];
  skippedDirectoryIdentities: string[];
}

interface RelevantFolderIndex {
  ancestorOrSelfIdentities: ReadonlySet<string>;
  relevantIdentities: ReadonlySet<string>;
}

export function buildAdoptionPlan(input: {
  externalScan: ExternalScanResult;
  mutationSequence: number;
  notePaths: readonly string[];
  vaultScan: VaultScanResult;
}): AdoptionPlan {
  const errors = buildGlobalErrors(input.externalScan);
  const warnings = buildWarnings(input.vaultScan, input.externalScan);
  const planningResult = errors.length === 0
    ? buildAdoptionRows(input.notePaths, input.vaultScan, input.externalScan)
    : buildEmptyPlanningResult();
  const sortedRows = sortRows(planningResult.rows);
  const summary = buildSummary(errors, warnings, sortedRows, planningResult);
  const summaryText = buildSummaryText(summary);
  return {
    errors: errors.sort(),
    externalRootPath: input.externalScan.rootPath,
    hasGlobalErrors: errors.length > 0,
    markdownReport: buildMarkdownReport({
      errors: errors.sort(),
      residualGroups: planningResult.residualGroups,
      rows: sortedRows,
      summary,
      summaryText,
      warnings
    }),
    mutationSequence: input.mutationSequence,
    residualGroups: planningResult.residualGroups,
    rows: sortedRows,
    summary,
    summaryText,
    warnings
  };
}

export function getAdoptionRows(plan: AdoptionPlan): AdoptionAdoptRow[] {
  return plan.rows.filter((row): row is AdoptionAdoptRow => row.kind === 'adopt');
}

export function haveSameAdoptionRows(left: AdoptionPlan, right: AdoptionPlan): boolean {
  const leftRows = getAdoptionRows(left).map(toAdoptionRowIdentity).sort();
  const rightRows = getAdoptionRows(right).map(toAdoptionRowIdentity).sort();
  return leftRows.length === rightRows.length
    && leftRows.every((leftRow, index) => leftRow === rightRows[index]);
}

function addMarkerUuid(markerUuidsByFolderIdentity: Map<string, string[]>, folderPath: string, uuid: string): void {
  const folderIdentity = normalizePathForIdentity(folderPath);
  const markerUuids = markerUuidsByFolderIdentity.get(folderIdentity) ?? [];
  markerUuids.push(uuid);
  markerUuidsByFolderIdentity.set(folderIdentity, [...new Set(markerUuids)].sort());
}

function buildAdoptionRows(
  notePaths: readonly string[],
  vaultScan: VaultScanResult,
  externalScan: ExternalScanResult
): AdoptionPlanningResult {
  const {
    blockedRows,
    noteCandidates
  } = buildNoteCandidates(notePaths, vaultScan, externalScan.rootPath);
  const noteCandidatesByIdentity = groupByIdentity(noteCandidates);
  const directoryCandidates = externalScan.directories.map((folderPath): DirectoryCandidate => ({
    folderPath,
    identity: normalizePathForIdentity(folderPath)
  }));
  const context: PlannerContext = {
    directoryCandidatesByIdentity: groupByIdentity(directoryCandidates),
    externalScan,
    identifiedNoteTargets: buildExistingIdentifiedNoteTargets(vaultScan, externalScan.rootPath),
    ignoredDirectoryIdentities: new Set(externalScan.ignoredDirectories.map((directory) => normalizePathForIdentity(directory.folderPath))),
    markerIdentities: buildMarkerIdentities(externalScan),
    skippedDirectoryIdentities: externalScan.skippedDirectories.map((issue) => normalizePathForIdentity(issue.location))
  };
  const relevantCandidates = noteCandidates.filter((noteCandidate) => hasMatchingExternalBranch(noteCandidate, context));
  const suppressedCandidateIdentities = findSuppressedCandidateIdentities(relevantCandidates);
  const rows: AdoptionPlanRow[] = [...blockedRows];

  for (const noteCandidate of relevantCandidates) {
    if (suppressedCandidateIdentities.has(noteCandidate.identity)) {
      continue;
    }

    const noteCandidateSiblings = noteCandidatesByIdentity.get(noteCandidate.identity) ?? [];
    const directoryCandidateSiblings = context.directoryCandidatesByIdentity.get(noteCandidate.identity) ?? [];
    const ignoredDirectory = [...context.ignoredDirectoryIdentities]
      .find((ignoredIdentity) => isPathInsideOrEqualIdentity(noteCandidate.identity, ignoredIdentity));
    const skippedDirectory = context.skippedDirectoryIdentities
      .find((skippedIdentity) => isPathInsideOrEqualIdentity(noteCandidate.identity, skippedIdentity));

    if (noteCandidateSiblings.length > 1) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: `Multiple notes derive the same external folder: ${noteCandidateSiblings.map((candidate) => candidate.notePath).sort().join(', ')}`,
        notePath: noteCandidate.notePath,
        reason: 'duplicate-note-target'
      });
      continue;
    }

    if (ignoredDirectory) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: 'Derived external folder path is ignored by external root ignore patterns.',
        notePath: noteCandidate.notePath,
        reason: 'ignored-target'
      });
      continue;
    }

    if (skippedDirectory) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: 'Derived external folder path is inside a skipped external directory.',
        notePath: noteCandidate.notePath,
        reason: 'target-skipped'
      });
      continue;
    }

    const exactIdentifiedNoteConflict = findExactIdentifiedNoteConflict(context.identifiedNoteTargets, noteCandidate.identity);
    if (exactIdentifiedNoteConflict) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: `Derived external folder path is already reserved by ${exactIdentifiedNoteConflict.message}.`,
        notePath: noteCandidate.notePath,
        reason: 'target-already-identified'
      });
      continue;
    }

    const ancestorIdentifiedNoteConflict = findAncestorIdentifiedNoteConflict(context.identifiedNoteTargets, noteCandidate.identity);
    if (ancestorIdentifiedNoteConflict) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: `Identified ancestor note reserves a folder containing this target: ${ancestorIdentifiedNoteConflict.message}`,
        notePath: noteCandidate.notePath,
        reason: 'ancestor-identified-note'
      });
      continue;
    }

    const descendantIdentifiedNoteConflict = findDescendantIdentifiedNoteConflict(context.identifiedNoteTargets, noteCandidate.identity);
    if (descendantIdentifiedNoteConflict) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: `Identified descendant note reserves a folder inside this target: ${descendantIdentifiedNoteConflict.message}`,
        notePath: noteCandidate.notePath,
        reason: 'descendant-identified-note'
      });
      continue;
    }

    const exactMarkerConflict = findExactMarkerConflict(context.markerIdentities, noteCandidate.identity);
    if (exactMarkerConflict) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: exactMarkerConflict.kind === 'valid'
          ? `Derived external folder path already has marker UUID(s): ${exactMarkerConflict.message}`
          : 'Derived external folder path contains a malformed marker.',
        notePath: noteCandidate.notePath,
        reason: exactMarkerConflict.kind === 'valid' ? 'target-already-bound' : 'target-has-malformed-marker'
      });
      continue;
    }

    const ancestorMarkerConflict = findAncestorMarkerConflict(context.markerIdentities, noteCandidate.identity);
    if (ancestorMarkerConflict) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: `Ancestor bound folder overlaps the derived external folder path: ${ancestorMarkerConflict.message}`,
        notePath: noteCandidate.notePath,
        reason: 'ancestor-bound-folder'
      });
      continue;
    }

    const descendantMarkerConflict = findDescendantMarkerConflict(context.markerIdentities, noteCandidate.identity);
    if (descendantMarkerConflict) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: `Descendant bound folder overlaps the derived external folder path: ${descendantMarkerConflict.message}`,
        notePath: noteCandidate.notePath,
        reason: 'descendant-bound-folder'
      });
      continue;
    }

    if (directoryCandidateSiblings.length > 1) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: 'Multiple external directories have the same normalized identity.',
        notePath: noteCandidate.notePath,
        reason: 'duplicate-target-directory'
      });
      continue;
    }

    const directoryCandidate = directoryCandidateSiblings[0];
    if (!directoryCandidate) {
      continue;
    }

    rows.push({
      externalFolder: noteCandidate.externalFolder,
      folderPath: directoryCandidate.folderPath,
      kind: 'adopt',
      notePath: noteCandidate.notePath
    });
  }

  const adoptableFolderIdentities = new Set(
    rows
      .filter((row): row is AdoptionAdoptRow => row.kind === 'adopt')
      .map((row) => normalizePathForIdentity(row.folderPath))
  );
  const validMarkerIdentities = context.markerIdentities
    .filter((markerIdentity) => markerIdentity.kind === 'valid')
    .map((markerIdentity) => markerIdentity.identity);
  const existingBindingIdentities = new Set([
    ...context.identifiedNoteTargets.map((target) => target.identity),
    ...validMarkerIdentities
  ]);
  const prunedFolderIndex = buildRelevantFolderIndex(
    new Set([
      ...adoptableFolderIdentities,
      ...existingBindingIdentities
    ])
  );

  return {
    prunedExistingBindings: existingBindingIdentities.size,
    residualGroups: buildResidualGroups(directoryCandidates, externalScan.rootPath, prunedFolderIndex),
    rows,
    suppressedAncestorCandidates: suppressedCandidateIdentities.size
  };
}

function buildEmptyPlanningResult(): AdoptionPlanningResult {
  return {
    prunedExistingBindings: 0,
    residualGroups: [],
    rows: [],
    suppressedAncestorCandidates: 0
  };
}

function buildExistingIdentifiedNoteTargets(
  vaultScan: VaultScanResult,
  externalRootPath: string
): IdentifiedNoteTarget[] {
  const uuidByNotePath = new Map<string, string>();
  for (const [uuid, notePath] of vaultScan.bindings) {
    uuidByNotePath.set(notePath, uuid);
  }

  for (const [uuid, notePaths] of vaultScan.duplicatePaths) {
    for (const notePath of notePaths) {
      uuidByNotePath.set(notePath, uuid);
    }
  }

  const targets: IdentifiedNoteTarget[] = [];
  for (const [notePath, uuid] of sortEntries(uuidByNotePath)) {
    try {
      targets.push({
        identity: normalizePathForIdentity(deriveExternalFolderPath(notePath, externalRootPath)),
        message: `note ${notePath} (${uuid})`
      });
    } catch {
      // Invalid identified note paths are reported by vault verification and cannot reserve a derived target.
    }
  }

  return targets;
}

function buildExistingIdentityNotePaths(vaultScan: VaultScanResult): Set<string> {
  const notePaths = new Set(vaultScan.bindings.values());
  for (const duplicateNotePaths of vaultScan.duplicatePaths.values()) {
    for (const notePath of duplicateNotePaths) {
      notePaths.add(notePath);
    }
  }

  return notePaths;
}

function buildGlobalErrors(externalScan: ExternalScanResult): string[] {
  return [
    ...externalScan.accessErrors
      .map((issue) => `External root access error at ${issue.location}: ${issue.message}`),
    ...externalScan.ignoreErrors
      .map((issue) => `Invalid external root ignore pattern ${issue.pattern}: ${issue.message}`)
  ];
}

function buildMarkdownReport(input: {
  errors: string[];
  residualGroups: AdoptionResidualGroup[];
  rows: AdoptionPlanRow[];
  summary: AdoptionPlanSummary;
  summaryText: string;
  warnings: string[];
}): string {
  return [
    '# External Folder Adoption Plan',
    '',
    input.summaryText,
    '',
    'Leaf-first policy: only deepest exact matches are selected. A folder cannot be bound when another candidate or existing binding is below it.',
    '',
    'Confirmation applies to the entire plan. If any selected match looks wrong, close the plan, resolve or ignore that path, and run adoption again.',
    '',
    formatMarkdownList('Errors', input.errors),
    formatMarkdownList('Warnings', input.warnings),
    formatAdoptionRows(input.rows.filter((row): row is AdoptionAdoptRow => row.kind === 'adopt')),
    formatRows('Blocked Notes', input.rows.filter((row): row is AdoptionBlockedNoteRow => row.kind === 'blocked-note')),
    formatResidualGroups(input.residualGroups),
    '## Topology Summary',
    '',
    `- Suppressed ancestor candidates: ${String(input.summary.suppressedAncestorCandidates)}`,
    `- Existing bound folders pruned: ${String(input.summary.prunedExistingBindings)}`
  ].join('\n');
}

function buildMarkerIdentities(externalScan: ExternalScanResult): MarkerIdentity[] {
  const markerUuidsByFolderIdentity = new Map<string, string[]>();
  for (const [uuid, folderPath] of externalScan.bindings) {
    addMarkerUuid(markerUuidsByFolderIdentity, folderPath, uuid);
  }

  for (const [uuid, folderPaths] of externalScan.duplicatePaths) {
    for (const folderPath of folderPaths) {
      addMarkerUuid(markerUuidsByFolderIdentity, folderPath, uuid);
    }
  }

  return [
    ...sortEntries(markerUuidsByFolderIdentity).map(([identity, uuids]): MarkerIdentity => ({
      identity,
      kind: 'valid',
      message: uuids.join(', ')
    })),
    ...externalScan.malformedMarkers.map((issue): MarkerIdentity => ({
      identity: normalizePathForIdentity(getParentPath(issue.location)),
      kind: 'malformed',
      message: `${issue.location}: ${issue.message}`
    }))
  ];
}

function buildNoteCandidates(
  notePaths: readonly string[],
  vaultScan: VaultScanResult,
  externalRootPath: string
): NoteCandidateBuildResult {
  const blockedRows: AdoptionBlockedNoteRow[] = [];
  const noteCandidates: NoteCandidate[] = [];
  const existingIdentityNotePaths = buildExistingIdentityNotePaths(vaultScan);
  const invalidFrontmatterNotePaths = new Set(vaultScan.invalidFrontmatter.map((issue) => issue.location));
  for (const notePath of notePaths) {
    if (existingIdentityNotePaths.has(notePath) || invalidFrontmatterNotePaths.has(notePath)) {
      continue;
    }

    try {
      const folderPath = deriveExternalFolderPath(notePath, externalRootPath);
      noteCandidates.push({
        externalFolder: toExternalRelativeDisplayPath(externalRootPath, folderPath),
        folderPath,
        identity: normalizePathForIdentity(folderPath),
        notePath
      });
    } catch (error: unknown) {
      blockedRows.push({
        externalFolder: null,
        kind: 'blocked-note',
        message: error instanceof Error ? error.message : 'Unable to derive external folder path.',
        notePath,
        reason: 'derived-path-error'
      });
    }
  }

  return {
    blockedRows,
    noteCandidates
  };
}

function buildRelevantFolderIndex(
  relevantFolderIdentities: ReadonlySet<string>
): RelevantFolderIndex {
  const relevantIdentities = new Set(
    [...relevantFolderIdentities].map((identity) => normalizeDisplayPath(identity))
  );
  const ancestorOrSelfIdentities = new Set<string>();
  for (const relevantIdentity of relevantIdentities) {
    for (const ancestorIdentity of getAncestorOrSelfIdentities(relevantIdentity)) {
      ancestorOrSelfIdentities.add(ancestorIdentity);
    }
  }

  return {
    ancestorOrSelfIdentities,
    relevantIdentities
  };
}

function buildResidualGroups(
  directoryCandidates: readonly DirectoryCandidate[],
  externalRootPath: string,
  prunedFolderIndex: RelevantFolderIndex
): AdoptionResidualGroup[] {
  const residualGroupsByPath = new Map<string, AdoptionResidualGroup>();
  for (const directoryCandidate of directoryCandidates) {
    if (isRelatedToRelevantFolder(directoryCandidate.identity, prunedFolderIndex)) {
      continue;
    }

    const relativePath = toExternalRelativeDisplayPath(externalRootPath, directoryCandidate.folderPath);
    const groupPath = normalizeDisplayPath(relativePath).split('/')[0] ?? relativePath;
    const group = residualGroupsByPath.get(groupPath) ?? {
      directoryCount: 0,
      groupPath,
      samplePaths: []
    };
    group.directoryCount += 1;
    group.samplePaths.push(relativePath);
    group.samplePaths.sort();
    if (group.samplePaths.length > RESIDUAL_SAMPLE_LIMIT) {
      group.samplePaths.pop();
    }
    residualGroupsByPath.set(groupPath, group);
  }

  return sortEntries(residualGroupsByPath).map(([, group]) => group);
}

function buildSummary(
  errors: readonly string[],
  warnings: readonly string[],
  rows: readonly AdoptionPlanRow[],
  planningResult: AdoptionPlanningResult
): AdoptionPlanSummary {
  return {
    adoptableLeafMatches: rows.filter((row) => row.kind === 'adopt').length,
    blockedCandidates: rows.filter((row) => row.kind === 'blocked-note').length,
    errorCount: errors.length,
    prunedExistingBindings: planningResult.prunedExistingBindings,
    residualDirectories: planningResult.residualGroups.reduce((total, group) => total + group.directoryCount, 0),
    suppressedAncestorCandidates: planningResult.suppressedAncestorCandidates,
    warningCount: warnings.length
  };
}

function buildSummaryText(summary: AdoptionPlanSummary): string {
  return [
    `${String(summary.errorCount)} error(s)`,
    `${String(summary.warningCount)} warning(s)`,
    `${String(summary.adoptableLeafMatches)} adoptable match(es) (leaf-first)`,
    `${String(summary.suppressedAncestorCandidates)} suppressed ancestor candidate(s)`,
    `${String(summary.blockedCandidates)} blocked candidate(s)`,
    `${String(summary.prunedExistingBindings)} existing bound folder(s) pruned`,
    `${String(summary.residualDirectories)} residual directories`
  ].join(', ');
}

function buildWarnings(vaultScan: VaultScanResult, externalScan: ExternalScanResult): string[] {
  return [
    ...formatIgnoredDirectoryWarnings(externalScan.ignoredDirectories),
    ...externalScan.skippedDirectories
      .map((issue) => `Skipped external directory at ${issue.location}: ${issue.message}`),
    ...formatDuplicateWarnings('Vault', vaultScan.duplicatePaths),
    ...vaultScan.invalidFrontmatter
      .map((issue) => `Invalid frontmatter at ${issue.location}: ${issue.message}`),
    ...formatDuplicateWarnings('External root', externalScan.duplicatePaths),
    ...externalScan.malformedMarkers
      .map((issue) => `Malformed marker at ${issue.location}: ${issue.message}`)
  ].sort();
}

function findAncestorIdentifiedNoteConflict(
  identifiedNoteTargets: readonly IdentifiedNoteTarget[],
  targetIdentity: string
): IdentifiedNoteTarget | null {
  return identifiedNoteTargets.find((identifiedTarget) =>
    identifiedTarget.identity !== targetIdentity
    && isPathInsideOrEqualIdentity(targetIdentity, identifiedTarget.identity)
  ) ?? null;
}

function findAncestorMarkerConflict(markerIdentities: readonly MarkerIdentity[], targetIdentity: string): MarkerIdentity | null {
  return markerIdentities.find((markerIdentity) =>
    markerIdentity.identity !== targetIdentity
    && isPathInsideOrEqualIdentity(targetIdentity, markerIdentity.identity)
  ) ?? null;
}

function findDescendantIdentifiedNoteConflict(
  identifiedNoteTargets: readonly IdentifiedNoteTarget[],
  targetIdentity: string
): IdentifiedNoteTarget | null {
  return identifiedNoteTargets.find((identifiedTarget) =>
    identifiedTarget.identity !== targetIdentity
    && isPathInsideOrEqualIdentity(identifiedTarget.identity, targetIdentity)
  ) ?? null;
}

function findDescendantMarkerConflict(markerIdentities: readonly MarkerIdentity[], targetIdentity: string): MarkerIdentity | null {
  return markerIdentities.find((markerIdentity) =>
    markerIdentity.identity !== targetIdentity
    && isPathInsideOrEqualIdentity(markerIdentity.identity, targetIdentity)
  ) ?? null;
}

function findExactIdentifiedNoteConflict(
  identifiedNoteTargets: readonly IdentifiedNoteTarget[],
  targetIdentity: string
): IdentifiedNoteTarget | null {
  return identifiedNoteTargets.find((identifiedTarget) => identifiedTarget.identity === targetIdentity) ?? null;
}

function findExactMarkerConflict(markerIdentities: readonly MarkerIdentity[], targetIdentity: string): MarkerIdentity | null {
  return markerIdentities.find((markerIdentity) => markerIdentity.identity === targetIdentity) ?? null;
}

function findSuppressedCandidateIdentities(noteCandidates: readonly NoteCandidate[]): Set<string> {
  const candidateIdentities = new Set(noteCandidates.map((candidate) => candidate.identity));
  const suppressedIdentities = new Set<string>();
  for (const candidateIdentity of candidateIdentities) {
    for (const ancestorIdentity of getAncestorOrSelfIdentities(candidateIdentity).slice(1)) {
      const normalizedAncestorIdentity = normalizePathForIdentity(ancestorIdentity);
      if (candidateIdentities.has(normalizedAncestorIdentity)) {
        suppressedIdentities.add(normalizedAncestorIdentity);
      }
    }
  }

  return suppressedIdentities;
}

function formatAdoptionRows(rows: readonly AdoptionAdoptRow[]): string {
  if (rows.length === 0) {
    return '## Adoptable Matches\n\nNone.';
  }

  return [
    '## Adoptable Matches',
    '',
    '| Vault file | Prospective marker |',
    '| --- | --- |',
    ...rows.map((row) => `| ${formatMarkdownCell(row.notePath)} | ${formatMarkdownCell(formatProspectiveMarkerPath(row.externalFolder))} |`)
  ].join('\n');
}

function formatDuplicateWarnings(scopeLabel: string, duplicatePaths: Map<string, string[]>): string[] {
  return sortEntries(duplicatePaths).map(([uuid, paths]) => {
    const sortedPaths = [...paths].sort().join(', ');
    return `${scopeLabel} UUID ${uuid} is duplicated at: ${sortedPaths}`;
  });
}

function formatMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function formatMarkdownList(title: string, items: readonly string[]): string {
  if (items.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    ...items.map((item) => `- ${formatMarkdownCell(item)}`)
  ].join('\n');
}

function formatProspectiveMarkerPath(externalFolder: string): string {
  return `${normalizeDisplayPath(externalFolder)}/<new-uuid>.exnf`;
}

function formatResidualGroups(groups: readonly AdoptionResidualGroup[]): string {
  if (groups.length === 0) {
    return '## Residual External Tree\n\nNone.';
  }

  return [
    '## Residual External Tree',
    '',
    '| Root branch | Directory count | Samples |',
    '| --- | ---: | --- |',
    ...groups.map((group) =>
      `| ${formatMarkdownCell(group.groupPath)} | ${String(group.directoryCount)} | ${formatMarkdownCell(group.samplePaths.join(', '))} |`
    )
  ].join('\n');
}

function formatRows(title: string, rows: readonly AdoptionPlanRow[]): string {
  if (rows.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    '| Kind | Vault file | External folder | Message |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => {
      const notePath = 'notePath' in row ? row.notePath : '-';
      const externalFolder = 'externalFolder' in row && row.externalFolder ? row.externalFolder : '-';
      const message = 'message' in row ? row.message : '';
      return `| ${formatMarkdownCell(row.kind)} | ${formatMarkdownCell(notePath)} | ${formatMarkdownCell(externalFolder)} | ${formatMarkdownCell(message)} |`;
    })
  ].join('\n');
}

function getAncestorOrSelfIdentities(identity: string): string[] {
  const identities: string[] = [];
  let currentIdentity = normalizeDisplayPath(identity);
  while (currentIdentity.length > 0) {
    identities.push(currentIdentity);
    const lastSeparatorIndex = currentIdentity.lastIndexOf('/');
    if (lastSeparatorIndex === -1) {
      break;
    }
    currentIdentity = currentIdentity.slice(0, lastSeparatorIndex);
  }

  return identities;
}

function getParentPath(inputPath: string): string {
  const normalizedPath = normalizeDisplayPath(inputPath);
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
  if (lastSeparatorIndex === -1) {
    return '';
  }

  return normalizedPath.slice(0, lastSeparatorIndex);
}

function groupByIdentity<T extends { identity: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.identity);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.identity, [item]);
    }
  }
  return groups;
}

function hasMatchingExternalBranch(noteCandidate: NoteCandidate, context: PlannerContext): boolean {
  if ((context.directoryCandidatesByIdentity.get(noteCandidate.identity) ?? []).length > 0) {
    return true;
  }

  return [...context.ignoredDirectoryIdentities]
    .some((ignoredIdentity) => isPathInsideOrEqualIdentity(noteCandidate.identity, ignoredIdentity))
    || context.skippedDirectoryIdentities
      .some((skippedIdentity) => isPathInsideOrEqualIdentity(noteCandidate.identity, skippedIdentity));
}

function isPathInsideOrEqualIdentity(childIdentity: string, parentIdentity: string): boolean {
  const normalizedChildIdentity = normalizeDisplayPath(childIdentity);
  const normalizedParentIdentity = normalizeDisplayPath(parentIdentity);
  if (normalizedChildIdentity === normalizedParentIdentity) {
    return true;
  }

  const parentPrefix = normalizedParentIdentity.endsWith('/') ? normalizedParentIdentity : `${normalizedParentIdentity}/`;
  return normalizedChildIdentity.startsWith(parentPrefix);
}

function isRelatedToRelevantFolder(directoryIdentity: string, relevantFolderIndex: RelevantFolderIndex): boolean {
  const normalizedDirectoryIdentity = normalizeDisplayPath(directoryIdentity);
  // Ancestor directories are structural containers, not orphan adoption candidates.
  if (relevantFolderIndex.ancestorOrSelfIdentities.has(normalizedDirectoryIdentity)) {
    return true;
  }

  for (const ancestorIdentity of getAncestorOrSelfIdentities(normalizedDirectoryIdentity)) {
    if (relevantFolderIndex.relevantIdentities.has(ancestorIdentity)) {
      return true;
    }
  }

  return false;
}

function sortEntries<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function sortRows(rows: AdoptionPlanRow[]): AdoptionPlanRow[] {
  return rows.sort((left, right) => {
    const leftNotePath = 'notePath' in left ? left.notePath : '';
    const rightNotePath = 'notePath' in right ? right.notePath : '';
    const leftExternalFolder = 'externalFolder' in left && left.externalFolder ? left.externalFolder : '';
    const rightExternalFolder = 'externalFolder' in right && right.externalFolder ? right.externalFolder : '';
    return `${left.kind}\0${leftNotePath}\0${leftExternalFolder}`.localeCompare(`${right.kind}\0${rightNotePath}\0${rightExternalFolder}`);
  });
}

function toAdoptionRowIdentity(row: AdoptionAdoptRow): string {
  return `${row.notePath}\0${normalizePathForIdentity(row.folderPath)}`;
}
