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

import { EXF_MARKER_FILE_NAME } from '../core/contracts.ts';
import { parseExfMarker } from '../core/marker.ts';
import { assertPathIsWithinRoot } from '../core/pathPolicy.ts';

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
  const markerContent = await readFile(path.join(folderPath, EXF_MARKER_FILE_NAME), 'utf8');
  const markerUuid = parseExfMarker(markerContent);
  if (markerUuid !== uuid) {
    throw new Error(`Marker UUID ${markerUuid} does not match expected UUID ${uuid}.`);
  }
}

async function assertNoAncestorMarker(externalRootPath: string, targetPath: string): Promise<void> {
  const relativePath = path.relative(externalRootPath, targetPath);
  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = externalRootPath;

  for (const segment of segments.slice(0, -1)) {
    currentPath = path.join(currentPath, segment);
    if (await pathExists(path.join(currentPath, EXF_MARKER_FILE_NAME))) {
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
    if (await pathExists(path.join(folderPath, EXF_MARKER_FILE_NAME))) {
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

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
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
