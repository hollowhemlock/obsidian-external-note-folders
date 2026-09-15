import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { runAuditSteps } from '../src/auditScheduler.ts';
import { serializeAuditCsvSteps } from '../src/core/auditCsv.ts';
import { buildAuditReportSteps } from '../src/core/auditReport.ts';
import {
  DEFAULT_LEAF_QUERY,
  queryLeafSteps
} from '../src/core/leafQuery.ts';
import { buildLeafReportSteps } from '../src/core/leafReport.ts';
import { scanAdoptionAudit } from '../src/storage/auditScan.ts';
import { writeAuditReports } from '../src/storage/auditWriter.ts';

const LEAF_COUNT = 20_000;
const MAX_SLICE_MS = 100;
const NS_PER_MS = 1_000_000;
const results: Record<string, { maxSliceMs?: number; totalMs: number }> = {};

async function measure<T>(name: string, steps: Generator<void, T>): Promise<T> {
  let maxSliceMs = 0;

  const started = performance.now();

  const result = await runAuditSteps(steps, {
    onSlice: (ms) => {
      maxSliceMs = Math.max(maxSliceMs, ms);
    }
  });

  results[name] = { maxSliceMs, totalMs: performance.now() - started };

  if (maxSliceMs > MAX_SLICE_MS) {
    throw new Error(`${name} exceeded ${String(MAX_SLICE_MS)} ms: ${String(maxSliceMs)}`);
  }

  return result;
}

const root = await mkdtemp(path.join(tmpdir(), 'exnf-audit-performance-'));
try {
  const vault = path.join(root, 'vault');

  const external = path.join(root, 'external');

  await mkdir(vault);

  await mkdir(external);

  for (let index = 0; index < LEAF_COUNT; index++) {
    const name = `leaf-${String(index)}`;

    await mkdir(path.join(external, name));

    await writeFile(path.join(vault, `${name}.md`), '# Performance fixture\n');
  }

  const delay = monitorEventLoopDelay();

  delay.enable();

  const started = performance.now();

  const snapshot = await scanAdoptionAudit(vault, external);

  delay.disable();

  results['scan'] = { maxSliceMs: delay.max / NS_PER_MS, totalMs: performance.now() - started };

  const model = await measure('leafAnalysis', buildLeafReportSteps(snapshot));

  await measure('query', queryLeafSteps(model, DEFAULT_LEAF_QUERY));

  const audit = await measure('fullAudit', buildAuditReportSteps(snapshot));

  const table = audit.tables['possibly-missing.csv'];

  if (!table) {
    throw new Error('Missing audit table');
  }

  await measure('csv', serializeAuditCsvSteps(table));

  const exportStarted = performance.now();

  await writeAuditReports(audit, path.join(root, 'exports'));

  results['export'] = { totalMs: performance.now() - exportStarted };

  if (model.rows.length !== LEAF_COUNT) {
    throw new Error('Unexpected leaf count');
  }

  await mkdir('tmp', { recursive: true });

  await writeFile('tmp/audit-performance.json', JSON.stringify({ leaves: LEAF_COUNT, measuredAt: new Date().toISOString(), results }, null, 2));

  // The same model can be passed to the shared view by the sandbox integration test.
  await writeFile('tmp/audit-performance-model.json', JSON.stringify(model));

  console.log(JSON.stringify(results, null, 2));
} finally {
  await cleanup(root);
}

async function cleanup(fixtureRoot: string): Promise<void> {
  if (path.dirname(fixtureRoot) !== tmpdir() || !path.basename(fixtureRoot).startsWith('exnf-audit-performance-')) {
    throw new Error('Unexpected performance fixture cleanup path');
  }
  await rm(fixtureRoot, { force: true, recursive: true });
}
