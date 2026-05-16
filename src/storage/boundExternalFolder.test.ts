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

import { EXNF_LEGACY_MARKER_FILE_NAME } from '../core/contracts.ts';
import { buildExnfMarkerFileName } from '../core/marker.ts';
import {
  assertExpectedMarkerMatches,
  ensureExpectedBoundExternalFolder,
  inspectExpectedExternalFolder,
  writeExpectedMarkerIfMissingOrMatching,
  writeExpectedMarkerIfUnmarked,
  writeMarkerToExistingUnmarkedFolder
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
    expect(await readFile(markerPath(result.folderPath), 'utf8')).toBe(
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
    await writeFile(markerPath(targetFolderPath, OTHER_UUID), `${OTHER_UUID}\n`, 'utf8');

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
    expect(await readFile(markerPath(result.folderPath), 'utf8')).toBe(
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
    await writeFile(markerPath(targetFolderPath), `${VALID_UUID}\n`, 'utf8');

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

  it('blocks expected folders with conflicting legacy and UUID-named markers', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(path.join(targetFolderPath, EXNF_LEGACY_MARKER_FILE_NAME), `${VALID_UUID}\n`, 'utf8');
    await writeFile(markerPath(targetFolderPath, OTHER_UUID), `${OTHER_UUID}\n`, 'utf8');

    const result = await inspectExpectedExternalFolder({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      folderPath: targetFolderPath,
      kind: 'malformed-marker',
      markerPath: path.join(targetFolderPath, EXNF_LEGACY_MARKER_FILE_NAME),
      message: `Legacy marker UUID ${VALID_UUID} conflicts with UUID-named marker(s): ${OTHER_UUID}.`
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

  it('reports missing markers clearly when asserting a completed adoption entry', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });

    await expect(assertExpectedMarkerMatches({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow('marker is missing');
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
    expect(await readFile(markerPath(targetFolderPath), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('does not overwrite a marker that appears before confirm-time adoption', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(markerPath(targetFolderPath, OTHER_UUID), `${OTHER_UUID}\n`, 'utf8');

    await expect(writeExpectedMarkerIfUnmarked({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    })).rejects.toThrow(OTHER_UUID);
    expect(await readFile(markerPath(targetFolderPath, OTHER_UUID), 'utf8')).toBe(
      `${OTHER_UUID}\n`
    );
  });

  it('blocks when any marker appears before confirm-time adoption', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const targetFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(markerPath(targetFolderPath), `${VALID_UUID}\n`, 'utf8');

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
    await writeFile(markerPath(targetFolderPath), `${VALID_UUID}\n`, 'utf8');

    const result = await writeExpectedMarkerIfMissingOrMatching({
      externalRootPath,
      notePath: 'Projects/Alpha.md',
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      folderPath: targetFolderPath,
      markerWritten: false
    });
    expect(await readFile(markerPath(targetFolderPath), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('writes a marker into a selected unmarked folder without deriving from note path', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const selectedFolderPath = path.join(externalRootPath, 'Archive', 'Alpha');
    await mkdir(selectedFolderPath, { recursive: true });

    const result = await writeMarkerToExistingUnmarkedFolder({
      externalRootPath,
      folderPath: selectedFolderPath,
      uuid: VALID_UUID
    });

    expect(result).toEqual({
      folderPath: selectedFolderPath,
      markerWritten: true
    });
    expect(await readFile(markerPath(selectedFolderPath), 'utf8')).toBe(
      `${VALID_UUID}\n`
    );
  });

  it('does not overwrite a selected folder marker that appears before confirmation', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const selectedFolderPath = path.join(externalRootPath, 'Archive', 'Alpha');
    await mkdir(selectedFolderPath, { recursive: true });
    await writeFile(markerPath(selectedFolderPath, OTHER_UUID), `${OTHER_UUID}\n`, 'utf8');

    await expect(writeMarkerToExistingUnmarkedFolder({
      externalRootPath,
      folderPath: selectedFolderPath,
      uuid: VALID_UUID
    })).rejects.toThrow('already marked');
  });

  it('reports selected folders outside the root without calling them derived paths', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const selectedFolderPath = await createTempRoot(tempDirectories);

    await expect(writeMarkerToExistingUnmarkedFolder({
      externalRootPath,
      folderPath: selectedFolderPath,
      uuid: VALID_UUID
    })).rejects.toThrow('Selected external folder path escapes the configured root');
  });

  it('rejects existing expected folders below symlinked parent directories', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const symlinkTargetPath = await createTempRoot(tempDirectories);
    const linkedParentPath = path.join(externalRootPath, 'Projects');
    const targetFolderPath = path.join(symlinkTargetPath, 'Alpha');
    await mkdir(targetFolderPath, { recursive: true });
    await writeFile(markerPath(targetFolderPath), `${VALID_UUID}\n`, 'utf8');
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
    await writeFile(markerPath(targetFolderPath, OTHER_UUID), `${OTHER_UUID}\n`, 'utf8');

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

function markerPath(folderPath: string, uuid = VALID_UUID): string {
  return path.join(folderPath, buildExnfMarkerFileName(uuid));
}
