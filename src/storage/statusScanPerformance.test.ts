import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  expect,
  it,
  vi
} from 'vitest';

import { scanAdoptionAudit } from './auditScan.ts';

const metrics = vi.hoisted(() => ({ active: 0, maximum: 0, processes: 0 }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>): ReturnType<typeof actual.spawn> => {
      const child = actual.spawn(...args);
      metrics.processes++;
      metrics.active++;
      metrics.maximum = Math.max(metrics.maximum, metrics.active);
      child.once('close', () => {
        metrics.active--;
      });
      return child;
    }
  };
});
const run = promisify(execFile);

it('prunes broad generated trees and bounds Git processes across sibling repositories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exnf-status-performance-'));
  const external = path.join(root, 'external');
  const vault = path.join(root, 'vault');
  const measurements: Record<string, number>[] = [];
  try {
    await mkdir(external);
    await mkdir(vault);
    for (let repository = 0; repository < 6; repository++) {
      const location = path.join(external, `repo-${String(repository)}`);
      await mkdir(location);
      await run('git', ['init', location]);
      await writeFile(path.join(location, '.gitignore'), 'generated/\n');
      for (let batch = 0; batch < 5; batch++) {
        await Promise.all(Array.from({ length: 40 }, async (_, index) => {
          await mkdir(path.join(location, 'generated', `branch-${String(batch * 40 + index)}`, 'leaf'), { recursive: true });
        }));
      }
      await mkdir(path.join(location, 'visible'));
    }
    for (let iteration = 0; iteration < 2; iteration++) {
      const started = performance.now();
      const filtered = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
      const filteredMs = performance.now() - started;
      const fullStarted = performance.now();
      const full = await scanAdoptionAudit(vault, external, { statusScanMode: 'unfiltered' });
      measurements.push({ filteredMs, fullMs: performance.now() - fullStarted });
      expect(filtered.folders.some((folder) => folder.endsWith('leaf'))).toBe(false);
      expect(full.folders.filter((folder) => folder.endsWith('leaf'))).toHaveLength(1200);
      expect(metrics.processes).toBe(6 * (iteration + 1));
      expect(metrics.maximum).toBe(1);
      expect(metrics.active).toBe(0);
    }
    console.debug('[external-note-folders] Status scan fixture timings (milliseconds)', measurements);
  } finally {
    await cleanup(root);
  }
}, 30_000);

async function cleanup(root: string): Promise<void> {
  if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('exnf-status-performance-')) {
    throw new Error('Unexpected cleanup path');
  }
  await rm(root, { force: true, recursive: true });
}
