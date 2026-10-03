import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildLeafReport } from '../core/leafReport.ts';
import {
  DEFAULT_TREE_QUERY,
  queryTree
} from '../core/leafTree.ts';
import { revealTreePath } from '../core/leafTreeNavigation.ts';
import {
  filterMetricEntries,
  scanMetricEntries
} from './reportMetrics.ts';

describe('scan and filter metrics', () => {
  it('keeps snapshot totals fixed while counting matches rather than context ancestors', () => {
    const snapshot = auditFixture();
    snapshot.folders = ['Parent/A', 'Parent/B'].map((folder) => path.join(snapshot.externalRoot, folder));
    const model = buildLeafReport(snapshot);
    expect(model.scanMetrics).toMatchObject({ physicalFolders: 3, physicalLeaves: 2, skippedRepositories: 0 });
    const before = scanMetricEntries(model);
    const query = queryTree(model, { ...DEFAULT_TREE_QUERY, search: 'Parent/A' });
    expect(query.visible.size).toBe(2);
    expect(filterMetricEntries(query).map((metric) => metric.value)).toEqual([1, 1, 0]);
    const other = model.tree!.find((node) => node.relativePath.endsWith('B'))!;
    expect(filterMetricEntries(revealTreePath(query, other.id))).toEqual(filterMetricEntries(query));
    queryTree(model, { ...DEFAULT_TREE_QUERY, sort: 'count' });
    expect(scanMetricEntries(model)).toEqual(before);
  });

  it('counts expected paths separately and distinguishes an empty result from unavailable metrics', () => {
    const snapshot = auditFixture(2);
    const uuid = '11111111-1111-4111-8111-111111111111';
    snapshot.notes.push({
      hasExnf: true,
      notePath: path.join(snapshot.vaultRoot, 'Missing.md'),
      relativePath: 'Missing.md',
      status: 'valid',
      uuid,
      value: uuid
    });
    const model = buildLeafReport(snapshot);
    const expected = queryTree(model, { ...DEFAULT_TREE_QUERY, includeExpected: true, search: 'Missing' });
    expect(filterMetricEntries(expected).map((metric) => metric.value)).toEqual([0, 0, 1]);
    const empty = queryTree(model, { ...DEFAULT_TREE_QUERY, search: 'no-match' });
    expect(filterMetricEntries(empty).map((metric) => metric.value)).toEqual([0, 0, 0]);
    expect(filterMetricEntries().every((metric) => metric.value === undefined)).toBe(true);
    expect(scanMetricEntries().every((metric) => metric.value === undefined)).toBe(true);
  });

  it('keeps exclusions and repository failures in separate scan totals', () => {
    const snapshot = auditFixture();
    snapshot.statusScanMode = 'filtered';
    const excluded = path.join(snapshot.externalRoot, 'excluded');
    snapshot.external.ignoredDirectories.push({ folderPath: excluded, relativePath: 'excluded' });
    snapshot.issues.push(
      { exclusionSource: 'git', kind: 'directory', location: excluded, reason: 'Excluded', scope: 'external', unchecked: true },
      {
        code: 'git-repository-unavailable',
        kind: 'directory',
        location: path.join(snapshot.externalRoot, 'broken'),
        reason: 'Broken',
        scope: 'external',
        unchecked: true
      },
      { kind: 'directory', location: path.join(snapshot.externalRoot, 'unreadable'), reason: 'Unreadable', scope: 'external', unchecked: true },
      { kind: 'link', location: path.join(snapshot.externalRoot, 'link'), reason: 'Link', scope: 'external', unchecked: true }
    );
    expect(buildLeafReport(snapshot).scanMetrics).toMatchObject({ excludedBranches: 1, skippedLinks: 1, skippedRepositories: 1, unreadableDirectories: 1 });
  });

  it('uses available legacy evidence without inventing failure counts', () => {
    const model = buildLeafReport(auditFixture(2));
    delete model.scanMetrics;
    const metrics = scanMetricEntries(model);
    expect(metrics.find((metric) => metric.key === 'physicalFolders')?.value).toBe(2);
    expect(metrics.find((metric) => metric.key === 'skippedRepositories')?.value).toBeUndefined();
    delete model.tree;
    expect(scanMetricEntries(model).every((metric) => metric.value === undefined)).toBe(true);
  });
});
