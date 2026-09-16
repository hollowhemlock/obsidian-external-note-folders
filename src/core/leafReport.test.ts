import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { runAuditSteps } from '../auditScheduler.ts';
import {
  serializeAuditCsv,
  serializeAuditCsvSteps
} from './auditCsv.ts';
import {
  buildAuditReports,
  buildAuditReportSteps,
  buildAuditTableSteps
} from './auditReport.ts';
import {
  classifyLeafSegments,
  DEFAULT_LEAF_QUERY,
  GROUP_PAGE_SIZE,
  LEAF_PAGE_SIZE,
  queryLeafSteps,
  queryLeaves
} from './leafQuery.ts';
import {
  buildLeafReport,
  buildLeafReportSteps
} from './leafReport.ts';

describe('shared leaf report', () => {
  it('produces identical tables for on-demand and full exports', async () => {
    const scan = auditFixture(3);
    const reports = buildAuditReports(scan);
    for (const [name, table] of Object.entries(reports.tables)) {
      expect(await runAuditSteps(buildAuditTableSteps(scan, name))).toEqual(table);
    }
    await expect(runAuditSteps(buildAuditTableSteps(scan, 'unknown.csv'))).rejects.toThrow('Unknown audit table');
  });
  it('classifies exact components case-insensitively with overlapping labels', () => {
    expect(classifyLeafSegments(['.GIT', 'Node_Modules', 'DIST'])).toEqual(['git', 'dependencies', 'generated']);

    expect(classifyLeafSegments(['github', 'node_modules-backup', 'builder', 'distribution'])).toEqual([]);

    for (const component of ['build', 'dist', '.cache', '__pycache__', '.venv']) {
      expect(classifyLeafSegments([component])).toEqual(['generated']);
    }
  });

  it('associates folder notes and collisions exactly, preserving identity status', async () => {
    const scan = auditFixture();

    scan.folders.push(path.join(scan.externalRoot, 'Project'), path.join(scan.externalRoot, 'Other'));

    scan.notes = ['Project.md', 'Project/Project.md', 'Otherish.md'].map((relativePath) => ({
      hasExnf: false,
      notePath: path.join(scan.vaultRoot, relativePath),
      relativePath,
      status: 'missing-property',
      uuid: '',
      value: ''
    }));

    const model = buildLeafReport(scan);

    expect(model.rows[0]?.notes.map((note) => note.notePath)).toEqual(['Project.md', 'Project/Project.md']);

    expect(model.rows[1]?.notes).toEqual([]);

    expect(queryLeaves(model, { ...DEFAULT_LEAF_QUERY, search: 'PROJECT/PROJECT' }).rows).toHaveLength(1);

    expect(await runAuditSteps(buildLeafReportSteps(scan))).toEqual(model);

    expect(await runAuditSteps(buildAuditReportSteps(scan))).toEqual(buildAuditReports(scan));
  });

  it('deduplicates overlapping categories and groups by parent segments', async () => {
    const scan = auditFixture();

    scan.folders = ['direct', 'a/b/one', 'a/b/two', 'a/c/three', '.git/node_modules/dist/leaf'].map((p) => path.join(scan.externalRoot, p));

    const model = buildLeafReport(scan);

    const result = queryLeaves(model, DEFAULT_LEAF_QUERY);

    expect(result.total).toBe(5);

    expect(result.hiddenCount).toBe(1);

    expect(result.rows).toHaveLength(4);

    expect(result.groups.map((group) => group.key)).toEqual(['a/b', 'a/c', 'direct']);

    const all = { ...DEFAULT_LEAF_QUERY, depth: 1, showGenerated: true };

    expect(queryLeaves(model, all).groups[0]?.key).toBe('a');

    expect(queryLeaves(model, { ...all, category: 'dependencies' }).rows).toHaveLength(1);

    expect(queryLeaves(model, { ...all, category: 'ordinary' }).rows).toHaveLength(4);

    expect(await runAuditSteps(queryLeafSteps(model, all))).toEqual(queryLeaves(model, all));

    expect(GROUP_PAGE_SIZE).toBe(50);

    expect(LEAF_PAGE_SIZE).toBe(100);
  });

  it('keeps CSV escaping, byte order and incremental output equivalent', async () => {
    const table = { columns: ['path', 'value'], rows: [{ path: 'z,"x"\nline', value: '</script>' }, { path: 'a', value: 'é' }] };

    const expected = '\uFEFF"path","value"\r\n"a","é"\r\n"z,""x""\nline","</script>"\r\n';

    expect(serializeAuditCsv(table)).toBe(expected);

    expect(await runAuditSteps(serializeAuditCsvSteps(table))).toBe(expected);
  });

  it('yields and cancels scheduled analysis', async () => {
    const controller = new AbortController();

    await expect(runAuditSteps(buildLeafReportSteps(auditFixture(20_000)), {
      onSlice: () => {
        controller.abort();
      },
      signal: controller.signal
    })).rejects.toThrow();
  });
});
