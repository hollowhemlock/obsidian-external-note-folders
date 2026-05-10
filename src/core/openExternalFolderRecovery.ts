import type { ExpectedExternalFolderState } from './openExternalFolderFlow.ts';
import type {
  ExternalScanResult,
  ScanIssue,
  VaultScanResult
} from './verify.ts';

import {
  normalizeDisplayPath,
  toExternalRelativeDisplayPath
} from './displayPath.ts';
import { normalizePathForIdentity } from './pathPolicy.ts';

export interface OpenExternalFolderRecoveryPlan {
  activeMatches: OpenRecoveryActiveMatchRow[];
  autoOpenFolderPath: null | string;
  canAdoptExpected: boolean;
  canCreateExpected: boolean;
  candidateRows: OpenRecoveryCandidateRow[];
  errors: string[];
  expectedExternalFolder: string;
  expectedFolderPath: string;
  expectedState: Exclude<ExpectedExternalFolderState, { kind: 'bound' }>;
  externalRootPath: string;
  markdownReport: string;
  notePath: string;
  summaryText: string;
  uuid: string;
  warnings: string[];
}

export interface OpenRecoveryActiveMatchRow {
  externalFolder: string;
  folderPath: string;
  uuid: string;
}

export interface OpenRecoveryCandidateRow {
  externalFolder: string;
  folderPath: string;
  markerMessage: null | string;
  markerStatus: OpenRecoveryCandidateStatus;
  markerUuid: null | string;
  ownerNotePath: null | string;
}

export type OpenRecoveryCandidateStatus =
  | 'bound-active'
  | 'bound-other'
  | 'malformed-marker'
  | 'unmarked';

interface FolderMarkerState {
  message: null | string;
  status: OpenRecoveryCandidateStatus;
  uuid: null | string;
}

export function buildOpenExternalFolderRecoveryPlan(input: {
  expectedState: Exclude<ExpectedExternalFolderState, { kind: 'bound' }>;
  externalScan: ExternalScanResult;
  notePath: string;
  uuid: string;
  vaultScan: VaultScanResult;
}): OpenExternalFolderRecoveryPlan {
  const errors = input.externalScan.accessErrors
    .map((issue) => `External root access error at ${issue.location}: ${issue.message}`)
    .sort();
  const expectedFolderPath = input.expectedState.folderPath;
  const expectedFolderIdentity = normalizePathForIdentity(expectedFolderPath);
  const expectedBasenameIdentity = normalizeBasenameForIdentity(expectedFolderPath);
  const activeMatches = buildActiveMatches(input.externalScan, input.uuid);
  const activeMatchIdentities = new Set(activeMatches.map((row) => normalizePathForIdentity(row.folderPath)));
  const malformedMarkerParents = buildMalformedMarkerParents(input.externalScan);
  const markerUuidByFolderIdentity = buildMarkerUuidByFolderIdentity(input.externalScan);
  const candidateRows = input.externalScan.directories
    .filter((folderPath) => normalizeBasenameForIdentity(folderPath) === expectedBasenameIdentity)
    .map((folderPath) =>
      buildCandidateRow({
        activeMatchIdentities,
        folderPath,
        malformedMarkerParents,
        markerUuidByFolderIdentity,
        rootPath: input.externalScan.rootPath,
        uuid: input.uuid,
        vaultScan: input.vaultScan
      })
    );
  const candidateIdentities = new Set(candidateRows.map((row) => normalizePathForIdentity(row.folderPath)));
  const warnings = [
    ...input.externalScan.skippedDirectories.map(formatSkippedDirectoryWarning),
    ...input.externalScan.malformedMarkers
      .filter((issue) => {
        const parentIdentity = normalizePathForIdentity(getParentPath(issue.location));
        return parentIdentity !== expectedFolderIdentity && !candidateIdentities.has(parentIdentity);
      })
      .map((issue) => `Malformed non-candidate marker at ${issue.location}: ${issue.message}`)
  ].sort();
  const canOfferExpectedActions = errors.length === 0 && activeMatches.length === 0;
  const sortedActiveMatches = sortActiveMatches(activeMatches);
  const sortedCandidateRows = sortCandidateRows(candidateRows);
  const summaryText = buildSummaryText({
    activeMatches: sortedActiveMatches,
    candidateRows: sortedCandidateRows,
    errors,
    warnings
  });

  return {
    activeMatches: sortedActiveMatches,
    autoOpenFolderPath: sortedActiveMatches.length === 1 ? sortedActiveMatches[0]?.folderPath ?? null : null,
    canAdoptExpected: canOfferExpectedActions && input.expectedState.kind === 'unmarked',
    canCreateExpected: canOfferExpectedActions && input.expectedState.kind === 'missing',
    candidateRows: sortedCandidateRows,
    errors,
    expectedExternalFolder: toExternalRelativeDisplayPath(input.externalScan.rootPath, expectedFolderPath),
    expectedFolderPath,
    expectedState: input.expectedState,
    externalRootPath: input.externalScan.rootPath,
    markdownReport: buildMarkdownReport({
      activeMatches: sortedActiveMatches,
      candidateRows: sortedCandidateRows,
      errors,
      expectedExternalFolder: toExternalRelativeDisplayPath(input.externalScan.rootPath, expectedFolderPath),
      expectedState: input.expectedState,
      notePath: input.notePath,
      summaryText,
      uuid: input.uuid,
      warnings
    }),
    notePath: input.notePath,
    summaryText,
    uuid: input.uuid,
    warnings
  };
}

