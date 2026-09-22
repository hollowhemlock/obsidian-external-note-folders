// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation follows ADR-0016; browser queries do not import this module.
import path from 'node:path';

import type { CsvRow } from './auditCsv.ts';
import type { AuditScan } from './auditTypes.ts';

import { finishAuditSteps } from './auditSteps.ts';
import { normalizePathForIdentity } from './pathPolicy.ts';

export function buildUnmarkedLeafFolderRows(scan: AuditScan): CsvRow[] {
  return finishAuditSteps(unmarkedLeafSteps(scan)).map((folderPath) => ({ folderPath, relativePath: path.relative(scan.externalRoot, folderPath) }));
}

export function* unmarkedLeafSteps(scan: AuditScan): Generator<void, string[]> {
  const root = normalizePathForIdentity(scan.externalRoot);
  const nonLeaves = new Set<string>();
  const blocked = new Set<string>();
  for (const folder of scan.folders) {
    nonLeaves.add(normalizePathForIdentity(path.dirname(folder)));
    yield;
  }
  for (const marker of scan.markers) {
    blocked.add(normalizePathForIdentity(marker.folderPath));
    yield;
  }
  for (const issue of [...scan.external.accessErrors, ...scan.external.skippedDirectories]) {
    blocked.add(normalizePathForIdentity(issue.location));
    nonLeaves.add(normalizePathForIdentity(path.dirname(issue.location)));
    if (issue.location.toLowerCase().endsWith('.exnf')) {
      blocked.add(normalizePathForIdentity(path.dirname(issue.location)));
    }
    yield;
  }
  const leaves: string[] = [];
  for (const folder of scan.folders) {
    yield;
    let current = normalizePathForIdentity(folder);
    if (nonLeaves.has(current)) {
      continue;
    }
    while (current !== root && !blocked.has(current)) {
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    if (current === root && !blocked.has(root)) {
      leaves.push(folder);
    }
  }
  return leaves;
}
