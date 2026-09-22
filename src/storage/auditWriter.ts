import {
  mkdir,
  mkdtemp,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import type { AuditReports } from '../core/auditReport.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import { serializeAuditCsvSteps } from '../core/auditCsv.ts';

export async function writeAuditReports(reports: AuditReports, outputParent: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  await mkdir(outputParent, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const outputDirectory = await mkdtemp(path.join(outputParent, `adoption-audit-${timestamp}-`));
  for (const [name, table] of Object.entries(reports.tables)) {
    const csv = await runAuditSteps(serializeAuditCsvSteps(table), signal ? { signal } : {});
    signal?.throwIfAborted();
    await writeFile(path.join(outputDirectory, name), csv, { encoding: 'utf8', flag: 'wx' });
  }
  signal?.throwIfAborted();
  await writeFile(path.join(outputDirectory, 'summary.md'), reports.summary, { encoding: 'utf8', flag: 'wx' });
  return outputDirectory;
}
