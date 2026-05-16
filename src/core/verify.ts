import type {
  ExternalRootIgnoreError,
  IgnoredDirectory
} from './externalRootIgnore.ts';

import { toExternalRelativeDisplayPath } from './displayPath.ts';
import {
  buildExternalRootIgnoreMatcher,
  formatIgnoredDirectoryWarnings
} from './externalRootIgnore.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

export interface ExternalScanResult {
  accessErrors: ScanIssue[];
  bindings: Map<string, string>;
  directories: string[];
  duplicatePaths: Map<string, string[]>;
  ignoredDirectories: IgnoredDirectory[];
  ignoreErrors: ExternalRootIgnoreError[];
  ignorePatterns: string[];
  malformedMarkers: ScanIssue[];
  rootPath: string;
  skippedDirectories: ScanIssue[];
}

export interface ScanIssue {
  location: string;
  message: string;
}

export interface VaultScanResult {
  bindings: Map<string, string>;
  duplicatePaths: Map<string, string[]>;
  invalidFrontmatter: ScanIssue[];
}

export interface VerifyIgnoredRow {
  actualExternalFolder: null | string;
  expectedExternalFolder: string;
  notePath: string;
  uuid: string;
}

export interface VerifyReport {
  classificationOmitted: boolean;
  errors: string[];
  hasIntegrityErrors: boolean;
  ignoredRows: VerifyIgnoredRow[];
  markdownReport: string;
  ok: string[];
  okRows: VerifyTableRow[];
  summaryText: string;
  unavailable: string[];
  unavailableRows: VerifyTableRow[];
  warningRows: VerifyTableRow[];
  warnings: string[];
}

export interface VerifyTableRow {
  externalFolder: null | string;
  notePath: null | string;
  uuid: string;
}

export function buildVerifyReport(
  vaultScan: VaultScanResult,
  externalScan: ExternalScanResult
): VerifyReport {
  const errors = [
    ...formatDuplicateErrors('Vault', vaultScan.duplicatePaths),
    ...formatDuplicateErrors('External root', externalScan.duplicatePaths),
    ...formatDerivedPathCollisionErrors(vaultScan.bindings, externalScan),
    ...vaultScan.invalidFrontmatter
      .map((issue) => `Invalid frontmatter at ${issue.location}: ${issue.message}`),
    ...externalScan.malformedMarkers
      .map((issue) => `Malformed marker at ${issue.location}: ${issue.message}`),
    ...externalScan.accessErrors
      .map((issue) => `External root access error at ${issue.location}: ${issue.message}`),
    ...externalScan.ignoreErrors
      .map((issue) => `Invalid external root ignore pattern ${issue.pattern}: ${issue.message}`)
  ].sort();

  const classificationOmitted = externalScan.accessErrors.length > 0 || externalScan.ignoreErrors.length > 0;
  const ignoreMatcher = buildExternalRootIgnoreMatcher(externalScan.rootPath, externalScan.ignorePatterns);
  const ignoredRows: VerifyIgnoredRow[] = [];
  const ok: string[] = [];
  const okRows: VerifyTableRow[] = [];
  const unavailable: string[] = [];
  const unavailableRows: VerifyTableRow[] = [];
  const warnings = [
    ...formatIgnoredDirectoryWarnings(externalScan.ignoredDirectories),
    ...externalScan.skippedDirectories
      .map((issue) => `Skipped external directory at ${issue.location}: ${issue.message}`)
  ];
  const warningRows: VerifyTableRow[] = [];

  if (!classificationOmitted) {
    for (const [uuid, notePath] of sortEntries(vaultScan.bindings)) {
      const boundFolderPath = externalScan.bindings.get(uuid);
      const expectedFolderPath = deriveExternalFolderPath(notePath, externalScan.rootPath);
      if (ignoreMatcher.ignoresAbsoluteDirectoryPath(expectedFolderPath)) {
        ignoredRows.push({
          actualExternalFolder: boundFolderPath
            ? toExternalRelativeDisplayPath(externalScan.rootPath, boundFolderPath)
            : null,
          expectedExternalFolder: toExternalRelativeDisplayPath(externalScan.rootPath, expectedFolderPath),
          notePath,
          uuid
        });
        continue;
      }

      if (boundFolderPath) {
        ok.push(`${notePath} -> ${boundFolderPath}`);
        okRows.push({
          externalFolder: toExternalRelativeDisplayPath(externalScan.rootPath, boundFolderPath),
          notePath,
          uuid
        });
      } else {
        unavailable.push(`${notePath} (${uuid}) has no bound external folder.`);
        unavailableRows.push({
          externalFolder: null,
          notePath,
          uuid
        });
      }
    }

    for (const [uuid, boundFolderPath] of sortEntries(externalScan.bindings)) {
      if (!vaultScan.bindings.has(uuid)) {
        warningRows.push({
          externalFolder: toExternalRelativeDisplayPath(externalScan.rootPath, boundFolderPath),
          notePath: null,
          uuid
        });
      }
    }
  }

  const summaryText = [
    `${String(errors.length)} error(s)`,
    `${String(warnings.length + warningRows.length)} warning(s)`,
    `${String(ignoredRows.length)} ignored`,
    `${String(unavailable.length)} unavailable`,
    `${String(ok.length)} ok`
  ].join(', ');
  const sortedIgnoredRows = sortIgnoredRows(ignoredRows);

  return {
    classificationOmitted,
    errors,
    hasIntegrityErrors: errors.length > 0,
    ignoredRows: sortedIgnoredRows,
    markdownReport: buildMarkdownReport({
      errors,
      ignoredRows: sortedIgnoredRows,
      okRows: sortRows(okRows),
      summaryText,
      unavailableRows: sortRows(unavailableRows),
      warningRows: sortRows(warningRows),
      warnings: warnings.sort()
    }),
    ok: ok.sort(),
    okRows: sortRows(okRows),
    summaryText,
    unavailable: unavailable.sort(),
    unavailableRows: sortRows(unavailableRows),
    warningRows: sortRows(warningRows),
    warnings: warnings.sort()
  };
}

