import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import type { SetupPlan } from '../core/setupPlan.ts';

import { isCanonicalUuid } from '../core/uuid.ts';

const JSON_INDENT = 2;

export interface SetupExecutionOperations {
  assertComplete: (journal: SetupJournal) => Promise<void>;
  createFolder: (journal: SetupJournal, resume: boolean) => Promise<void>;
  writeMarker: (journal: SetupJournal) => Promise<void>;
  writeNoteUuid: (journal: SetupJournal) => Promise<void>;
}

export interface SetupExecutionResult {
  journal: SetupJournal;
  journalPath: string;
  succeeded: boolean;
}

export interface SetupJournal {
  action: 'confirm-marker-restore' | 'confirm-unmarked-adoption' | 'create-new';
  completedAt: null | string;
  externalRootPath: string;
  kind: 'external-folder-setup';
  message: null | string;
  notePath: string;
  outcome: 'failure' | 'pending' | 'success';
  runId: string;
  schemaVersion: 1;
  stage: SetupJournalStage;
  startedAt: string;
  targetPath: string;
  uuid: string;
}

export type SetupJournalStage = 'complete' | 'folder-create' | 'frontmatter-write' | 'marker-write';

export async function executeSetupPlan(input: {
  journalRootPath: string;
  operations: SetupExecutionOperations;
  plan: SetupPlan;
}): Promise<SetupExecutionResult> {
  if (
    input.plan.action !== 'create-new'
    && input.plan.action !== 'confirm-unmarked-adoption'
    && input.plan.action !== 'confirm-marker-restore'
  ) {
    throw new Error(`Setup plan action ${input.plan.action} cannot be executed.`);
  }
  if (!input.plan.uuid || !isCanonicalUuid(input.plan.uuid)) {
    throw new Error('Setup execution requires a preselected canonical UUID.');
  }
  const runId = randomUUID();
  const journalPath = path.join(input.journalRootPath, `${runId}.json`);
  const journal: SetupJournal = {
    action: input.plan.action,
    completedAt: null,
    externalRootPath: input.plan.externalRootPath,
    kind: 'external-folder-setup',
    message: null,
    notePath: input.plan.notePath,
    outcome: 'pending',
    runId,
    schemaVersion: 1,
    stage: initialStage(input.plan.action),
    startedAt: new Date().toISOString(),
    targetPath: input.plan.targetPath,
    uuid: input.plan.uuid
  };
  await mkdir(input.journalRootPath, { recursive: true });
  await writeJournal(journalPath, journal);
  return runSetupJournal(journalPath, journal, input.operations, false);
}

export async function listIncompleteSetupJournals(journalRootPath: string, notePath?: string): Promise<({ journalPath: string } & SetupJournal)[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(journalRootPath);
  } catch (error: unknown) {
    if (isMissingError(error)) {
      return [];
    }
    throw error;
  }
  const journals: ({ journalPath: string } & SetupJournal)[] = [];
  for (const fileName of fileNames.sort()) {
    if (!fileName.endsWith('.json')) {
      continue;
    }
    const journalPath = path.join(journalRootPath, fileName);
    const journal = await readSetupJournal(journalPath);
    if (journal.completedAt === null && (!notePath || journal.notePath === notePath)) {
      journals.push({ ...journal, journalPath });
    }
  }
  return journals;
}

export async function readSetupJournal(journalPath: string): Promise<SetupJournal> {
  const parsed = JSON.parse(await readFile(journalPath, 'utf8')) as unknown;
  if (!isSetupJournal(parsed)) {
    throw new Error(`Invalid setup journal: ${journalPath}`);
  }
  return parsed;
}

export async function resumeSetupJournal(input: {
  journalPath: string;
  operations: SetupExecutionOperations;
}): Promise<SetupExecutionResult> {
  const journal = await readSetupJournal(input.journalPath);
  return runSetupJournal(input.journalPath, journal, input.operations, true);
}

