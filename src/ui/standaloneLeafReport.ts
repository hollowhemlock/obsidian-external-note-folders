import type {
  LeafReportModel,
  LeafRow
} from '../core/leafQuery.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import { serializeAuditCsvSteps } from '../core/auditCsv.ts';
import { folderStatusTable } from '../core/folderStatusCsv.ts';
import { mountLeafReport } from './leafReportView.ts';

const DOWNLOAD_URL_LIFETIME_MS = 1000;

export async function startStandaloneReport(model: LeafReportModel, container: HTMLElement): Promise<void> {
  const view = mountLeafReport(container, {
    async copy(text): Promise<void> {
      if (window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Offline file pages may lack the Clipboard API.
        const copied = document.execCommand('copy');
        area.remove();
        if (!copied) {
          throw new Error('Copy is unavailable. Select the displayed path to copy it.');
        }
      }
    },
    csvBaseUrl: './',
    async exportLeaves(rows: readonly LeafRow[], filtered: boolean): Promise<void> {
      view.status('Preparing CSV…', true);
      try {
        const csv = await runAuditSteps(
          serializeAuditCsvSteps({ columns: ['folderPath', 'relativePath'], rows: rows.map(({ folderPath, relativePath }) => ({ folderPath, relativePath })) })
        );
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filtered ? 'filtered-unmarked-leaf-folders.csv' : 'unmarked-leaf-folders.csv';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, DOWNLOAD_URL_LIFETIME_MS);
      } finally {
        view.status('CSV ready.', false);
      }
    },
    async exportStatus(nodes, filtered): Promise<void> {
      const csv = await runAuditSteps(serializeAuditCsvSteps(folderStatusTable(nodes)));
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filtered ? 'filtered-folder-status.csv' : 'folder-status.csv';
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, DOWNLOAD_URL_LIFETIME_MS);
    }
  });
  await view.update(model);
}
