import { toExternalRelativeDisplayPath } from './displayPath.ts';

export interface ExternalScanResult {
  accessErrors: ScanIssue[];
  bindings: Map<string, string>;
  directories: string[];
  duplicatePaths: Map<string, string[]>;
  malformedMarkers: ScanIssue[];
  rootPath: string;
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

export interface VerifyReport {
  classificationOmitted: boolean;
  errors: string[];
  hasIntegrityErrors: boolean;
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
    ...vaultScan.invalidFrontmatter
      .map((issue) => `Invalid frontmatter at ${issue.location}: ${issue.message}`),
    ...externalScan.malformedMarkers
      .map((issue) => `Malformed marker at ${issue.location}: ${issue.message}`),
    ...externalScan.accessErrors
      .map((issue) => `External root access error at ${issue.location}: ${issue.message}`)
  ].sort();

  const classificationOmitted = externalScan.accessErrors.length > 0;
  const ok: string[] = [];
  const okRows: VerifyTableRow[] = [];
  const unavailable: string[] = [];
  const unavailableRows: VerifyTableRow[] = [];
  const warnings: string[] = [];
  const warningRows: VerifyTableRow[] = [];

  if (!classificationOmitted) {
    for (const [uuid, notePath] of sortEntries(vaultScan.bindings)) {
      const boundFolderPath = externalScan.bindings.get(uuid);
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
        warnings.push(`${boundFolderPath} (${uuid}) is orphaned.`);
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
    `${String(warnings.length)} warning(s)`,
    `${String(unavailable.length)} unavailable`,
    `${String(ok.length)} ok`
  ].join(', ');

  return {
    classificationOmitted,
    errors,
    hasIntegrityErrors: errors.length > 0,
    ok: ok.sort(),
    okRows: sortRows(okRows),
    summaryText,
    unavailable: unavailable.sort(),
    unavailableRows: sortRows(unavailableRows),
    warningRows: sortRows(warningRows),
    warnings: warnings.sort()
  };
}

function formatDuplicateErrors(scopeLabel: string, duplicatePaths: Map<string, string[]>): string[] {
  return sortEntries(duplicatePaths).map(([uuid, paths]) => {
    const sortedPaths = [...paths].sort().join(', ');
    return `${scopeLabel} UUID ${uuid} is duplicated at: ${sortedPaths}`;
  });
}

function sortEntries<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function sortRows(rows: VerifyTableRow[]): VerifyTableRow[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.notePath ?? ''}\0${left.externalFolder ?? ''}\0${left.uuid}`;
    const rightKey = `${right.notePath ?? ''}\0${right.externalFolder ?? ''}\0${right.uuid}`;
    return leftKey.localeCompare(rightKey);
  });
}
