import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import { toExternalRelativeDisplayPath } from './displayPath.ts';
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
  | 'derived-path-error'
  | 'duplicate-note-target'
  | 'duplicate-target-directory';

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
  identity: string;
  notePath: string;
}

interface NoteCandidateBuildResult {
  blockedRows: AdoptionBlockedNoteRow[];
  noteCandidates: NoteCandidate[];
}

export function buildAdoptionPlan(input: {
  externalScan: ExternalScanResult;
  mutationSequence: number;
  notePaths: readonly string[];
  vaultScan: VaultScanResult;
}): AdoptionPlan {
  const errors = buildGlobalErrors(input.vaultScan, input.externalScan);
  const warnings: string[] = [];
  const rows: AdoptionPlanRow[] = [];

  if (errors.length === 0) {
    rows.push(...buildAdoptionRows(input.notePaths, input.externalScan));
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

function buildAdoptionRows(
  notePaths: readonly string[],
  externalScan: ExternalScanResult
): AdoptionPlanRow[] {
  const {
    blockedRows,
    noteCandidates
  } = buildNoteCandidates(notePaths, externalScan.rootPath);
  const noteCandidatesByIdentity = groupByIdentity(noteCandidates);
  const directoryCandidates = externalScan.directories.map((folderPath): DirectoryCandidate => ({
    folderPath,
    identity: normalizePathForIdentity(folderPath)
  }));
  const directoryCandidatesByIdentity = groupByIdentity(directoryCandidates);
  const matchedDirectoryIdentities = new Set<string>();
  const rows: AdoptionPlanRow[] = [...blockedRows];

  for (const noteCandidate of noteCandidates) {
    const noteCandidateSiblings = noteCandidatesByIdentity.get(noteCandidate.identity) ?? [];
    const directoryCandidateSiblings = directoryCandidatesByIdentity.get(noteCandidate.identity) ?? [];

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

    matchedDirectoryIdentities.add(noteCandidate.identity);
    rows.push({
      externalFolder: noteCandidate.externalFolder,
      folderPath: directoryCandidate.folderPath,
      kind: 'adopt',
      notePath: noteCandidate.notePath
    });
  }

  for (const directoryCandidate of directoryCandidates) {
    if (matchedDirectoryIdentities.has(directoryCandidate.identity)) {
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

function buildGlobalErrors(vaultScan: VaultScanResult, externalScan: ExternalScanResult): string[] {
  return [
    ...sortEntries(vaultScan.bindings)
      .map(([uuid, notePath]) => `Existing vault identity at ${notePath}: ${uuid}`),
    ...sortEntries(externalScan.bindings)
      .map(([uuid, folderPath]) => `Existing external marker at ${toExternalRelativeDisplayPath(externalScan.rootPath, folderPath)}: ${uuid}`),
    ...vaultScan.invalidFrontmatter
      .map((issue) => `Invalid frontmatter at ${issue.location}: ${issue.message}`),
    ...externalScan.malformedMarkers
      .map((issue) => `Malformed marker at ${issue.location}: ${issue.message}`),
    ...externalScan.accessErrors
      .map((issue) => `External root access error at ${issue.location}: ${issue.message}`),
    ...externalScan.skippedDirectories
      .map((issue) => `Skipped external directory at ${issue.location}: ${issue.message}`)
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

function buildNoteCandidates(notePaths: readonly string[], externalRootPath: string): NoteCandidateBuildResult {
  const blockedRows: AdoptionBlockedNoteRow[] = [];
  const noteCandidates: NoteCandidate[] = [];
  for (const notePath of notePaths) {
    try {
      const folderPath = deriveExternalFolderPath(notePath, externalRootPath);
      noteCandidates.push({
        externalFolder: toExternalRelativeDisplayPath(externalRootPath, folderPath),
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

function groupByIdentity<T extends { identity: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    groups.set(item.identity, [...(groups.get(item.identity) ?? []), item]);
  }
  return groups;
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
