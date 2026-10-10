import type { CoverageIssue } from '../core/folderInspection.ts';
import type { ScanIssueCategory } from '../core/scanCoveragePresentation.ts';

import { scanIssueCategory } from '../core/scanCoveragePresentation.ts';
import { paged } from './folderDetails.ts';
import {
  reportDisclosure,
  reportElement
} from './reportDom.ts';

export function renderScanDetails(parent: HTMLElement, issues: readonly CoverageIssue[]): void {
  const groups: Record<ScanIssueCategory, CoverageIssue[]> = { exclusions: [], links: [], markers: [], problems: [] };
  const labels: Record<ScanIssueCategory, string> = {
    exclusions: 'Intentional exclusions',
    links: 'Links not followed',
    markers: 'Marker findings',
    problems: 'Read and repository failures'
  };
  for (const issue of issues) {
    groups[scanIssueCategory(issue)].push(issue);
  }
  parent.replaceChildren();
  for (const category of ['problems', 'markers', 'exclusions', 'links'] as const) {
    const items = groups[category];
    if (!items.length) {
      continue;
    }
    const group = reportDisclosure(parent, `${labels[category]} (${items.length.toLocaleString()})`);
    group.dataset['scanCategory'] = category;
    paged(group, items, (issue) => {
      reportElement(group, 'p', `${issue.scope} · ${issue.kind}\n${issue.location}\n${issue.reason}`, 'leaf-context');
    });
  }
}
