import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import type {
  AdoptionAdoptRow,
  AdoptionPlan
} from '../core/adoptionPlan.ts';

import { getAdoptionRows } from '../core/adoptionPlan.ts';
import { generateCanonicalUuid } from '../core/uuid.ts';

const JSON_INDENT = 2;

export interface AdoptionExecutionOperations {
  assertMarkerMatches: (row: AdoptionAdoptRow, uuid: string) => Promise<void>;
  assertNoteUuidMatches: (row: AdoptionAdoptRow, uuid: string) => Promise<void>;
  writeMarker: (row: AdoptionAdoptRow, uuid: string) => Promise<void>;
  writeNoteUuid: (row: AdoptionAdoptRow, uuid: string) => Promise<void>;
}

export interface AdoptionExecutionResult {
  journal: AdoptionJournal;
  journalPath: string;
  succeeded: boolean;
}

export interface AdoptionJournal {
  completedAt: null | string;
  entries: AdoptionJournalEntry[];
  externalRootPath: string;
  kind: 'external-folder-adoption';
  runId: string;
  schemaVersion: 1;
  startedAt: string;
}

export interface AdoptionJournalEntry {
  completedAt: null | string;
  externalFolder: string;
  folderPath: string;
  message: null | string;
  notePath: string;
  outcome: 'failure' | 'pending' | 'success';
  stage: AdoptionJournalStage;
  startedAt: null | string;
  uuid: string;
}

export type AdoptionJournalStage =
  | 'complete'
  | 'frontmatter-write'
  | 'marker-write'
  | 'pending'
  | 'preflight';

export interface IncompleteAdoptionJournal {
  entryCount: number;
  journalPath: string;
  runId: string;
  startedAt: string;
}

export async function executeAdoptionPlan(input: {
  journalRootPath: string;
  operations: AdoptionExecutionOperations;
  plan: AdoptionPlan;
}): Promise<AdoptionExecutionResult> {
  const runId = randomUUID();
  const journalPath = path.join(input.journalRootPath, `${runId}.json`);
  const journal = buildNewJournal(input.plan, runId);

  await mkdir(input.journalRootPath, { recursive: true });
  await writeJournal(journalPath, journal);
  const succeeded = await executeJournalEntries(journalPath, journal, input.operations);

  return {
    journal,
    journalPath,
    succeeded
  };
}

export async function listIncompleteAdoptionJournals(journalRootPath: string): Promise<IncompleteAdoptionJournal[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(journalRootPath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const incompleteJournals: IncompleteAdoptionJournal[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith('.json')) {
      continue;
    }

    const journalPath = path.join(journalRootPath, fileName);
    const journal = await readAdoptionJournal(journalPath);
    if (journal.completedAt !== null) {
      continue;
    }

    incompleteJournals.push({
      entryCount: journal.entries.length,
      journalPath,
      runId: journal.runId,
      startedAt: journal.startedAt
    });
  }

  return incompleteJournals.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export async function readAdoptionJournal(journalPath: string): Promise<AdoptionJournal> {
  const parsedJournal = JSON.parse(await readFile(journalPath, 'utf8')) as unknown;
  if (!isAdoptionJournal(parsedJournal)) {
    throw new Error(`Invalid adoption journal: ${journalPath}`);
  }

  return parsedJournal;
}

export async function resumeAdoptionJournal(input: {
  journalPath: string;
  operations: AdoptionExecutionOperations;
}): Promise<AdoptionExecutionResult> {
  const journal = await readAdoptionJournal(input.journalPath);
  if (journal.completedAt !== null) {
    return {
      journal,
      journalPath: input.journalPath,
      succeeded: true
    };
  }

  const succeeded = await executeJournalEntries(input.journalPath, journal, input.operations);
  return {
    journal,
    journalPath: input.journalPath,
    succeeded
  };
}

/* eslint-disable require-atomic-updates -- Journal execution mutates one local journal serially between awaited filesystem writes. */
async function assertCompletedEntry(
  entry: AdoptionJournalEntry,
  operations: AdoptionExecutionOperations
): Promise<void> {
  const row = toAdoptionRow(entry);
  await operations.assertMarkerMatches(row, entry.uuid);
  await operations.assertNoteUuidMatches(row, entry.uuid);
}

function buildNewJournal(plan: AdoptionPlan, runId: string): AdoptionJournal {
  return {
    completedAt: null,
    entries: getAdoptionRows(plan).map((row) => ({
      completedAt: null,
      externalFolder: row.externalFolder,
      folderPath: row.folderPath,
      message: null,
      notePath: row.notePath,
      outcome: 'pending',
      stage: 'pending',
      startedAt: null,
      uuid: generateCanonicalUuid()
    })),
    externalRootPath: plan.externalRootPath,
    kind: 'external-folder-adoption',
    runId,
    schemaVersion: 1,
    startedAt: new Date().toISOString()
  };
}

async function executeEntry(
  entry: AdoptionJournalEntry,
  operations: AdoptionExecutionOperations
): Promise<void> {
  const row = toAdoptionRow(entry);
  entry.startedAt ??= new Date().toISOString();
  entry.completedAt = null;
  entry.message = null;
  entry.outcome = 'pending';

  if (entry.stage === 'frontmatter-write') {
    await operations.assertMarkerMatches(row, entry.uuid);
    await operations.writeNoteUuid(row, entry.uuid);
    await operations.assertNoteUuidMatches(row, entry.uuid);
    entry.stage = 'complete';
    entry.outcome = 'success';
    entry.completedAt = new Date().toISOString();
    return;
  }

  entry.stage = 'preflight';
  entry.stage = 'marker-write';
  await operations.writeMarker(row, entry.uuid);
  await operations.assertMarkerMatches(row, entry.uuid);
  entry.stage = 'frontmatter-write';
  await operations.writeNoteUuid(row, entry.uuid);
  await operations.assertNoteUuidMatches(row, entry.uuid);
  entry.stage = 'complete';
  entry.outcome = 'success';
  entry.completedAt = new Date().toISOString();
}

async function executeJournalEntries(
  journalPath: string,
  journal: AdoptionJournal,
  operations: AdoptionExecutionOperations
): Promise<boolean> {
  for (const entry of journal.entries) {
    try {
      if (entry.outcome === 'success') {
        await assertCompletedEntry(entry, operations);
      } else {
        await executeEntry(entry, operations);
      }
    } catch (error: unknown) {
      entry.outcome = 'failure';
      entry.message = error instanceof Error ? error.message : 'Unknown adoption failure.';
      entry.completedAt = new Date().toISOString();
      await writeJournal(journalPath, journal);
      return false;
    }

    await writeJournal(journalPath, journal);
  }

  journal.completedAt = new Date().toISOString();
  await writeJournal(journalPath, journal);
  return true;
}
/* eslint-enable require-atomic-updates -- Re-enable after serialized journal mutation helpers. */

function isAdoptionJournal(input: unknown): input is AdoptionJournal {
  return (
    typeof input === 'object'
    && input !== null
    && 'kind' in input
    && input.kind === 'external-folder-adoption'
    && 'schemaVersion' in input
    && input.schemaVersion === 1
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

function toAdoptionRow(entry: AdoptionJournalEntry): AdoptionAdoptRow {
  return {
    externalFolder: entry.externalFolder,
    folderPath: entry.folderPath,
    kind: 'adopt',
    notePath: entry.notePath
  };
}

async function writeJournal(journalPath: string, journal: AdoptionJournal): Promise<void> {
  await writeFile(journalPath, `${JSON.stringify(journal, null, JSON_INDENT)}\n`, 'utf8');
}
