import { randomUUID } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import type {
  ReconcileMoveRow,
  ReconcilePlan
} from '../core/reconcilePlan.ts';

import {
  classifyExnfMarkerFileName,
  parseExnfMarkerFile
} from '../core/marker.ts';
import { assertPathIsWithinRoot } from '../core/pathPolicy.ts';

interface ParsedFolderMarker {
  format: 'legacy' | 'uuid-named';
  markerPath: string;
  uuid: string;
}

const JSON_INDENT = 2;

export interface ReconcileExecutionResult {
  journal: ReconcileJournal;
  journalPath: string;
  succeeded: boolean;
}

export interface ReconcileJournal {
  completedAt: null | string;
  entries: ReconcileJournalEntry[];
  externalRootPath: string;
  planMutationSequence: number;
  runId: string;
  schemaVersion: 1;
  startedAt: string;
}

export interface ReconcileJournalEntry {
  completedAt: null | string;
  message: null | string;
  notePath: string;
  outcome: 'failure' | 'success';
  sourcePath: string;
  startedAt: string;
  targetPath: string;
  uuid: string;
}

export async function executeReconcilePlan(input: {
  journalRootPath: string;
  plan: ReconcilePlan;
}): Promise<ReconcileExecutionResult> {
  const runId = randomUUID();
  const journalPath = path.join(input.journalRootPath, `${runId}.json`);
  const journal: ReconcileJournal = {
    completedAt: null,
    entries: [],
    externalRootPath: input.plan.externalRootPath,
    planMutationSequence: input.plan.mutationSequence,
    runId,
    schemaVersion: 1,
    startedAt: new Date().toISOString()
  };

  await mkdir(input.journalRootPath, { recursive: true });
  await writeJournal(journalPath, journal);

  let succeeded = true;
  for (const row of input.plan.rows) {
    if (row.kind !== 'move') {
      continue;
    }

    const entry = await executeMove(input.plan.externalRootPath, row);
    journal.entries.push(entry);
    await writeJournal(journalPath, journal);
    if (entry.outcome === 'failure') {
      succeeded = false;
      break;
    }
  }

  journal.completedAt = new Date().toISOString();
  await writeJournal(journalPath, journal);

  return {
    journal,
    journalPath,
    succeeded
  };
}

async function assertMarkerMatches(folderPath: string, uuid: string): Promise<void> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const parsedMarkers: ParsedFolderMarker[] = [];
  const otherUuids = new Set<string>();
  let foundMatchingMarker = false;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const markerPath = path.join(folderPath, entry.name);
    try {
      const fileNameResult = classifyExnfMarkerFileName(entry.name);
      if (fileNameResult.kind === 'not-marker') {
        continue;
      }

      const marker = parseExnfMarkerFile(entry.name, await readFile(markerPath, 'utf8'));
      parsedMarkers.push({
        format: marker.format,
        markerPath,
        uuid: marker.uuid
      });
      if (marker.uuid === uuid) {
        foundMatchingMarker = true;
        continue;
      }
      otherUuids.add(marker.uuid);
    } catch (error: unknown) {
      throw new Error(`Marker at ${markerPath} is malformed: ${error instanceof Error ? error.message : 'Unknown marker parse error.'}`, {
        cause: error
      });
    }
  }

  const legacyConflict = findLegacyMarkerConflict(parsedMarkers);
  if (legacyConflict) {
    throw new Error(`Marker conflict at ${folderPath}: ${legacyConflict}`);
  }

  if (foundMatchingMarker) {
    return;
  }

  const detail = otherUuids.size > 0
    ? ` Found marker UUID(s): ${[...otherUuids].sort().join(', ')}.`
    : '';
  throw new Error(`Expected marker UUID ${uuid} was not found in ${folderPath}.${detail}`);
}

async function assertNoAncestorMarker(externalRootPath: string, targetPath: string): Promise<void> {
  const relativePath = path.relative(externalRootPath, targetPath);
  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = externalRootPath;

  for (const segment of segments.slice(0, -1)) {
    currentPath = path.join(currentPath, segment);
    if (await folderHasMarkerFile(currentPath)) {
      throw new Error(`Target parent is inside an existing bound folder: ${currentPath}`);
    }
  }
}

