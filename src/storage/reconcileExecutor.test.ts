import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
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

import { EXNF_MARKER_FILE_NAME } from '../core/contracts.ts';
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
    expect(await readFile(path.join(targetPath, EXNF_MARKER_FILE_NAME), 'utf8')).toBe(`${FIRST_UUID}\n`);
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
    await expect(readFile(path.join(secondSourcePath, EXNF_MARKER_FILE_NAME), 'utf8')).resolves.toBe(`${SECOND_UUID}\n`);
  });

  it('fails closed when a planned move path escapes the external root', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const sourcePath = path.join(rootPath, 'Old Alpha');
    const targetPath = path.join(path.dirname(rootPath), 'Escaped Alpha');
    await writeMarker(sourcePath, FIRST_UUID);

    const result = await executeReconcilePlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [
        {
          currentExternalFolder: 'Old Alpha',
          kind: 'move',
          notePath: 'Projects/Alpha.md',
          sourcePath,
          targetExternalFolder: '../Escaped Alpha',
          targetPath,
          uuid: FIRST_UUID
        }
      ])
    });

    expect(result.succeeded).toBe(false);
    const entry = result.journal.entries[0];
    expect(entry?.message).toContain('escapes the configured root');
    expect(entry).toEqual(expect.objectContaining({
      outcome: 'failure',
      uuid: FIRST_UUID
    }));
  });

  it('fails closed when the live target contains a descendant marker', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const sourcePath = path.join(rootPath, 'Old Alpha');
    const targetPath = path.join(rootPath, 'Projects', 'Alpha');
    await writeMarker(sourcePath, FIRST_UUID);
    await writeMarker(path.join(targetPath, 'Child'), SECOND_UUID);

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

    expect(result.succeeded).toBe(false);
    const entry = result.journal.entries[0];
    expect(entry?.message).toContain('descendant bound folder');
    expect(entry).toEqual(expect.objectContaining({
      outcome: 'failure',
      uuid: FIRST_UUID
    }));
  });

  it('fails closed when the live source marker does not match the plan UUID', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const sourcePath = path.join(rootPath, 'Old Alpha');
    const targetPath = path.join(rootPath, 'Projects', 'Alpha');
    await writeMarker(sourcePath, SECOND_UUID);

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

    expect(result.succeeded).toBe(false);
    const entry = result.journal.entries[0];
    expect(entry?.message).toContain('does not match expected UUID');
    expect(entry).toEqual(expect.objectContaining({
      outcome: 'failure',
      uuid: FIRST_UUID
    }));
  });

  it('fails closed when a target ancestor already has a marker', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const sourcePath = path.join(rootPath, 'Old Alpha');
    const targetPath = path.join(rootPath, 'Projects', 'Alpha');
    await writeMarker(sourcePath, FIRST_UUID);
    await writeMarker(path.join(rootPath, 'Projects'), SECOND_UUID);

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

    expect(result.succeeded).toBe(false);
    const entry = result.journal.entries[0];
    expect(entry?.message).toContain('inside an existing bound folder');
    expect(entry).toEqual(expect.objectContaining({
      outcome: 'failure',
      uuid: FIRST_UUID
    }));
  });

  it('fails closed when a planned target path crosses a symlink', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const externalTargetPath = await createTempRoot(tempDirectories);
    const sourcePath = path.join(rootPath, 'Old Alpha');
    const linkPath = path.join(rootPath, 'Link');
    const targetPath = path.join(linkPath, 'Alpha');
    await writeMarker(sourcePath, FIRST_UUID);
    await symlink(externalTargetPath, linkPath, 'dir');

    const result = await executeReconcilePlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [
        {
          currentExternalFolder: 'Old Alpha',
          kind: 'move',
          notePath: 'Link/Alpha.md',
          sourcePath,
          targetExternalFolder: 'Link/Alpha',
          targetPath,
          uuid: FIRST_UUID
        }
      ])
    });

    expect(result.succeeded).toBe(false);
    const entry = result.journal.entries[0];
    expect(entry?.message).toContain('symbolic link or reparse point');
    expect(entry).toEqual(expect.objectContaining({
      outcome: 'failure',
      uuid: FIRST_UUID
    }));
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
    summaryText: '',
    warnings: []
  };
}

async function createTempRoot(tempDirectories: string[]): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'external-note-folders-'));
  tempDirectories.push(directoryPath);
  return directoryPath;
}

async function writeMarker(folderPath: string, uuid: string): Promise<void> {
  await mkdir(folderPath, { recursive: true });
  await writeFile(path.join(folderPath, EXNF_MARKER_FILE_NAME), `${uuid}\n`, 'utf8');
}
