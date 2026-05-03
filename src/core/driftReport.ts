import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import { toExternalRelativeDisplayPath } from './displayPath.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';
import { buildVerifyReport } from './verify.ts';

export interface DriftBindingRow {
  actualExternalFolder: null | string;
  expectedExternalFolder: null | string;
  notePath: null | string;
  uuid: string;
}

export interface DriftOccupiedRow {
  expectedExternalFolder: string;
  notePath: string;
  reason: string;
  uuid: string;
}

export interface DriftReport {
  errors: string[];
  expectedRows: DriftBindingRow[];
  markdownReport: string;
  missingRows: DriftBindingRow[];
  occupiedRows: DriftOccupiedRow[];
  orphanRows: DriftBindingRow[];
  suggestions: DriftSuggestion[];
  summaryText: string;
  unexpectedRows: DriftBindingRow[];
}

export interface DriftSuggestion {
  candidateExternalFolder: string;
  confidence: 'high' | 'low' | 'medium';
  expectedExternalFolder: string;
  notePath: string;
  rationale: string;
  uuid: string;
}

export function buildDriftReport(vaultScan: VaultScanResult, externalScan: ExternalScanResult): DriftReport {
  const verifyReport = buildVerifyReport(vaultScan, externalScan);
  const expectedRows: DriftBindingRow[] = [];
  const missingRows: DriftBindingRow[] = [];
  const occupiedRows: DriftOccupiedRow[] = [];
  const orphanRows: DriftBindingRow[] = [];
  const unexpectedRows: DriftBindingRow[] = [];

  if (!verifyReport.classificationOmitted) {
    const bindingPathsByIdentity = buildBindingPathsByIdentity(externalScan.bindings);
    const directoryIdentities = new Set(externalScan.directories.map((directoryPath) => normalizePathForIdentity(directoryPath)));

    for (const [uuid, notePath] of sortEntries(vaultScan.bindings)) {
      const expectedFolderPath = deriveExternalFolderPath(notePath, externalScan.rootPath);
      const expectedExternalFolder = toExternalRelativeDisplayPath(externalScan.rootPath, expectedFolderPath);
      const actualFolderPath = externalScan.bindings.get(uuid);

      if (!actualFolderPath) {
        missingRows.push({
          actualExternalFolder: null,
          expectedExternalFolder,
          notePath,
          uuid
        });
        addOccupiedRowIfNeeded({
          bindingPathsByIdentity,
          directoryIdentities,
          expectedExternalFolder,
          expectedFolderPath,
          notePath,
          occupiedRows,
          uuid
        });
        continue;
      }

      const actualExternalFolder = toExternalRelativeDisplayPath(externalScan.rootPath, actualFolderPath);
      if (normalizePathForIdentity(actualFolderPath) === normalizePathForIdentity(expectedFolderPath)) {
        expectedRows.push({
          actualExternalFolder,
          expectedExternalFolder,
          notePath,
          uuid
        });
        continue;
      }

      unexpectedRows.push({
        actualExternalFolder,
        expectedExternalFolder,
        notePath,
        uuid
      });
      addOccupiedRowIfNeeded({
        bindingPathsByIdentity,
        directoryIdentities,
        expectedExternalFolder,
        expectedFolderPath,
        notePath,
        occupiedRows,
        uuid
      });
    }

    for (const [uuid, boundFolderPath] of sortEntries(externalScan.bindings)) {
      if (!vaultScan.bindings.has(uuid)) {
        orphanRows.push({
          actualExternalFolder: toExternalRelativeDisplayPath(externalScan.rootPath, boundFolderPath),
          expectedExternalFolder: null,
          notePath: null,
          uuid
        });
      }
    }
  }

  const suggestions = buildSuggestions({
    externalScan,
    missingRows,
    orphanRows,
    unexpectedRows
  });
  const summaryText = [
    `${String(verifyReport.errors.length)} error(s)`,
    `${String(unexpectedRows.length)} unexpected path(s)`,
    `${String(missingRows.length)} missing expected folder(s)`,
    `${String(orphanRows.length)} orphan folder(s)`,
    `${String(occupiedRows.length)} occupied target(s)`,
    `${String(suggestions.length)} suggestion(s)`
  ].join(', ');

  return {
    errors: verifyReport.errors,
    expectedRows: sortRows(expectedRows),
    markdownReport: buildMarkdownReport({
      errors: verifyReport.errors,
      missingRows: sortRows(missingRows),
      occupiedRows: sortOccupiedRows(occupiedRows),
      orphanRows: sortRows(orphanRows),
      suggestions: sortSuggestions(suggestions),
      summaryText,
      unexpectedRows: sortRows(unexpectedRows)
    }),
    missingRows: sortRows(missingRows),
    occupiedRows: sortOccupiedRows(occupiedRows),
    orphanRows: sortRows(orphanRows),
    suggestions: sortSuggestions(suggestions),
    summaryText,
    unexpectedRows: sortRows(unexpectedRows)
  };
}