async function assertNoDescendantMarker(targetPath: string): Promise<void> {
  try {
    await access(targetPath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  await visitDescendantFolders(targetPath, async (folderPath) => {
    if (await folderHasMarkerFile(folderPath)) {
      throw new Error(`Target folder contains a descendant bound folder: ${folderPath}`);
    }
  });
}

async function assertNoSymlinkInMovePath(externalRootPath: string, candidatePath: string): Promise<void> {
  const relativePath = path.relative(externalRootPath, candidatePath);
  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = externalRootPath;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    const stat = await tryLstat(currentPath);
    if (!stat) {
      return;
    }

    if (stat.isSymbolicLink()) {
      throw new Error(`Reconcile move path crosses a symbolic link or reparse point: ${currentPath}`);
    }
  }
}

async function assertTargetMissing(targetPath: string): Promise<void> {
  try {
    await access(targetPath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  throw new Error(`Target path already exists: ${targetPath}`);
}

async function executeMove(externalRootPath: string, row: ReconcileMoveRow): Promise<ReconcileJournalEntry> {
  const entry: ReconcileJournalEntry = {
    completedAt: null,
    message: null,
    notePath: row.notePath,
    outcome: 'failure',
    sourcePath: row.sourcePath,
    startedAt: new Date().toISOString(),
    targetPath: row.targetPath,
    uuid: row.uuid
  };

  try {
    assertPathIsWithinRoot(externalRootPath, row.sourcePath);
    assertPathIsWithinRoot(externalRootPath, row.targetPath);
    await assertNoSymlinkInMovePath(externalRootPath, row.sourcePath);
    await assertNoSymlinkInMovePath(externalRootPath, row.targetPath);
    await assertMarkerMatches(row.sourcePath, row.uuid);
    await assertNoDescendantMarker(row.targetPath);
    await assertTargetMissing(row.targetPath);
    await assertNoAncestorMarker(externalRootPath, row.targetPath);
    await mkdir(path.dirname(row.targetPath), { recursive: true });
    await rename(row.sourcePath, row.targetPath);
    await assertMarkerMatches(row.targetPath, row.uuid);
    entry.outcome = 'success';
  } catch (error: unknown) {
    entry.message = error instanceof Error ? error.message : 'Unknown reconcile move failure.';
  } finally {
    entry.completedAt = new Date().toISOString();
  }

  return entry;
}

function findLegacyMarkerConflict(markers: readonly ParsedFolderMarker[]): null | string {
  const uuidNamedMarkerUuids = new Set(
    markers
      .filter((marker) => marker.format === 'uuid-named')
      .map((marker) => marker.uuid)
  );
  if (uuidNamedMarkerUuids.size === 0) {
    return null;
  }

  const conflictingLegacyMarker = markers.find((marker) => marker.format === 'legacy' && !uuidNamedMarkerUuids.has(marker.uuid));
  if (!conflictingLegacyMarker) {
    return null;
  }

  return `legacy marker ${conflictingLegacyMarker.markerPath} contains UUID ${conflictingLegacyMarker.uuid}, but UUID-named marker(s) contain ${
    [...uuidNamedMarkerUuids].sort().join(', ')
  }.`;
}

async function folderHasMarkerFile(folderPath: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(folderPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    try {
      if (classifyExnfMarkerFileName(entry.name).kind !== 'not-marker') {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

async function tryLstat(targetPath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(targetPath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function visitDescendantFolders(folderPath: string, visitor: (folderPath: string) => Promise<void>): Promise<void> {
  let childEntries;
  try {
    childEntries = await readdir(folderPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  for (const childEntry of childEntries) {
    if (!childEntry.isDirectory()) {
      continue;
    }

    const childPath = path.join(folderPath, childEntry.name);
    await visitor(childPath);
    await visitDescendantFolders(childPath, visitor);
  }
}

async function writeJournal(journalPath: string, journal: ReconcileJournal): Promise<void> {
  await writeFile(journalPath, `${JSON.stringify(journal, null, JSON_INDENT)}\n`, 'utf8');
}
