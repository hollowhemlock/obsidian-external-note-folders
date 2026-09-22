import path from 'node:path';

import type { AuditSnapshot } from '../../src/core/auditTypes.ts';

export function auditFixture(count = 0): AuditSnapshot {
  const externalRoot = path.resolve('audit-external');

  const vaultRoot = path.resolve('audit-vault');

  const folders = Array.from({ length: count }, (_, index) => path.join(externalRoot, `folder-${String(index)}`));

  return {
    external: {
      accessErrors: [],
      bindings: new Map(),
      directories: folders,
      duplicatePaths: new Map(),
      ignoredDirectories: [],
      ignoreErrors: [],
      ignorePatterns: [],
      legacyMarkers: [],
      malformedMarkers: [],
      markers: [],
      rootPath: externalRoot,
      skippedDirectories: []
    },
    externalRoot,
    finishedAt: '2026-09-14T22:00:01Z',
    folders,
    issues: [],
    markers: [],
    notes: [],
    startedAt: '2026-09-14T22:00:00Z',
    vault: { bindings: new Map(), duplicatePaths: new Map(), invalidFrontmatter: [] },
    vaultRoot
  };
}
