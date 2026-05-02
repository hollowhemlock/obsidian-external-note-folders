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

import { EXF_MARKER_FILE_NAME } from '../core/contracts.ts';
import { ensureBoundExternalFolder } from './boundExternalFolder.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_UUID = '123e4567-e89b-42d3-a456-426614174001';

describe('bound external folder mutations', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    const directoriesToRemove = tempDirectories.splice(0);
    await Promise.all(directoriesToRemove.map(async (directoryPath) => {
      await rm(directoryPath, { force: true, recursive: true });
    }));
  });

  it('creates a derived folder and writes a marker', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);

    const result = await ensureBoundExternalFolder({
      existingBindings: new Map(),
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result.created).toBe(true);
    expect(result.folderPath).toBe(path.join(externalRootPath, 'Projects', 'Alpha'));
    expect(await readFile(path.join(result.folderPath, EXF_MARKER_FILE_NAME), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('returns the existing binding when the uuid is already bound', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const existingFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');

    const result = await ensureBoundExternalFolder({
      existingBindings: new Map([[VALID_UUID, existingFolderPath]]),
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      created: false,
      folderPath: existingFolderPath
    });
  });

  it('rejects occupied target paths', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    await mkdir(path.join(externalRootPath, 'Projects', 'Alpha'), { recursive: true });

    await expect(ensureBoundExternalFolder({
      existingBindings: new Map(),
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('already occupied');
  });

  it('fails closed when a derived path cannot be safely inspected', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    await writeFile(path.join(externalRootPath, 'Projects'), '', 'utf8');

    await expect(ensureBoundExternalFolder({
      existingBindings: new Map(),
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow();
  });

  it('rejects derived paths already bound to another uuid', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const existingFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');

    await expect(ensureBoundExternalFolder({
      existingBindings: new Map([[OTHER_UUID, existingFolderPath]]),
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('already bound');
  });

  it('rejects conflicting marker files', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXF_MARKER_FILE_NAME), `${OTHER_UUID}\n`, 'utf8');

    await expect(ensureBoundExternalFolder({
      existingBindings: new Map(),
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('already occupied');
  });
});

async function createTempRoot(tempDirectories: string[]): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'external-note-folders-'));
  tempDirectories.push(directoryPath);
  return directoryPath;
}
