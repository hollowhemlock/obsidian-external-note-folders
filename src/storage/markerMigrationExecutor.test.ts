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

import type { MarkerMigrationPlan } from '../core/markerMigrationPlan.ts';

import { EXNF_LEGACY_MARKER_FILE_NAME } from '../core/contracts.ts';
import { buildExnfMarkerFileName } from '../core/marker.ts';
import { executeMarkerMigrationPlan } from './markerMigrationExecutor.ts';

const OTHER_UUID = '123e4567-e89b-42d3-a456-426614174001';
const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('marker migration executor', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    const directoriesToRemove = tempDirectories.splice(0);
    await Promise.all(directoriesToRemove.map(async (directoryPath) => {
      await rm(directoryPath, { force: true, recursive: true });
    }));
  });

  it('renames legacy markers to UUID-named markers and writes a journal', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const folderPath = path.join(rootPath, 'Projects', 'Alpha');
    const sourcePath = await writeLegacyMarker(folderPath, VALID_UUID);
    const targetPath = path.join(folderPath, buildExnfMarkerFileName(VALID_UUID));

    const result = await executeMarkerMigrationPlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [{
        externalFolder: 'Projects/Alpha',
        kind: 'rename',
        sourcePath,
        targetPath,
        uuid: VALID_UUID
      }])
    });

    expect(result.succeeded).toBe(true);
    await expect(readFile(sourcePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(`${VALID_UUID}\n`);
    expect(result.journal.entries).toEqual([expect.objectContaining({
      outcome: 'success',
      sourcePath,
      targetPath,
      uuid: VALID_UUID
    })]);
    await expect(readFile(result.journalPath, 'utf8')).resolves.toContain(`"uuid": "${VALID_UUID}"`);
  });

  it('stops before overwriting an existing UUID-named marker', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const folderPath = path.join(rootPath, 'Projects', 'Alpha');
    const sourcePath = await writeLegacyMarker(folderPath, VALID_UUID);
    const targetPath = await writeUuidNamedMarker(folderPath, VALID_UUID);

    const result = await executeMarkerMigrationPlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [{
        externalFolder: 'Projects/Alpha',
        kind: 'rename',
        sourcePath,
        targetPath,
        uuid: VALID_UUID
      }])
    });

    expect(result.succeeded).toBe(false);
    expect(result.journal.entries).toHaveLength(1);
    expect(result.journal.entries[0]).toEqual(expect.objectContaining({
      message: `Target marker already exists: ${targetPath}`,
      outcome: 'failure',
      uuid: VALID_UUID
    }));
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(`${VALID_UUID}\n`);
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(`${VALID_UUID}\n`);
  });

  it('fails closed when the live legacy marker UUID differs from the plan', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const folderPath = path.join(rootPath, 'Projects', 'Alpha');
    const sourcePath = await writeLegacyMarker(folderPath, OTHER_UUID);
    const targetPath = path.join(folderPath, buildExnfMarkerFileName(VALID_UUID));

    const result = await executeMarkerMigrationPlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [{
        externalFolder: 'Projects/Alpha',
        kind: 'rename',
        sourcePath,
        targetPath,
        uuid: VALID_UUID
      }])
    });

    expect(result.succeeded).toBe(false);
    expect(result.journal.entries[0]).toEqual(expect.objectContaining({
      message: `Source marker UUID ${OTHER_UUID} does not match expected UUID ${VALID_UUID}.`,
      outcome: 'failure',
      uuid: VALID_UUID
    }));
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(`${OTHER_UUID}\n`);
  });

  it('fails closed when another UUID-named marker already exists in the folder', async () => {
    const rootPath = await createTempRoot(tempDirectories);
    const folderPath = path.join(rootPath, 'Projects', 'Alpha');
    const sourcePath = await writeLegacyMarker(folderPath, VALID_UUID);
    await writeUuidNamedMarker(folderPath, OTHER_UUID);
    const targetPath = path.join(folderPath, buildExnfMarkerFileName(VALID_UUID));

    const result = await executeMarkerMigrationPlan({
      journalRootPath: path.join(rootPath, 'journal'),
      plan: buildPlan(rootPath, [{
        externalFolder: 'Projects/Alpha',
        kind: 'rename',
        sourcePath,
        targetPath,
        uuid: VALID_UUID
      }])
    });

    expect(result.succeeded).toBe(false);
    expect(result.journal.entries[0]).toEqual(expect.objectContaining({
      message: `Conflicting UUID-named marker already exists: ${path.join(folderPath, buildExnfMarkerFileName(OTHER_UUID))}`,
      outcome: 'failure',
      uuid: VALID_UUID
    }));
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(`${VALID_UUID}\n`);
  });
});

function buildPlan(rootPath: string, rows: MarkerMigrationPlan['rows']): MarkerMigrationPlan {
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

async function writeLegacyMarker(folderPath: string, uuid: string): Promise<string> {
  await mkdir(folderPath, { recursive: true });
  const markerPath = path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME);
  await writeFile(markerPath, `${uuid}\n`, 'utf8');
  return markerPath;
}

async function writeUuidNamedMarker(folderPath: string, uuid: string): Promise<string> {
  await mkdir(folderPath, { recursive: true });
  const markerPath = path.join(folderPath, buildExnfMarkerFileName(uuid));
  await writeFile(markerPath, `${uuid}\n`, 'utf8');
  return markerPath;
}
