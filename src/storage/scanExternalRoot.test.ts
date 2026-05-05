import {
  mkdir,
  mkdtemp,
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
import { scanExternalRoot } from './scanExternalRoot.ts';

const OTHER_UUID = '123e4567-e89b-42d3-a456-426614174001';
const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('external root scanning', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    const directoriesToRemove = tempDirectories.splice(0);
    await Promise.all(directoriesToRemove.map(async (directoryPath) => {
      await rm(directoryPath, { force: true, recursive: true });
    }));
  });

  it('reports an unconfigured external root as an access error', async () => {
    const result = await scanExternalRoot(' ');

    expect(result.accessErrors).toEqual([
      {
        location: '(settings)',
        message: 'External root is not configured.'
      }
    ]);
  });

  it('requires an absolute external root path', async () => {
    const result = await scanExternalRoot('relative/path');

    expect(result.accessErrors).toEqual([
      {
        location: 'relative/path',
        message: 'External root must be an absolute path.'
      }
    ]);
  });

  it('discovers valid marker bindings recursively', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const folderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await writeMarker(folderPath, VALID_UUID);

    const result = await scanExternalRoot(externalRootPath);

    expect(result.accessErrors).toEqual([]);
    expect(result.bindings).toEqual(new Map([[VALID_UUID, folderPath]]));
  });

  it('reports duplicate marker UUIDs', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const firstFolderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    const secondFolderPath = path.join(externalRootPath, 'Archive', 'Alpha');
    await writeMarker(firstFolderPath, VALID_UUID);
    await writeMarker(secondFolderPath, VALID_UUID);

    const result = await scanExternalRoot(externalRootPath);

    expect(result.duplicatePaths).toEqual(
      new Map([[
        VALID_UUID,
        [secondFolderPath, firstFolderPath].sort()
      ]])
    );
  });

  it('reports malformed markers', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const folderPath = path.join(externalRootPath, 'Projects', 'Alpha');
    await writeMarker(folderPath, OTHER_UUID.toUpperCase());

    const result = await scanExternalRoot(externalRootPath);

    expect(result.malformedMarkers).toEqual([
      {
        location: path.join(folderPath, EXNF_MARKER_FILE_NAME),
        message: 'Marker must contain a canonical lowercase UUID.'
      }
    ]);
  });

  it('does not traverse symlinked directories', async () => {
    const externalRootPath = await createTempRoot(tempDirectories);
    const linkedRootPath = await createTempRoot(tempDirectories);
    const linkedFolderPath = path.join(linkedRootPath, 'Linked');
    const linkPath = path.join(externalRootPath, 'Link');
    await writeMarker(linkedFolderPath, VALID_UUID);

    try {
      await symlink(linkedRootPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error: unknown) {
      if (isUnsupportedSymlinkError(error)) {
        return;
      }

      throw error;
    }

    const result = await scanExternalRoot(externalRootPath);

    expect(result.bindings).toEqual(new Map());
  });
});

async function createTempRoot(tempDirectories: string[]): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'external-note-folders-'));
  tempDirectories.push(directoryPath);
  return directoryPath;
}

function isUnsupportedSymlinkError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'EPERM' || error.code === 'EACCES')
  );
}

async function writeMarker(folderPath: string, uuid: string): Promise<void> {
  await mkdir(folderPath, { recursive: true });
  await writeFile(path.join(folderPath, EXNF_MARKER_FILE_NAME), `${uuid}\n`, 'utf8');
}
