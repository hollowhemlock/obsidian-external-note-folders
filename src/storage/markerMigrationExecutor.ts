import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import type {
  MarkerMigrationPlan,
  MarkerMigrationRenameRow
} from '../core/markerMigrationPlan.ts';

import {
  classifyExnfMarkerFileName,
  parseExnfMarker,
  parseExnfMarkerFile
} from '../core/marker.ts';
import { assertPathIsWithinRoot } from '../core/pathPolicy.ts';

const JSON_INDENT = 2;

export interface MarkerMigrationExecutionResult {
  journal: MarkerMigrationJournal;
  journalPath: string;
  succeeded: boolean;
}

export interface MarkerMigrationJournal {
  completedAt: null | string;
  entries: MarkerMigrationJournalEntry[];
  externalRootPath: string;
  planMutationSequence: number;
  runId: string;
  schemaVersion: 1;
  startedAt: string;
}

export interface MarkerMigrationJournalEntry {
  completedAt: null | string;
  message: null | string;
  outcome: 'failure' | 'success';
  sourcePath: string;
  startedAt: string;
  targetPath: string;
  uuid: string;
}

export async function executeMarkerMigrationPlan(input: {
  journalRootPath: string;
  plan: MarkerMigrationPlan;
}): Promise<MarkerMigrationExecutionResult> {
  const runId = randomUUID();
  const journalPath = path.join(input.journalRootPath, `${runId}.json`);
  const journal: MarkerMigrationJournal = {
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
    if (row.kind !== 'rename') {
      continue;
    }

    const entry = await executeRename(input.plan.externalRootPath, row);
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

async function assertNoConflictingUuidNamedMarker(folderPath: string, uuid: string): Promise<void> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const markerPath = path.join(folderPath, entry.name);
    let fileNameResult: ReturnType<typeof classifyExnfMarkerFileName>;
    try {
      fileNameResult = classifyExnfMarkerFileName(entry.name);
    } catch (error: unknown) {
      throw new Error(`Marker at ${markerPath} is malformed: ${error instanceof Error ? error.message : 'Unknown marker parse error.'}`, {
        cause: error
      });
    }

    if (fileNameResult.kind !== 'uuid-named') {
      continue;
    }

    let marker: ReturnType<typeof parseExnfMarkerFile>;
    try {
      marker = parseExnfMarkerFile(entry.name, await readFile(markerPath, 'utf8'));
    } catch (error: unknown) {
      throw new Error(`Marker at ${markerPath} is malformed: ${error instanceof Error ? error.message : 'Unknown marker parse error.'}`, {
        cause: error
      });
    }

    if (marker.uuid !== uuid) {
      throw new Error(`Conflicting UUID-named marker already exists: ${markerPath}`);
    }
  }
}

async function assertTargetMissing(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  throw new Error(`Target marker already exists: ${targetPath}`);
}

async function executeRename(externalRootPath: string, row: MarkerMigrationRenameRow): Promise<MarkerMigrationJournalEntry> {
  const entry: MarkerMigrationJournalEntry = {
    completedAt: null,
    message: null,
    outcome: 'failure',
    sourcePath: row.sourcePath,
    startedAt: new Date().toISOString(),
    targetPath: row.targetPath,
    uuid: row.uuid
  };

  try {
    assertPathIsWithinRoot(externalRootPath, row.sourcePath);
    assertPathIsWithinRoot(externalRootPath, row.targetPath);
    const sourceUuid = parseExnfMarker(await readFile(row.sourcePath, 'utf8'));
    if (sourceUuid !== row.uuid) {
      throw new Error(`Source marker UUID ${sourceUuid} does not match expected UUID ${row.uuid}.`);
    }

    await assertTargetMissing(row.targetPath);
    await assertNoConflictingUuidNamedMarker(path.dirname(row.sourcePath), row.uuid);
    await rename(row.sourcePath, row.targetPath);

    const migratedMarker = parseExnfMarkerFile(path.basename(row.targetPath), await readFile(row.targetPath, 'utf8'));
    if (migratedMarker.uuid !== row.uuid) {
      throw new Error(`Migrated marker UUID ${migratedMarker.uuid} does not match expected UUID ${row.uuid}.`);
    }

    entry.outcome = 'success';
  } catch (error: unknown) {
    entry.message = error instanceof Error ? error.message : 'Unknown marker migration failure.';
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

async function writeJournal(journalPath: string, journal: MarkerMigrationJournal): Promise<void> {
  await writeFile(journalPath, `${JSON.stringify(journal, null, JSON_INDENT)}\n`, 'utf8');
}
