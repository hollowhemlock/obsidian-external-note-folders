import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import {
  normalizeDisplayPath,
  toExternalRelativeDisplayPath
} from './displayPath.ts';
import {
  buildExternalRootIgnoreMatcher,
  formatIgnoredDirectoryWarnings
} from './externalRootIgnore.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

export interface AdoptionAdoptRow {
  externalFolder: string;
  folderPath: string;
  kind: 'adopt';
  notePath: string;
}

export type AdoptionBlockedNoteReason =
  | 'ancestor-bound-folder'
  | 'descendant-bound-folder'
  | 'derived-path-error'
  | 'duplicate-note-target'
  | 'duplicate-target-directory'
  | 'ignored-target'
  | 'target-already-bound'
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
  rows: AdoptionPlanRow[];
  summaryText: string;
  warnings: string[];
}

export type AdoptionPlanRow =
  | AdoptionAdoptRow
  | AdoptionBlockedNoteRow
  | AdoptionUnmatchedExternalFolderRow
  | AdoptionUnmatchedNoteRow;

export interface AdoptionUnmatchedExternalFolderRow {
  externalFolder: string;
  folderPath: string;
  kind: 'unmatched-external-folder';
}

export interface AdoptionUnmatchedNoteRow {
  externalFolder: string;
  kind: 'unmatched-note';
  notePath: string;
}

interface DirectoryCandidate {
  folderPath: string;
  identity: string;
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
  ignoredTargetMatcher: ReturnType<typeof buildExternalRootIgnoreMatcher>;
  markerIdentities: MarkerIdentity[];
  skippedDirectoryIdentities: string[];
}

interface MarkerIdentity {
  identity: string;
  kind: 'malformed' | 'valid';
  message: string;
}

