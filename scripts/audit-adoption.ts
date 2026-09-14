import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAuditReports,
  writeAuditReports
} from './adoption-audit-report.ts';
import { scanAdoptionAudit } from './adoption-audit-scan.ts';

async function main(): Promise<void> {
  const options = new Map([
    ['--external-root', 'C:\\Users\\ryanh\\ship\\hangar'],
    ['--output', fileURLToPath(new URL('../tmp', import.meta.url))],
    ['--vault', 'C:\\Users\\ryanh\\ship\\cabin']
  ]);
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npx --no-install jiti scripts/audit-adoption.ts [--vault PATH] [--external-root PATH] [--output DIRECTORY]');
    console.log('Writes a new timestamped report directory. Exit codes: 0 complete, 2 incomplete scan, 1 command failure.');
    return;
  }
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || !options.has(key) || !value || value.startsWith('--')) {
      throw new Error('Expected a supported option followed by a path. Use --help.');
    }
    options.set(key, value);
  }
  const vaultRoot = path.resolve(options.get('--vault') ?? '');
  const externalRoot = path.resolve(options.get('--external-root') ?? '');
  const output = path.resolve(options.get('--output') ?? '');
  console.log(`Scanning vault: ${vaultRoot}`);
  console.log(`Scanning external root: ${externalRoot}`);
  const scan = await scanAdoptionAudit(vaultRoot, externalRoot);
  const reports = buildAuditReports(scan);
  const directory = await writeAuditReports(reports, output);
  console.log(`Reports: ${directory}`);
  console.log(`Coverage: ${reports.complete ? 'complete' : 'incomplete; see unchecked and provisional findings'}`);
  // eslint-disable-next-line require-atomic-updates -- This standalone command is the only writer of the exit status during its scan.
  process.exitCode = reports.complete ? 0 : 2;
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch(() => {
  console.error('Audit failed. Check command arguments and access to the input/output directories. Use --help for usage.');
  process.exitCode = 1;
});