export function hasActionableDriftForUuid(report: DriftReport, uuid: string): boolean {
  return report.unexpectedRows.some((row) => row.uuid === uuid)
    || report.occupiedRows.some((row) => row.uuid === uuid)
    || report.suggestions.some((row) => row.uuid === uuid);
}

function addOccupiedRowIfNeeded(input: {
  bindingPathsByIdentity: Map<string, string>;
  directoryIdentities: Set<string>;
  expectedExternalFolder: string;
  expectedFolderPath: string;
  notePath: string;
  occupiedRows: DriftOccupiedRow[];
  uuid: string;
}): void {
  const expectedPathIdentity = normalizePathForIdentity(input.expectedFolderPath);
  if (!input.directoryIdentities.has(expectedPathIdentity)) {
    return;
  }

  const occupyingUuid = input.bindingPathsByIdentity.get(expectedPathIdentity);
  if (occupyingUuid === input.uuid) {
    return;
  }

  input.occupiedRows.push({
    expectedExternalFolder: input.expectedExternalFolder,
    notePath: input.notePath,
    reason: occupyingUuid ? `Bound to different UUID: ${occupyingUuid}` : 'Unmarked folder occupies expected path.',
    uuid: input.uuid
  });
}

function buildBindingPathsByIdentity(bindings: Map<string, string>): Map<string, string> {
  const pathsByIdentity = new Map<string, string>();
  for (const [uuid, folderPath] of bindings) {
    pathsByIdentity.set(normalizePathForIdentity(folderPath), uuid);
  }
  return pathsByIdentity;
}

function buildMarkdownReport(input: {
  errors: string[];
  missingRows: DriftBindingRow[];
  occupiedRows: DriftOccupiedRow[];
  orphanRows: DriftBindingRow[];
  suggestions: DriftSuggestion[];
  summaryText: string;
  unexpectedRows: DriftBindingRow[];
}): string {
  return [
    '# External Folder Drift Report',
    '',
    input.summaryText,
    '',
    formatMarkdownList('Errors', input.errors),
    formatBindingRows('Unexpected Paths', input.unexpectedRows),
    formatBindingRows('Missing Expected Folders', input.missingRows),
    formatBindingRows('Orphan Folders', input.orphanRows),
    formatOccupiedRows(input.occupiedRows),
    formatSuggestionRows(input.suggestions)
  ].join('\n');
}

function buildNameSuggestion(row: DriftBindingRow, candidateExternalFolder: string): DriftSuggestion | null {
  if (!row.notePath || !row.expectedExternalFolder) {
    return null;
  }

  const sameParent = getParentPath(row.expectedExternalFolder) === getParentPath(candidateExternalFolder);
  const sameNormalizedBasename = normalizeName(getBasename(row.expectedExternalFolder)) === normalizeName(getBasename(candidateExternalFolder));

  if (!sameParent && !sameNormalizedBasename) {
    return null;
  }

  return {
    candidateExternalFolder,
    confidence: sameParent && sameNormalizedBasename ? 'medium' : 'low',
    expectedExternalFolder: row.expectedExternalFolder,
    notePath: row.notePath,
    rationale: getSuggestionRationale(sameParent, sameNormalizedBasename),
    uuid: row.uuid
  };
}

