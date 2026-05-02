import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { ReconcilePlan } from '../core/reconcilePlan.ts';

import { EXF_MARKER_FILE_NAME } from '../core/contracts.ts';
import { executeReconcilePlan } from './reconcileExecutor.ts';

const FIRST_UUID = '123e4567-e89b-42d3-a456-426614174000';
const SECOND_UUID = '123e4567-e89b-42d3-a456-426614174001';

describe('reconcile executor', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    const directoriesToRemove = tempDirectories.splice(0);
    await Promise.all(directoriesToRemove.map(async (directoryPath) => {
      await rm(directoryPath, { force: true, recursive: true });
    }));
  });

  it('moves planned folders and writes an audit journal', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const sourcePath = path.join(rootPath, 'Old Alpha');
    const targetPath = path.join(rootPath, 'Projects', 'Alpha');
    await writeMarker(sourcePath, FIRST_UUID);

    const result = await executeReconcilePlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [
        {
          currentExternalFolder: 'Old Alpha',
          kind: 'move',
          notePath: 'Projects/Alpha.md',
          sourcePath,
          targetExternalFolder: 'Projects/Alpha',
          targetPath,
          uuid: FIRST_UUID
        }
      ])
    });

    expect(result.succeeded).toBe(true);
    expect(await readFile(path.join(targetPath, EXF_MARKER_FILE_NAME), 'utf8')).toBe(`${FIRST_UUID}\n`);
    expect(result.journal.entries).toEqual([expect.objectContaining({
      outcome: 'success',
      sourcePath,
      targetPath,
      uuid: FIRST_UUID
    })]);
  });

  it('stops on the first failed move and does not continue best-effort', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const firstSourcePath = path.join(rootPath, 'Old Alpha');
    const firstTargetPath = path.join(rootPath, 'Projects', 'Alpha');
    const secondSourcePath = path.join(rootPath, 'Old Beta');
    const secondTargetPath = path.join(rootPath, 'Projects', 'Beta');
    await writeMarker(firstSourcePath, FIRST_UUID);
    await writeMarker(secondSourcePath, SECOND_UUID);
    await mkdir(firstTargetPath, { recursive: true });

    const result = await executeReconcilePlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [
        {
          currentExternalFolder: 'Old Alpha',
          kind: 'move',
          notePath: 'Projects/Alpha.md',
          sourcePath: firstSourcePath,
          targetExternalFolder: 'Projects/Alpha',
          targetPath: firstTargetPath,
          uuid: FIRST_UUID
        },
        {
          currentExternalFolder: 'Old Beta',
          kind: 'move',
          notePath: 'Projects/Beta.md',
          sourcePath: secondSourcePath,
          targetExternalFolder: 'Projects/Beta',
          targetPath: secondTargetPath,
          uuid: SECOND_UUID
        }
      ])
    });

    expect(result.succeeded).toBe(false);
    expect(result.journal.entries).toHaveLength(1);
    expect(result.journal.entries[0]).toEqual(expect.objectContaining({
      outcome: 'failure',
      uuid: FIRST_UUID
    }));
    await expect(readFile(path.join(secondSourcePath, EXF_MARKER_FILE_NAME), 'utf8')).resolves.toBe(`${SECOND_UUID}\n`);
  });
});

function buildPlan(rootPath: string, rows: ReconcilePlan['rows']): ReconcilePlan {
  return {
    errors: [],
    externalRootPath: rootPath,
    hasGlobalErrors: false,
    markdownReport: '',
    mutationSequence: 1,
    rows,
    summaryText: ''
  };
}

async function createTempRoot(tempDirectories: string[]): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'external-note-folders-'));
  tempDirectories.push(directoryPath);
  return directoryPath;
}

async function writeMarker(folderPath: string, uuid: string): Promise<void> {
  await mkdir(folderPath, { recursive: true });
  await writeFile(path.join(folderPath, EXF_MARKER_FILE_NAME), `${uuid}\n`, 'utf8');
}
