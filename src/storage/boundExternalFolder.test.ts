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

import { EXNF_MARKER_FILE_NAME } from '../core/contracts.ts';
import {
  ensureExpectedBoundExternalFolder,
  inspectExpectedExternalFolder,
  writeExpectedMarkerIfMissingOrMatching,
  writeExpectedMarkerIfUnmarked
} from './boundExternalFolder.ts';

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

    const result = await ensureExpectedBoundExternalFolder({
      createIfMissing: true,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      created: true,
      folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
      kind: 'bound'
    });
    expect(await readFile(path.join(result.folderPath, EXNF_MARKER_FILE_NAME), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('requires a configured absolute external root', async () => {
    await expect(ensureExpectedBoundExternalFolder({
      createIfMissing: true,
      externalRootPath: ' ',
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('External root is not configured');

    await expect(ensureExpectedBoundExternalFolder({
      createIfMissing: true,
      externalRootPath: 'relative/path',
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('External root must be an absolute path');
  });

  it('rejects occupied target paths', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    await mkdir(path.join(externalRootPath, 'Projects', 'Alpha'), { recursive: true });

    await expect(ensureExpectedBoundExternalFolder({
      createIfMissing: true,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('already occupied');
  });

  it('fails closed when a derived path cannot be safely inspected', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    await writeFile(path.join(externalRootPath, 'Projects'), '', 'utf8');

    await expect(ensureExpectedBoundExternalFolder({
      createIfMissing: true,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow();
  });

  it('rejects occupied expected folders with conflicting marker files', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), `${OTHER_UUID}\n`, 'utf8');

    await expect(ensureExpectedBoundExternalFolder({
      createIfMissing: true,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('already bound');
  });

  it('creates folder-note targets at the parent folder path', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);

    const result = await ensureExpectedBoundExternalFolder({
      createIfMissing: true,
      externalRootPath,
      notePath: '0_unsorted/2025-08-04_wood storage cart/2025-08-04_wood storage cart.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      created: true,
      folderPath: path.join(externalRootPath, '0_unsorted', '2025-08-04_wood storage cart'),
      kind: 'bound'
    });
    expect(await readFile(path.join(result.folderPath, EXNF_MARKER_FILE_NAME), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('reports a missing expected folder without creating it when requested', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);

    const result = await ensureExpectedBoundExternalFolder({
      createIfMissing: false,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
      kind: 'missing'
    });
  });

  it('returns the expected folder when its marker matches', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), `${VALID_UUID}\n`, 'utf8');

    const result = await ensureExpectedBoundExternalFolder({
      createIfMissing: false,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      created: false,
      folderPath: targetFolderPath,
      kind: 'bound'
    });
  });

  it('inspects existing unmarked expected folders without mutating them', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });

    const result = await inspectExpectedExternalFolder({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      folderPath: targetFolderPath,
      kind: 'unmarked'
    });
  });

  it('writes a marker into an expected folder only after revalidating it is still unmarked', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });

    const result = await writeExpectedMarkerIfUnmarked({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      folderPath: targetFolderPath,
      markerWritten: true
    });
    expect(await readFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('does not overwrite a marker that appears before confirm-time adoption', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), `${OTHER_UUID}\n`, 'utf8');

    await expect(writeExpectedMarkerIfUnmarked({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow(OTHER_UUID);
    expect(await readFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), 'utf8')).toBe(
      `${OTHER_UUID}\n`
    );
  });

  it('blocks when any marker appears before confirm-time adoption', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), `${VALID_UUID}\n`, 'utf8');

    await expect(writeExpectedMarkerIfUnmarked({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('already marked');
  });

  it('treats matching markers as successful idempotent adoption writes', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), `${VALID_UUID}\n`, 'utf8');

    const result = await writeExpectedMarkerIfMissingOrMatching({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      folderPath: targetFolderPath,
      markerWritten: false
    });
    expect(await readFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('rejects existing expected folders below symlinked parent directories', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const symlinkTargetPath = await createTempRoot(tempDirectories);
    const linkedParentPath = path.join(externalRootPath, 'Projects');
    const targetFolderPath = path.join(symlinkTargetPath, 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), `${VALID_UUID}\n`, 'utf8');
    await symlink(symlinkTargetPath, linkedParentPath, 'junction');

    await expect(ensureExpectedBoundExternalFolder({
      createIfMissing: false,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('symbolic link');
  });

  it('rejects an expected folder bound to another uuid', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_MARKER_FILE_NAME), `${OTHER_UUID}\n`, 'utf8');

    await expect(ensureExpectedBoundExternalFolder({
      createIfMissing: false,
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('already bound');
  });
});

async function createTempRoot(tempDirectories: string[]): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'external-note-folders-'));
  tempDirectories.push(directoryPath);
  return directoryPath;
}