function buildSuggestions(input: {
  externalScan: ExternalScanResult;
  missingRows: DriftBindingRow[];
  orphanRows: DriftBindingRow[];
  unexpectedRows: DriftBindingRow[];
}): DriftSuggestion[] {
  const suggestions: DriftSuggestion[] = [];

  for (const row of input.unexpectedRows) {
    if (!row.notePath || !row.expectedExternalFolder || !row.actualExternalFolder) {
      continue;
    }

    suggestions.push({
      candidateExternalFolder: row.actualExternalFolder,
      confidence: 'high',
      expectedExternalFolder: row.expectedExternalFolder,
      notePath: row.notePath,
      rationale: 'Same UUID is bound at a non-expected path.',
      uuid: row.uuid
    });
  }

  const orphanCandidates = input.orphanRows.flatMap((row) => row.actualExternalFolder ? [row.actualExternalFolder] : []);
  const unmarkedCandidates = getUnmarkedCandidateFolders(input.externalScan);
  const candidateFolders = [...new Set([...orphanCandidates, ...unmarkedCandidates])].sort();

  for (const row of input.missingRows) {
    if (!row.notePath || !row.expectedExternalFolder) {
      continue;
    }

    for (const candidateFolder of candidateFolders) {
      const suggestion = buildNameSuggestion(row, candidateFolder);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }
  }

  return suggestions;
}

function formatBindingRows(title: string, rows: DriftBindingRow[]): string {
  if (rows.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    '| Vault file | Expected external folder | Actual external folder | UUID |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.notePath ?? '-'} | ${row.expectedExternalFolder ?? '-'} | ${row.actualExternalFolder ?? '-'} | ${row.uuid} |`)
  ].join('\n');
}

function formatMarkdownList(title: string, items: string[]): string {
  if (items.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    ...items.map((item) => `- ${item}`)
  ].join('\n');
}

function formatOccupiedRows(rows: DriftOccupiedRow[]): string {
  if (rows.length === 0) {
    return '## Occupied Target Paths\n\nNone.';
  }

  return [
    '## Occupied Target Paths',
    '',
    '| Vault file | Expected external folder | Reason | UUID |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.notePath} | ${row.expectedExternalFolder} | ${row.reason} | ${row.uuid} |`)
  ].join('\n');
}

function formatSuggestionRows(rows: DriftSuggestion[]): string {
  if (rows.length === 0) {
    return '## Suggestions\n\nNone.';
  }

  return [
    '## Suggestions',
    '',
    '| Vault file | Expected external folder | Candidate external folder | Confidence | Rationale |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.notePath} | ${row.expectedExternalFolder} | ${row.candidateExternalFolder} | ${row.confidence} | ${row.rationale} |`)
  ].join('\n');
}

function getBasename(folderPath: string): string {
  return folderPath.split('/').at(-1) ?? folderPath;
}

function getParentPath(folderPath: string): string {
  const segments = folderPath.split('/');
  segments.pop();
  return segments.join('/');
}

function getSuggestionRationale(sameParent: boolean, sameNormalizedBasename: boolean): string {
  if (sameParent && sameNormalizedBasename) {
    return 'Same parent and normalized basename match.';
  }

  if (sameParent) {
    return 'Same parent as the expected folder.';
  }

  return 'Normalized basename matches the expected folder.';
}

function getUnmarkedCandidateFolders(externalScan: ExternalScanResult): string[] {
  const boundFolderIdentities = new Set([...externalScan.bindings.values()].map((folderPath) => normalizePathForIdentity(folderPath)));
  return externalScan.directories
    .filter((folderPath) => !boundFolderIdentities.has(normalizePathForIdentity(folderPath)))
    .map((folderPath) => toExternalRelativeDisplayPath(externalScan.rootPath, folderPath));
}

function normalizeName(input: string): string {
  return input.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function sortEntries<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function sortOccupiedRows(rows: DriftOccupiedRow[]): DriftOccupiedRow[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.notePath}\0${left.expectedExternalFolder}\0${left.uuid}`;
    const rightKey = `${right.notePath}\0${right.expectedExternalFolder}\0${right.uuid}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sortRows(rows: DriftBindingRow[]): DriftBindingRow[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.notePath ?? ''}\0${left.expectedExternalFolder ?? ''}\0${left.actualExternalFolder ?? ''}\0${left.uuid}`;
    const rightKey = `${right.notePath ?? ''}\0${right.expectedExternalFolder ?? ''}\0${right.actualExternalFolder ?? ''}\0${right.uuid}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sortSuggestions(rows: DriftSuggestion[]): DriftSuggestion[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.notePath}\0${left.expectedExternalFolder}\0${left.candidateExternalFolder}\0${left.uuid}`;
    const rightKey = `${right.notePath}\0${right.expectedExternalFolder}\0${right.candidateExternalFolder}\0${right.uuid}`;
    return leftKey.localeCompare(rightKey);
  });
}