function buildActiveMatches(externalScan: ExternalScanResult, uuid: string): OpenRecoveryActiveMatchRow[] {
  const activeMatchPaths = externalScan.duplicatePaths.get(uuid)
    ?? (externalScan.bindings.has(uuid) ? [externalScan.bindings.get(uuid)] : []);
  return activeMatchPaths
    .flatMap((folderPath) => folderPath ? [folderPath] : [])
    .map((folderPath) => ({
      externalFolder: toExternalRelativeDisplayPath(externalScan.rootPath, folderPath),
      folderPath,
      uuid
    }));
}

function buildCandidateRow(input: {
  activeMatchIdentities: Set<string>;
  folderPath: string;
  malformedMarkerParents: Map<string, ScanIssue>;
  markerUuidByFolderIdentity: Map<string, string>;
  rootPath: string;
  uuid: string;
  vaultScan: VaultScanResult;
}): OpenRecoveryCandidateRow {
  const folderIdentity = normalizePathForIdentity(input.folderPath);
  const markerState = getFolderMarkerState({
    activeMatchIdentities: input.activeMatchIdentities,
    folderIdentity,
    malformedMarkerParents: input.malformedMarkerParents,
    markerUuidByFolderIdentity: input.markerUuidByFolderIdentity,
    uuid: input.uuid
  });

  return {
    externalFolder: toExternalRelativeDisplayPath(input.rootPath, input.folderPath),
    folderPath: input.folderPath,
    markerMessage: markerState.message,
    markerStatus: markerState.status,
    markerUuid: markerState.uuid,
    ownerNotePath: markerState.uuid && markerState.uuid !== input.uuid
      ? input.vaultScan.bindings.get(markerState.uuid) ?? null
      : null
  };
}

function buildMalformedMarkerParents(externalScan: ExternalScanResult): Map<string, ScanIssue> {
  const markerParents = new Map<string, ScanIssue>();
  for (const issue of externalScan.malformedMarkers) {
    markerParents.set(normalizePathForIdentity(getParentPath(issue.location)), issue);
  }
  return markerParents;
}

