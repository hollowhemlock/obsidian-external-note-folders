import path from 'node:path';

import type { AdoptionInspectionPolicy } from '../core/adoptionPolicy.ts';
import type { AuditSnapshot } from '../core/auditTypes.ts';
import type { AdoptionNoteCache } from './adoptionNoteCache.ts';
import type { NoteResult } from './auditScan.ts';

import { isIntentionalExclusion } from '../core/adoptionPolicy.ts';
import { pathsOverlap } from '../core/groupAdoption.ts';
import { assertPathIsWithinRoot } from '../core/pathPolicy.ts';
import { scanAdoptionAudit } from './auditScan.ts';
import { resolveExternalRootPath } from './boundExternalFolder.ts';

export async function inspectAdoption(input: {
  externalRoot: string;
  ignorePatterns: readonly string[];
  knownMarkerPaths: readonly string[];
  noteCache?: AdoptionNoteCache<NoteResult>;
  signal?: AbortSignal;
  targets: readonly string[];
  templatePatterns: readonly string[];
  vaultRoot: string;
}): Promise<{ inspectionPolicy: AdoptionInspectionPolicy; snapshot: AuditSnapshot }> {
  const root = await resolveExternalRootPath(input.externalRoot);
  input.targets.forEach((target) => {
    assertPathIsWithinRoot(root, target);
  });
  const knownMarkerPaths = [...new Set(input.knownMarkerPaths.filter((marker) => input.targets.some((target) => pathsOverlap(path.dirname(marker), target))))]
    .sort();
  const snapshot = await scanAdoptionAudit(input.vaultRoot, root, {
    ...(input.noteCache ? { noteCache: input.noteCache } : {}),
    adoptionTargets: input.targets.filter((target, index, all) =>
      !all.some((other, otherIndex) => otherIndex !== index && (target === other ? otherIndex < index : target.startsWith(other + path.sep)))
    ),
    ignorePatterns: input.ignorePatterns,
    knownMarkerPaths,
    ...(input.signal ? { signal: input.signal } : {}),
    statusScanMode: 'filtered',
    templateExcludePatterns: input.templatePatterns
  });
  const omissions = snapshot.issues.filter(isIntentionalExclusion)
    .map(({ location, reason }) => ({ location, reason })).sort((a, b) => a.location.localeCompare(b.location));
  return {
    inspectionPolicy: {
      externalRoot: root,
      ignorePatterns: [...input.ignorePatterns],
      kind: 'filtered-adoption-v1',
      knownMarkerPaths,
      omissions,
      templatePatterns: [...input.templatePatterns],
      vaultRoot: snapshot.vaultRoot
    },
    snapshot
  };
}
