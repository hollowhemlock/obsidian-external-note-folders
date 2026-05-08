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
  journalPath: string,
  journal: AdoptionJournal,
  entry: AdoptionJournalEntry,
  operations: AdoptionExecutionOperations
): Promise<void> {
  const row = toAdoptionRow(entry);
  entry.startedAt ??= new Date().toISOString();
  entry.completedAt = null;
  entry.message = null;
  entry.outcome = 'pending';
  await writeJournal(journalPath, journal);

  if (entry.stage === 'frontmatter-write') {
    await operations.assertMarkerMatches(row, entry.uuid);
    await operations.writeNoteUuid(row, entry.uuid);
    await operations.assertNoteUuidMatches(row, entry.uuid);
    entry.stage = 'complete';
    entry.outcome = 'success';
    entry.completedAt = new Date().toISOString();
    await writeJournal(journalPath, journal);
    return;
  }

  entry.stage = 'preflight';
  await writeJournal(journalPath, journal);
  entry.stage = 'marker-write';
  await writeJournal(journalPath, journal);
  await operations.writeMarker(row, entry.uuid);
  await operations.assertMarkerMatches(row, entry.uuid);
  entry.stage = 'frontmatter-write';
  await writeJournal(journalPath, journal);
  await operations.writeNoteUuid(row, entry.uuid);
  await operations.assertNoteUuidMatches(row, entry.uuid);
  entry.stage = 'complete';
  entry.outcome = 'success';
  entry.completedAt = new Date().toISOString();
  await writeJournal(journalPath, journal);
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
        await executeEntry(journalPath, journal, entry, operations);
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
    isRecord(input)
    && input['kind'] === 'external-folder-adoption'
    && input['schemaVersion'] === 1
    && isNullOrString(input['completedAt'])
    && Array.isArray(input['entries'])
    && input['entries'].every(isAdoptionJournalEntry)
    && typeof input['externalRootPath'] === 'string'
    && typeof input['runId'] === 'string'
    && typeof input['startedAt'] === 'string'
  );
}

function isAdoptionJournalEntry(input: unknown): input is AdoptionJournalEntry {
  return (
    isRecord(input)
    && isNullOrString(input['completedAt'])
    && typeof input['externalFolder'] === 'string'
    && typeof input['folderPath'] === 'string'
    && isNullOrString(input['message'])
    && typeof input['notePath'] === 'string'
    && isAdoptionJournalOutcome(input['outcome'])
    && isAdoptionJournalStage(input['stage'])
    && isNullOrString(input['startedAt'])
    && typeof input['uuid'] === 'string'
  );
}

function isAdoptionJournalOutcome(input: unknown): input is AdoptionJournalEntry['outcome'] {
  return input === 'failure' || input === 'pending' || input === 'success';
}

function isAdoptionJournalStage(input: unknown): input is AdoptionJournalStage {
  return (
    input === 'complete'
    || input === 'frontmatter-write'
    || input === 'marker-write'
    || input === 'pending'
    || input === 'preflight'
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

function isNullOrString(input: unknown): input is null | string {
  return input === null || typeof input === 'string';
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
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