export function buildAdoptionPlan(input: {
  externalScan: ExternalScanResult;
  mutationSequence: number;
  notePaths: readonly string[];
  vaultScan: VaultScanResult;
}): AdoptionPlan {
  const errors = buildGlobalErrors(input.externalScan);
  const warnings = buildWarnings(input.vaultScan, input.externalScan);
  const rows: AdoptionPlanRow[] = [];

  if (errors.length === 0) {
    rows.push(...buildAdoptionRows(input.notePaths, input.vaultScan, input.externalScan));
  }

  const sortedRows = sortRows(rows);
  const summaryText = buildSummaryText(errors, warnings, sortedRows);
  return {
    errors: errors.sort(),
    externalRootPath: input.externalScan.rootPath,
    hasGlobalErrors: errors.length > 0,
    markdownReport: buildMarkdownReport({
      errors: errors.sort(),
      rows: sortedRows,
      summaryText,
      warnings
    }),
    mutationSequence: input.mutationSequence,
    rows: sortedRows,
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
): AdoptionPlanRow[] {
  const {
    blockedRows,
    noteCandidates
  } = buildNoteCandidates(notePaths, vaultScan, externalScan.rootPath);
  const noteCandidatesByIdentity = groupByIdentity(noteCandidates);
  const directoryCandidates = externalScan.directories.map((folderPath): DirectoryCandidate => ({
    folderPath,
    identity: normalizePathForIdentity(folderPath)
  }));
  const noteCandidateIdentities = new Set(noteCandidates.map((candidate) => candidate.identity));
  const context: PlannerContext = {
    directoryCandidatesByIdentity: groupByIdentity(directoryCandidates),
    externalScan,
    ignoredTargetMatcher: buildExternalRootIgnoreMatcher(externalScan.rootPath, externalScan.ignorePatterns),
    markerIdentities: buildMarkerIdentities(externalScan),
    skippedDirectoryIdentities: externalScan.skippedDirectories.map((issue) => normalizePathForIdentity(issue.location))
  };
  const markerParentIdentities = new Set(context.markerIdentities.map((markerIdentity) => markerIdentity.identity));
  const rows: AdoptionPlanRow[] = [...blockedRows];

  for (const noteCandidate of noteCandidates) {
    const noteCandidateSiblings = noteCandidatesByIdentity.get(noteCandidate.identity) ?? [];
    const directoryCandidateSiblings = context.directoryCandidatesByIdentity.get(noteCandidate.identity) ?? [];

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

    if (context.ignoredTargetMatcher.ignoresAbsoluteDirectoryPath(noteCandidate.folderPath)) {
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'blocked-note',
        message: 'Derived external folder path is ignored by external root ignore patterns.',
        notePath: noteCandidate.notePath,
        reason: 'ignored-target'
      });
      continue;
    }

    const skippedDirectory = context.skippedDirectoryIdentities
      .find((skippedIdentity) => isPathInsideOrEqualIdentity(noteCandidate.identity, skippedIdentity));
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
      rows.push({
        externalFolder: noteCandidate.externalFolder,
        kind: 'unmatched-note',
        notePath: noteCandidate.notePath
      });
      continue;
    }

    rows.push({
      externalFolder: noteCandidate.externalFolder,
      folderPath: directoryCandidate.folderPath,
      kind: 'adopt',
      notePath: noteCandidate.notePath
    });
  }

  for (const directoryCandidate of directoryCandidates) {
    if (noteCandidateIdentities.has(directoryCandidate.identity) || markerParentIdentities.has(directoryCandidate.identity)) {
      continue;
    }

    rows.push({
      externalFolder: toExternalRelativeDisplayPath(externalScan.rootPath, directoryCandidate.folderPath),
      folderPath: directoryCandidate.folderPath,
      kind: 'unmatched-external-folder'
    });
  }

  return rows;
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
  rows: AdoptionPlanRow[];
  summaryText: string;
  warnings: string[];
}): string {
  return [
    '# External Folder Adoption Plan',
    '',
    input.summaryText,
    '',
    formatMarkdownList('Errors', input.errors),
    formatMarkdownList('Warnings', input.warnings),
    formatRows('Adoptable Matches', input.rows.filter((row): row is AdoptionAdoptRow => row.kind === 'adopt')),
    formatRows('Blocked Notes', input.rows.filter((row): row is AdoptionBlockedNoteRow => row.kind === 'blocked-note')),
    formatRows('Unmatched Notes', input.rows.filter((row): row is AdoptionUnmatchedNoteRow => row.kind === 'unmatched-note')),
    formatRows('Unmatched External Folders', input.rows.filter((row): row is AdoptionUnmatchedExternalFolderRow => row.kind === 'unmatched-external-folder'))
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

function buildExistingIdentityNotePaths(vaultScan: VaultScanResult): Set<string> {
  const notePaths = new Set(vaultScan.bindings.values());
  for (const duplicateNotePaths of vaultScan.duplicatePaths.values()) {
    for (const notePath of duplicateNotePaths) {
      notePaths.add(notePath);
    }
  }

  return notePaths;
}

function buildSummaryText(errors: readonly string[], warnings: readonly string[], rows: readonly AdoptionPlanRow[]): string {
  return [
    `${String(errors.length)} error(s)`,
    `${String(warnings.length)} warning(s)`,
    `${String(rows.filter((row) => row.kind === 'adopt').length)} adoptable match(es)`,
    `${String(rows.filter((row) => row.kind === 'blocked-note').length)} blocked note(s)`,
    `${String(rows.filter((row) => row.kind === 'unmatched-note').length)} unmatched note(s)`,
    `${String(rows.filter((row) => row.kind === 'unmatched-external-folder').length)} unmatched external folder(s)`
  ].join(', ');
}

function buildWarnings(vaultScan: VaultScanResult, externalScan: ExternalScanResult): string[] {
  return [
    ...formatIgnoredDirectoryWarnings(externalScan.ignoredDirectories),
    ...externalScan.skippedDirectories
      .map((issue) => `Skipped external directory at ${issue.location}: ${issue.message}`),
    ...sortEntries(vaultScan.bindings)
      .map(([uuid, notePath]) => `Existing vault identity at ${notePath}: ${uuid}`),
    ...formatDuplicateWarnings('Vault', vaultScan.duplicatePaths),
    ...vaultScan.invalidFrontmatter
      .map((issue) => `Invalid frontmatter at ${issue.location}: ${issue.message}`),
    ...sortEntries(externalScan.bindings)
      .map(([uuid, folderPath]) => `Existing external marker at ${toExternalRelativeDisplayPath(externalScan.rootPath, folderPath)}: ${uuid}`),
    ...formatDuplicateWarnings('External root', externalScan.duplicatePaths),
    ...externalScan.malformedMarkers
      .map((issue) => `Malformed marker at ${issue.location}: ${issue.message}`)
  ].sort();
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

function findAncestorMarkerConflict(markerIdentities: readonly MarkerIdentity[], targetIdentity: string): MarkerIdentity | null {
  return markerIdentities.find((markerIdentity) =>
    markerIdentity.identity !== targetIdentity
    && isPathInsideOrEqualIdentity(targetIdentity, markerIdentity.identity)
  ) ?? null;
}

function findDescendantMarkerConflict(markerIdentities: readonly MarkerIdentity[], targetIdentity: string): MarkerIdentity | null {
  return markerIdentities.find((markerIdentity) =>
    markerIdentity.identity !== targetIdentity
    && isPathInsideOrEqualIdentity(markerIdentity.identity, targetIdentity)
  ) ?? null;
}

function findExactMarkerConflict(markerIdentities: readonly MarkerIdentity[], targetIdentity: string): MarkerIdentity | null {
  return markerIdentities.find((markerIdentity) => markerIdentity.identity === targetIdentity) ?? null;
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

function isPathInsideOrEqualIdentity(childIdentity: string, parentIdentity: string): boolean {
  const normalizedChildIdentity = normalizeDisplayPath(childIdentity);
  const normalizedParentIdentity = normalizeDisplayPath(parentIdentity);
  if (normalizedChildIdentity === normalizedParentIdentity) {
    return true;
  }

  const parentPrefix = normalizedParentIdentity.endsWith('/') ? normalizedParentIdentity : `${normalizedParentIdentity}/`;
  return normalizedChildIdentity.startsWith(parentPrefix);
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