function initialStage(action: SetupJournal['action']): SetupJournalStage {
  if (action === 'create-new') {
    return 'folder-create';
  }
  if (action === 'confirm-unmarked-adoption') {
    return 'marker-write';
  }
  return 'frontmatter-write';
}

function isMissingError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

// The journal boundary validates every persisted field explicitly before resume.
// eslint-disable-next-line complexity -- Flattening these independent schema checks would obscure the persisted contract.
function isSetupJournal(input: unknown): input is SetupJournal {
  return typeof input === 'object'
    && input !== null
    && 'kind' in input
    && input.kind === 'external-folder-setup'
    && 'schemaVersion' in input
    && input.schemaVersion === 1
    && 'action' in input
    && (input.action === 'create-new' || input.action === 'confirm-unmarked-adoption' || input.action === 'confirm-marker-restore')
    && 'stage' in input
    && (input.stage === 'folder-create' || input.stage === 'marker-write' || input.stage === 'frontmatter-write' || input.stage === 'complete')
    && isStageValidForAction(input.action, input.stage)
    && 'completedAt' in input
    && (input.completedAt === null || typeof input.completedAt === 'string')
    && 'externalRootPath' in input && typeof input.externalRootPath === 'string' && path.isAbsolute(input.externalRootPath)
    && 'message' in input && (input.message === null || typeof input.message === 'string')
    && 'notePath' in input && typeof input.notePath === 'string'
    && 'outcome' in input && (input.outcome === 'failure' || input.outcome === 'pending' || input.outcome === 'success')
    && 'runId' in input && typeof input.runId === 'string'
    && 'startedAt' in input && typeof input.startedAt === 'string'
    && 'targetPath' in input && typeof input.targetPath === 'string' && path.isAbsolute(input.targetPath)
    && 'uuid' in input && typeof input.uuid === 'string' && isCanonicalUuid(input.uuid);
}

function isStageValidForAction(action: SetupJournal['action'], stage: SetupJournalStage): boolean {
  if (action === 'create-new') {
    return true;
  }
  if (action === 'confirm-unmarked-adoption') {
    return stage !== 'folder-create';
  }
  return stage === 'frontmatter-write' || stage === 'complete';
}

/* eslint-disable require-atomic-updates -- Journal execution mutates one local journal serially between awaited filesystem writes. */
async function runSetupJournal(
  journalPath: string,
  journal: SetupJournal,
  operations: SetupExecutionOperations,
  resume: boolean
): Promise<SetupExecutionResult> {
  if (journal.completedAt !== null) {
    return { journal, journalPath, succeeded: true };
  }
  journal.outcome = 'pending';
  journal.message = null;
  await writeJournal(journalPath, journal);
  try {
    if (journal.stage === 'folder-create') {
      await operations.createFolder(journal, resume);
      journal.stage = 'marker-write';
      await writeJournal(journalPath, journal);
    }
    if (journal.stage === 'marker-write') {
      await operations.writeMarker(journal);
      journal.stage = 'frontmatter-write';
      await writeJournal(journalPath, journal);
    }
    if (journal.stage === 'frontmatter-write') {
      await operations.writeNoteUuid(journal);
      journal.stage = 'complete';
      await writeJournal(journalPath, journal);
    }
    await operations.assertComplete(journal);
    journal.outcome = 'success';
    journal.completedAt = new Date().toISOString();
  } catch (error: unknown) {
    journal.outcome = 'failure';
    journal.message = error instanceof Error ? error.message : 'Unknown setup failure.';
    await writeJournal(journalPath, journal);
    return { journal, journalPath, succeeded: false };
  }
  await writeJournal(journalPath, journal);
  return { journal, journalPath, succeeded: true };
}
/* eslint-enable require-atomic-updates -- Re-enable after serialized journal mutation. */

async function writeJournal(journalPath: string, journal: SetupJournal): Promise<void> {
  await writeFile(journalPath, `${JSON.stringify(journal, null, JSON_INDENT)}\n`, 'utf8');
}