function buildMarkdownReport(input: {
  activeMatches: OpenRecoveryActiveMatchRow[];
  candidateRows: OpenRecoveryCandidateRow[];
  errors: string[];
  expectedExternalFolder: string;
  expectedState: Exclude<ExpectedExternalFolderState, { kind: 'bound' }>;
  notePath: string;
  summaryText: string;
  uuid: string;
  warnings: string[];
}): string {
  return [
    '# Open External Folder Recovery',
    '',
    input.summaryText,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Vault file | ${formatMarkdownCell(input.notePath)} |`,
    `| UUID | ${formatMarkdownCell(input.uuid)} |`,
    `| Expected external folder | ${formatMarkdownCell(input.expectedExternalFolder)} |`,
    `| Expected status | ${formatMarkdownCell(formatExpectedState(input.expectedState))} |`,
    '',
    formatMarkdownList('Errors', input.errors),
    formatMarkdownList('Warnings', input.warnings),
    formatActiveMatches(input.activeMatches),
    formatCandidateRows(input.candidateRows)
  ].join('\n');
}

function buildMarkerUuidByFolderIdentity(externalScan: ExternalScanResult): Map<string, string> {
  const markerUuidByFolderIdentity = new Map<string, string>();
  for (const [uuid, folderPath] of externalScan.bindings) {
    markerUuidByFolderIdentity.set(normalizePathForIdentity(folderPath), uuid);
  }
  for (const [uuid, folderPaths] of externalScan.duplicatePaths) {
    for (const folderPath of folderPaths) {
      markerUuidByFolderIdentity.set(normalizePathForIdentity(folderPath), uuid);
    }
  }
  return markerUuidByFolderIdentity;
}

function buildSummaryText(input: {
  activeMatches: OpenRecoveryActiveMatchRow[];
  candidateRows: OpenRecoveryCandidateRow[];
  errors: string[];
  warnings: string[];
}): string {
  return [
    `${String(input.errors.length)} error(s)`,
    `${String(input.warnings.length)} warning(s)`,
    `${String(input.activeMatches.length)} active UUID match(es)`,
    `${String(input.candidateRows.length)} exact-name candidate(s)`
  ].join(', ');
}

function formatActiveMatches(rows: readonly OpenRecoveryActiveMatchRow[]): string {
  if (rows.length === 0) {
    return '## Active UUID Matches\n\nNone.';
  }

  return [
    '## Active UUID Matches',
    '',
    '| External folder | UUID |',
    '| --- | --- |',
    ...rows.map((row) => `| ${formatMarkdownCell(row.externalFolder)} | ${formatMarkdownCell(row.uuid)} |`)
  ].join('\n');
}

function formatCandidateRows(rows: readonly OpenRecoveryCandidateRow[]): string {
  if (rows.length === 0) {
    return '## Exact-Name Candidates\n\nNone.';
  }

  return [
    '## Exact-Name Candidates',
    '',
    '| External folder | Marker status | Marker UUID | Owner note | Message |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) =>
      [
        formatMarkdownCell(row.externalFolder),
        formatMarkdownCell(row.markerStatus),
        formatMarkdownCell(row.markerUuid ?? '-'),
        formatMarkdownCell(row.ownerNotePath ?? '-'),
        formatMarkdownCell(row.markerMessage ?? '-')
      ].join(' | ')
    )
      .map((row) => `| ${row} |`)
  ].join('\n');
}

function formatExpectedState(expectedState: Exclude<ExpectedExternalFolderState, { kind: 'bound' }>): string {
  if (expectedState.kind === 'malformed-marker') {
    return `malformed marker at ${expectedState.markerPath}: ${expectedState.message}`;
  }

  if (expectedState.kind === 'mismatched-marker') {
    return `bound to different UUID: ${expectedState.markerUuid}`;
  }

  return expectedState.kind;
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

function formatSkippedDirectoryWarning(issue: ScanIssue): string {
  return `Skipped external directory at ${issue.location}: ${issue.message}`;
}

function getBasename(folderPath: string): string {
  const normalizedPath = normalizeDisplayPath(folderPath).replace(/\/+$/u, '');
  return normalizedPath.split('/').at(-1) ?? normalizedPath;
}

function getFolderMarkerState(input: {
  activeMatchIdentities: Set<string>;
  folderIdentity: string;
  malformedMarkerParents: Map<string, ScanIssue>;
  markerUuidByFolderIdentity: Map<string, string>;
  uuid: string;
}): FolderMarkerState {
  const malformedMarker = input.malformedMarkerParents.get(input.folderIdentity);
  if (malformedMarker) {
    return {
      message: `${malformedMarker.location}: ${malformedMarker.message}`,
      status: 'malformed-marker',
      uuid: null
    };
  }

  const markerUuid = input.markerUuidByFolderIdentity.get(input.folderIdentity);
  if (markerUuid) {
    return {
      message: null,
      status: markerUuid === input.uuid ? 'bound-active' : 'bound-other',
      uuid: markerUuid
    };
  }

  if (input.activeMatchIdentities.has(input.folderIdentity)) {
    return {
      message: null,
      status: 'bound-active',
      uuid: input.uuid
    };
  }

  return {
    message: null,
    status: 'unmarked',
    uuid: null
  };
}

function getParentPath(filePath: string): string {
  const normalizedPath = normalizeDisplayPath(filePath);
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
  if (lastSeparatorIndex === -1) {
    return '';
  }

  return normalizedPath.slice(0, lastSeparatorIndex);
}

function normalizeBasenameForIdentity(folderPath: string): string {
  return normalizePathForIdentity(getBasename(folderPath));
}

function sortActiveMatches(rows: OpenRecoveryActiveMatchRow[]): OpenRecoveryActiveMatchRow[] {
  return rows.sort((left, right) => left.externalFolder.localeCompare(right.externalFolder));
}

function sortCandidateRows(rows: OpenRecoveryCandidateRow[]): OpenRecoveryCandidateRow[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.markerStatus}\0${left.externalFolder}`;
    const rightKey = `${right.markerStatus}\0${right.externalFolder}`;
    return leftKey.localeCompare(rightKey);
  });
}
