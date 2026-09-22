import type { AuditSnapshot } from './auditTypes.ts';
import type {
  AdoptionNoteChoice,
  GroupAdoptionPlan
} from './groupAdoption.ts';

import { buildExternalRootIgnoreMatcher } from './externalRootIgnore.ts';
import {
  buildGroupAdoptionPlan,
  pathsOverlap
} from './groupAdoption.ts';
import { buildLeafReport } from './leafReport.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';
import { buildSelectedReconcilePlan } from './reconcilePlan.ts';

export function buildExternalRepair(
  scan: AuditSnapshot,
  folder: string,
  sequence: number,
  ignorePatterns: string[] = []
): ReturnType<typeof buildSelectedReconcilePlan> {
  const binding = repairBinding(scan, folder);
  const target = deriveExternalFolderPath(binding.note, scan.externalRoot);
  const matcher = buildExternalRootIgnoreMatcher(scan.externalRoot, ignorePatterns);
  if (matcher.errors.length || matcher.ignoresAbsoluteDirectoryPath(folder) || matcher.ignoresAbsoluteDirectoryPath(target)) {
    throw new Error('Mutation ignore settings exclude the source or destination, or are invalid.');
  }
  if (pathsOverlap(folder, target)) {
    throw new Error('Source and destination folders overlap.');
  }
  if (scan.markers.some((marker) => marker.folderPath !== folder && pathsOverlap(marker.folderPath, target))) {
    throw new Error('Destination overlaps another marker.');
  }
  for (const note of scan.notes) {
    if (note.relativePath === binding.note) {
      // The selected note owns the destination.
      continue;
    }
    let expected: string;
    try {
      expected = deriveExternalFolderPath(note.relativePath, scan.externalRoot);
    } catch {
      // Unsupported note paths cannot reserve a derived external destination.
      continue;
    }
    if (normalizePathForIdentity(expected) === normalizePathForIdentity(target) || (note.hasExnf && pathsOverlap(expected, target))) {
      throw new Error('Another note reserves the destination branch.');
    }
  }
  const plan = buildSelectedReconcilePlan(scan.external, binding.note, binding.uuid, sequence);
  const row = plan.rows.find((item) => item.uuid === binding.uuid);
  if (plan.hasGlobalErrors || row?.kind !== 'move') {
    throw new Error('Reconcile safety checks block this move. Inspect the drift report.');
  }
  return { ...plan, markdownReport: `Move ${row.sourcePath} to ${row.targetPath}`, rows: [row], summaryText: 'Move one external folder' };
}
export function buildNoteRepair(scan: AuditSnapshot, folder: string, note: AdoptionNoteChoice, sequence: number, ignorePatterns: string[]): GroupAdoptionPlan {
  const binding = repairBinding(scan, folder);
  if (binding.note !== note.path) {
    throw new Error('Binding changed.');
  }
  const local = scan.markers.filter((marker) => normalizePathForIdentity(marker.folderPath) === normalizePathForIdentity(folder));
  if (local[0]?.format !== 'uuid-named') {
    throw new Error('Migrate the legacy marker before moving its note.');
  }
  const plan = buildGroupAdoptionPlan({
    folderPath: folder,
    ignorePatterns,
    move: true,
    mutationSequence: sequence,
    note,
    snapshot: { ...scan, markers: scan.markers.filter((marker) => !local.includes(marker)) },
    uuid: binding.uuid
  });
  return { ...plan, repair: true };
}
export function repairBinding(scan: AuditSnapshot, folder: string): { note: string; uuid: string } {
  if (scan.issues.some((issue) => issue.unchecked)) {
    throw new Error('Full checked coverage is required before repairing a binding.');
  }
  const node = buildLeafReport(scan).tree?.find((entry) => normalizePathForIdentity(entry.folderPath) === normalizePathForIdentity(folder));
  const evidence = node?.evidence;
  if (!evidence?.bindingNote || !evidence.uuid || evidence.status !== 'Bound at different path') {
    throw new Error('A unique drifted binding is required.');
  }
  if (scan.markers.some((marker) => marker.folderPath !== folder && pathsOverlap(marker.folderPath, folder))) {
    throw new Error('Overlapping marked folders prevent repair.');
  }
  return { note: evidence.bindingNote, uuid: evidence.uuid };
}
