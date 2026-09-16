// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation follows ADR-0016; browser queries do not import this module.
import path from 'node:path';

import type { AuditSnapshot } from './auditTypes.ts';
import type {
  LeafNoteMatch,
  LeafReportModel,
  LeafRow
} from './leafQuery.ts';

import {
  finishAuditSteps,
  sortAuditSteps
} from './auditSteps.ts';
import { unmarkedLeafSteps } from './leafAnalysis.ts';
import { classifyLeafSegments } from './leafQuery.ts';
import { buildLeafTreeSteps } from './leafTreeBuild.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

export function buildLeafReport(snapshot: AuditSnapshot): LeafReportModel {
  return finishAuditSteps(buildLeafReportSteps(snapshot));
}

export function* buildLeafReportSteps(snapshot: AuditSnapshot): Generator<void, LeafReportModel> {
  const notesByTarget = new Map<string, LeafNoteMatch[]>();
  for (const note of snapshot.notes) {
    try {
      const key = normalizePathForIdentity(deriveExternalFolderPath(note.relativePath, snapshot.externalRoot));
      const matches = notesByTarget.get(key) ?? [];
      matches.push({
        absolutePath: note.notePath,
        notePath: note.relativePath,
        status: note.uuid && snapshot.vault.duplicatePaths.has(note.uuid) ? 'duplicate-uuid' : note.status
      });
      notesByTarget.set(key, matches);
    } catch {
      // A note with no valid derived path cannot be an exact path match.
    }
    yield;
  }
  const leaves = yield* unmarkedLeafSteps(snapshot);
  const rows: LeafRow[] = [];
  for (const folderPath of leaves) {
    const relativePath = path.relative(snapshot.externalRoot, folderPath);
    const segments = relativePath.split(path.sep);
    const notes = notesByTarget.get(normalizePathForIdentity(folderPath)) ?? [];
    rows.push({
      categories: classifyLeafSegments(segments),
      folderPath,
      notes,
      relativePath,
      searchText: [relativePath, ...notes.map((note) => note.notePath)].join('\n').toLowerCase(),
      segments
    });
    yield;
  }
  const sorted = yield* sortAuditSteps(rows, (a, b) => Number(b.notes.length > 0) - Number(a.notes.length > 0) || a.relativePath.localeCompare(b.relativePath));
  return {
    externalRoot: snapshot.externalRoot,
    finishedAt: snapshot.finishedAt,
    mutationWarning: false,
    rows: sorted,
    startedAt: snapshot.startedAt,
    tree: yield* buildLeafTreeSteps(snapshot, sorted, notesByTarget),
    uncheckedCount: snapshot.issues.filter((issue) => issue.unchecked).length,
    vaultRoot: snapshot.vaultRoot
  };
}
