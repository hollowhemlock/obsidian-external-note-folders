import {
  mkdir,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { resolveRepoPath } from '../fixtures/fixtureScenario.ts';

export async function writeSandboxReport(relativePath: string, content: string): Promise<void> {
  const reportPath = path.join(resolveRepoPath('test/fixtures/sandbox/reports'), relativePath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, 'utf8');
}
