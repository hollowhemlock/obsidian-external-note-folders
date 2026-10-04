import type { AuditIssue } from './auditTypes.ts';
import type { CoverageIssue } from './folderInspection.ts';
import type { LeafReportModel } from './leafQuery.ts';

export type ScanIssueCategory = 'exclusions' | 'links' | 'markers' | 'problems';

export function coverageNotice(model: LeafReportModel): string {
  if (model.uncheckedCount === 0) {
    return '';
  }
  const issues = model.coverage?.issues ?? [];
  return [
    'Results describe scanned locations.',
    model.statusScanMode === 'filtered' && issues.some((issue) => scanIssueCategory(issue) === 'exclusions')
      ? 'Ignored folders are skipped to improve performance and reduce noise.'
      : '',
    issues.some((issue) => scanIssueCategory(issue) === 'links') ? 'Links are not followed.' : '',
    scanProblemSummary(issues) ? 'Some locations or identities could not be checked.' : '',
    'Additional .exnf markers or note identities may exist in unchecked locations.',
    'Healthy means the checked note and folder match with no detected conflict.'
  ].filter(Boolean).join(' ');
}

/** Repository failures take precedence over their Git exclusion provenance. */
export function scanIssueCategory(issue: AuditIssue | CoverageIssue): ScanIssueCategory {
  if (issue.code === 'git-repository-unavailable') {
    return 'problems';
  }
  if (issue.exclusionSource || issue.kind === 'excluded') {
    return 'exclusions';
  }
  if (issue.kind === 'link') {
    return 'links';
  }
  return issue.kind === 'marker' ? 'markers' : 'problems';
}

export function scanProblemSummary(issues: readonly (AuditIssue | CoverageIssue)[]): string {
  const counts = { directory: 0, marker: 0, note: 0, repository: 0 };
  for (const issue of issues) {
    if (issue.code === 'git-repository-unavailable') {
      counts.repository++;
    } else if (issue.unchecked && ['markers', 'problems'].includes(scanIssueCategory(issue))) {
      const kind = issue.kind === 'marker' || issue.kind === 'note' ? issue.kind : 'directory';
      counts[kind]++;
    }
  }
  return [
    counts.directory ? `${String(counts.directory)} unreadable ${counts.directory === 1 ? 'directory' : 'directories'}` : '',
    counts.note ? `${String(counts.note)} unchecked note ${counts.note === 1 ? 'identity' : 'identities'}` : '',
    counts.marker ? `${String(counts.marker)} unchecked marker ${counts.marker === 1 ? 'identity' : 'identities'}` : '',
    counts.repository ? `${String(counts.repository)} skipped ${counts.repository === 1 ? 'repository' : 'repositories'}` : ''
  ].filter(Boolean).join(' · ');
}
