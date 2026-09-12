import {
  mkdir,
  mkdtemp,
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

import { buildExnfMarkerFileName } from '../core/marker.ts';
import {
  assertSetupMarkerWriteReady,
  createSetupTargetExclusively,
  inspectSetupTarget
} from './setupTarget.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('setup target inspection', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it('classifies missing, unmarked, and imported-marker targets', async () => {
    const root = await tempRoot();
    await expect(inspectSetupTarget({ externalRootPath: root, ignorePatterns: [], notePath: 'Alpha.md' }))
      .resolves.toMatchObject({ targetKind: 'missing', targetMarkerUuids: [] });
    await mkdir(path.join(root, 'Alpha'));
    await expect(inspectSetupTarget({ externalRootPath: root, ignorePatterns: [], notePath: 'Alpha.md' }))
      .resolves.toMatchObject({ targetKind: 'directory', targetMarkerUuids: [] });
    await writeFile(path.join(root, 'Alpha', buildExnfMarkerFileName(UUID)), 'content is ignored');
    await expect(inspectSetupTarget({ externalRootPath: root, ignorePatterns: [], notePath: 'Alpha.md' }))
      .resolves.toMatchObject({ targetMarkerUuids: [UUID] });
  });

  it('finds ancestor and descendant marker overlap', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'Parent', 'Alpha', 'Child'), { recursive: true });
    await writeFile(path.join(root, 'Parent', buildExnfMarkerFileName(UUID)), 'ignored');
    await writeFile(path.join(root, 'Parent', 'Alpha', 'Child', buildExnfMarkerFileName(UUID)), 'ignored');
    const inspection = await inspectSetupTarget({ externalRootPath: root, ignorePatterns: [], notePath: 'Parent/Alpha.md' });
    expect(inspection.ancestorMarkerPaths).toHaveLength(1);
    expect(inspection.descendantMarkerPaths).toHaveLength(1);
  });

  it('ignores canonical contents but strictly validates legacy marker contents', async () => {
    const root = await tempRoot();
    const targetPath = path.join(root, 'Alpha');
    await mkdir(targetPath);
    await writeFile(path.join(targetPath, buildExnfMarkerFileName(UUID)), Buffer.from([0, 255, 10, 13]));
    await expect(inspectSetupTarget({ externalRootPath: root, ignorePatterns: [], notePath: 'Alpha.md' }))
      .resolves.toMatchObject({ errors: [], targetMarkerUuids: [UUID] });

    await rm(path.join(targetPath, buildExnfMarkerFileName(UUID)));
    await writeFile(path.join(targetPath, '.exnf'), 'not-a-uuid\nextra');
    const legacyInspection = await inspectSetupTarget({ externalRootPath: root, ignorePatterns: [], notePath: 'Alpha.md' });
    expect(legacyInspection.errors).toHaveLength(1);
    expect(legacyInspection.errors[0]).toContain('Malformed marker');
  });

  it('reports ignored descendants as unchecked without treating them as skipped', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'Alpha', 'ignored'), { recursive: true });
    const inspection = await inspectSetupTarget({
      externalRootPath: root,
      ignorePatterns: ['ignored/'],
      notePath: 'Alpha.md'
    });
    expect(inspection.errors).toEqual([]);
    expect(inspection.ignoredDirectories).toEqual([path.join(root, 'Alpha', 'ignored')]);
    expect(inspection.skippedDirectories).toEqual([]);
  });

  it('creates only an absent final target, permits empty resume, and detects pre-marker payload races', async () => {
    const root = await tempRoot();
    const targetPath = path.join(root, 'Parent', 'Alpha');
    await createSetupTargetExclusively(root, targetPath);
    await expect(createSetupTargetExclusively(root, targetPath)).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(createSetupTargetExclusively(root, targetPath, true)).resolves.toBeUndefined();
    await assertSetupMarkerWriteReady({ allowPayload: false, targetPath, uuid: UUID });
    await writeFile(path.join(targetPath, 'arrived.txt'), 'payload');
    await expect(assertSetupMarkerWriteReady({ allowPayload: false, targetPath, uuid: UUID }))
      .rejects.toThrow('gained content');
    await expect(assertSetupMarkerWriteReady({ allowPayload: true, targetPath, uuid: UUID })).resolves.toBeUndefined();
  });

  it('creates a root-level expected folder', async () => {
    const root = await tempRoot();
    const targetPath = path.join(root, 'Alpha');
    await expect(createSetupTargetExclusively(root, targetPath)).resolves.toBeUndefined();
    await expect(assertSetupMarkerWriteReady({ allowPayload: false, targetPath, uuid: UUID })).resolves.toBeUndefined();
  });

  function tempRoot(): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), 'exnf-setup-target-')).then((directory) => {
      temporaryDirectories.push(directory);
      return directory;
    });
  }
});
