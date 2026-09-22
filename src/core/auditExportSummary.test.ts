import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildAuditExportSummary } from './auditExportSummary.ts';
import { buildLeafReport } from './leafReport.ts';

describe('audit export summaries', () => {
  it('labels post-adoption exports as historical without changing scan times or counts', () => {
    const model = buildLeafReport(auditFixture(2));
    model.stale = true;
    const summary = buildAuditExportSummary(model, 'unmarked-leaf-folders.csv', model.rows.length);
    expect(summary).toContain('This snapshot predates mutations');
    expect(summary).toContain(model.finishedAt);
    expect(summary).toContain('2 rows');
  });
  it.each(['unmarked-leaf-folders.csv', 'filtered-unmarked-leaf-folders.csv', 'correctly-adopted.csv'])(
    'retains incomplete coverage and mutation warnings for %s',
    (filename) => {
      const model = buildLeafReport(auditFixture());
      model.uncheckedCount = 3;
      model.mutationWarning = true;
      const summary = buildAuditExportSummary(model, filename, 2);
      expect(summary).toContain('Coverage: **incomplete**. Unchecked items: 3.');
      expect(summary).toContain('Unscanned areas may contain additional results.');
      expect(summary).toContain('conclusions are provisional');
      expect(summary).toContain('locally unchecked leaf paths are excluded');
      expect(summary).toContain('**Results may not reflect in-progress mutations**');
      expect(summary).toContain(`[${filename}](${filename}): 2 rows`);
      expect(summary).toContain(model.vaultRoot);
      expect(summary).toContain(model.externalRoot);
      expect(summary).toContain(model.finishedAt);
    }
  );

  it('keeps mutation overlap independent of scan coverage', () => {
    const model = buildLeafReport(auditFixture());
    model.mutationWarning = true;
    const summary = buildAuditExportSummary(model, 'markdown-files.csv', 0);
    expect(summary).toContain('Coverage: **complete**. Unchecked items: 0.');
    expect(summary).toContain('Results may not reflect in-progress mutations');
    expect(summary).not.toContain('Unscanned areas');
  });

  it('omits warnings for a complete scan without mutation overlap', () => {
    const summary = buildAuditExportSummary(buildLeafReport(auditFixture()), 'unmarked-leaf-folders.csv', 0);
    expect(summary).toContain('Coverage: **complete**. Unchecked items: 0.');
    expect(summary).not.toContain('Results may not reflect');
    expect(summary).not.toContain('conclusions are provisional');
  });
});
