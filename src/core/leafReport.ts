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
import { folderInspectionSteps } from './folderInspectionBuild.ts';
import { folderStatusSteps } from './folderStatus.ts';
import { unmarkedLeafSteps } from './leafAnalysis.ts';
import { classifyLeafSegments } from './leafQuery.ts';
import { buildLeafTreeSteps } from './leafTreeBuild.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';
import { templateExclusionSummary } from './templateExclusions.ts';

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
  const allNodes = yield* buildLeafTreeSteps(snapshot, sorted, notesByTarget, true);
  const rootFolder = allNodes.find((node) => node.folderPath === snapshot.externalRoot);
  yield* folderStatusSteps(snapshot, allNodes);
  // Status analysis may add virtual expected paths.
  const tree = allNodes.filter((node) => node !== rootFolder);
  const coverage = yield* folderInspectionSteps(snapshot, allNodes, rootFolder);
  const statusCoverage = yield* statusCoverageSteps(snapshot, allNodes);
  return {
    ...statusCoverage,
    caseSensitivePaths: normalizePathForIdentity('A') !== normalizePathForIdentity('a'),
    coverage,
    externalRoot: snapshot.externalRoot,
    finishedAt: snapshot.finishedAt,
    mutationWarning: false,
    rows: sorted,
    ...(rootFolder ? { rootFolder } : {}),
    startedAt: snapshot.startedAt,
    templateExclusionSummary: templateExclusionSummary(snapshot.templateExclusions),
    tree,
    uncheckedCount: snapshot.issues.filter((issue) => issue.unchecked).length,
    vaultRoot: snapshot.vaultRoot
  };
}

function* statusCoverageSteps(snapshot: AuditSnapshot, allNodes: import('./leafTree.ts').LeafTreeNode[]): Generator<void, Partial<LeafReportModel>> {
  const uncheckedBindings: string[] = [];
  if (snapshot.statusScanMode) {
    for (const node of allNodes) {
      yield;
      if (node.unchecked || node.kind === 'excluded' || node.kind === 'link') {
        node.hiddenByCoverage = true;
        for (const note of node.notes) {
          if (note.status === 'valid' || note.status === 'duplicate-uuid') {
            const boundary = snapshot.issues.find((issue) =>
              issue.scope === 'external' && issue.unchecked && (node.folderPath === issue.location || node.folderPath.startsWith(issue.location + path.sep))
            );
            uncheckedBindings.push(`${note.notePath} → ${node.folderPath}: ${boundary?.reason ?? node.evidence?.status ?? 'Unchecked'}`);
          }
        }
      }
    }
  }
  const excludedCount = snapshot.external.ignoredDirectories.length;
  const linkCount = snapshot.issues.filter((issue) => issue.scope === 'external' && issue.kind === 'link').length;
  const repositoryCount = snapshot.issues.filter((issue) => issue.scope === 'external' && issue.code === 'git-repository-unavailable').length;
  const unreadableCount =
    snapshot.issues.filter((issue) => issue.scope === 'external' && issue.kind === 'directory' && !issue.exclusionSource && !issue.code).length;
  const scanSummary = `${snapshot.statusScanMode === 'filtered' ? 'Filtered' : 'Unfiltered'} external scan · ${String(excludedCount)} excluded branches · ${
    String(unreadableCount)
  } unreadable directories · ${String(linkCount)} skipped links · ${String(repositoryCount)} skipped repositories`;
  return snapshot.statusScanMode ? { scanSummary, statusScanMode: snapshot.statusScanMode, uncheckedBindings } : {};
}