function buildMarkdownReport(input: {
  errors: string[];
  ignoredRows: VerifyIgnoredRow[];
  okRows: VerifyTableRow[];
  summaryText: string;
  unavailableRows: VerifyTableRow[];
  warningRows: VerifyTableRow[];
  warnings: string[];
}): string {
  return [
    '# External Folder Verify Report',
    '',
    input.summaryText,
    '',
    formatMarkdownList('Errors', input.errors),
    formatMarkdownList('Warnings', input.warnings),
    formatVerifyRows('Orphan Bound Folders', input.warningRows),
    formatIgnoredRows('Ignored / Unchecked', input.ignoredRows),
    formatVerifyRows('Unavailable', input.unavailableRows),
    formatVerifyRows('OK', input.okRows)
  ].join('\n');
}

function formatDerivedPathCollisionErrors(
  vaultBindings: Map<string, string>,
  externalScan: ExternalScanResult
): string[] {
  if (externalScan.accessErrors.length > 0) {
    return [];
  }

  const pathsByIdentity = new Map<string, { externalFolder: string; notePaths: string[] }>();
  for (const notePath of vaultBindings.values()) {
    const externalFolderPath = deriveExternalFolderPath(notePath, externalScan.rootPath);
    const identity = normalizePathForIdentity(externalFolderPath);
    const current = pathsByIdentity.get(identity);
    if (current) {
      current.notePaths.push(notePath);
      continue;
    }

    pathsByIdentity.set(identity, {
      externalFolder: toExternalRelativeDisplayPath(externalScan.rootPath, externalFolderPath),
      notePaths: [notePath]
    });
  }

  return [...pathsByIdentity.values()]
    .filter((entry) => entry.notePaths.length > 1)
    .map((entry) => {
      const sortedNotePaths = entry.notePaths.sort().join(', ');
      return `Derived external folder path ${entry.externalFolder} is shared by multiple notes: ${sortedNotePaths}`;
    })
    .sort();
}

function formatDuplicateErrors(scopeLabel: string, duplicatePaths: Map<string, string[]>): string[] {
  return sortEntries(duplicatePaths).map(([uuid, paths]) => {
    const sortedPaths = [...paths].sort().join(', ');
    return `${scopeLabel} UUID ${uuid} is duplicated at: ${sortedPaths}`;
  });
}

function formatIgnoredRows(title: string, rows: VerifyIgnoredRow[]): string {
  if (rows.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    '| Vault file | Expected external folder | Actual external folder | UUID |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.notePath} | ${row.expectedExternalFolder} | ${row.actualExternalFolder ?? '-'} | ${row.uuid} |`)
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

function formatVerifyRows(title: string, rows: VerifyTableRow[]): string {
  if (rows.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    '| Vault file | External folder | UUID |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.notePath ?? '-'} | ${row.externalFolder ?? '-'} | ${row.uuid} |`)
  ].join('\n');
}

function sortEntries<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function sortIgnoredRows(rows: VerifyIgnoredRow[]): VerifyIgnoredRow[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.notePath}\0${left.expectedExternalFolder}\0${left.actualExternalFolder ?? ''}\0${left.uuid}`;
    const rightKey = `${right.notePath}\0${right.expectedExternalFolder}\0${right.actualExternalFolder ?? ''}\0${right.uuid}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sortRows(rows: VerifyTableRow[]): VerifyTableRow[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.notePath ?? ''}\0${left.externalFolder ?? ''}\0${left.uuid}`;
    const rightKey = `${right.notePath ?? ''}\0${right.externalFolder ?? ''}\0${right.uuid}`;
    return leftKey.localeCompare(rightKey);
  });
}
