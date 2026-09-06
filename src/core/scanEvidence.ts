import type { ExternalScanResult } from './verify.ts';

import { toExternalRelativeDisplayPath } from './displayPath.ts';

const REPORT_SAMPLE_LIMIT = 5;

export function buildExternalScanGlobalErrors(externalScan: ExternalScanResult): string[] {
  return [
    ...externalScan.accessErrors
      .map((issue) => `External root access error at ${issue.location}: ${issue.message}`),
    ...externalScan.ignoreErrors
      .map((issue) => `Invalid external root ignore pattern ${issue.pattern}: ${issue.message}`)
  ];
}

export function formatSkippedDirectoryWarnings(externalScan: ExternalScanResult): string[] {
  const groups = new Map<string, string[]>();
  for (const issue of externalScan.skippedDirectories) {
    const errorLabel = issue.code ?? sanitizeScanIssueMessage(issue.message, issue.location, externalScan.rootPath);
    const relativePath = toExternalRelativeDisplayPath(externalScan.rootPath, issue.location);
    const paths = groups.get(errorLabel) ?? [];
    paths.push(relativePath);
    groups.set(errorLabel, paths);
  }

  return sortEntries(groups).map(([errorLabel, paths]) => {
    const sortedPaths = [...paths].sort();
    const samples = sortedPaths.slice(0, REPORT_SAMPLE_LIMIT);
    const omittedCount = sortedPaths.length - samples.length;
    const suffix = omittedCount > 0 ? `; ${String(omittedCount)} more omitted` : '';
    return `Skipped ${String(sortedPaths.length)} external director${sortedPaths.length === 1 ? 'y' : 'ies'} (${errorLabel}): ${samples.join(', ')}${suffix}`;
  });
}

function sanitizeScanIssueMessage(message: string, location: string, externalRootPath: string): string {
  return message
    .replaceAll(location, '<path>')
    .replaceAll(location.replaceAll('\\', '/'), '<path>')
    .replaceAll(externalRootPath, '<external-root>')
    .replaceAll(externalRootPath.replaceAll('\\', '/'), '<external-root>');
}

function sortEntries<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}
