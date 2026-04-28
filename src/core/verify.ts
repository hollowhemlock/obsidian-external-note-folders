export interface ExternalScanResult {
  accessErrors: ScanIssue[];
  bindings: Map<string, string>;
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
  summaryText: string;
  unavailable: string[];
  warnings: string[];
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
  const unavailable: string[] = [];
  const warnings: string[] = [];

  if (!classificationOmitted) {
    for (const [uuid, notePath] of sortEntries(vaultScan.bindings)) {
      const boundFolderPath = externalScan.bindings.get(uuid);
      if (boundFolderPath) {
        ok.push(`${notePath} -> ${boundFolderPath}`);
      } else {
        unavailable.push(`${notePath} (${uuid}) has no bound external folder.`);
      }
    }

    for (const [uuid, boundFolderPath] of sortEntries(externalScan.bindings)) {
      if (!vaultScan.bindings.has(uuid)) {
        warnings.push(`${boundFolderPath} (${uuid}) is orphaned.`);
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
    summaryText,
    unavailable: unavailable.sort(),
    warnings: warnings.sort()
  };
}

export function summarizeVerifyReport(report: VerifyReport): string {
  return `Verify complete: ${report.summaryText}.`;
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
