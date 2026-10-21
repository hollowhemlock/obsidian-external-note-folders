import type { Dirent } from 'node:fs';

import {
  mkdir,
  mkdtemp,
  readdir,
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
  it,
  vi
} from 'vitest';

import { inspectExpectedExternalFolder } from './boundExternalFolder.ts';
import { assertSetupMarkerWriteReady } from './setupTarget.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const INVALID_NAME_MESSAGE = 'Marker filename must be <canonical lowercase UUID>.exnf.';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, readdir: vi.fn(original.readdir), readFile: vi.fn(original.readFile) };
});

describe('marker entry workflow policies', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.resetAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it.each([
    ['.exnf', 'Marker path is not a regular file.'],
    [`${UUID}.exnf`, 'Marker path is not a regular file.'],
    ['invalid.exnf', INVALID_NAME_MESSAGE]
  ])('rejects the %s directory during setup but skips it during bound inspection', async (name, message) => {
    const { root, target } = await createTarget();
    await mkdir(path.join(target, name));

    await expect(assertSetupMarkerWriteReady({ allowPayload: true, targetPath: target, uuid: UUID }))
      .rejects.toThrow(`Malformed marker at ${path.join(target, name)}: ${message}`);
    await expect(inspectExpectedExternalFolder({ externalRootPath: root, notePath: 'Alpha.md', uuid: UUID }))
      .resolves.toEqual({ folderPath: target, kind: 'unmarked' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('accumulates setup errors in entry order but stops bound inspection before reading later entries', async () => {
    const { root, target } = await createTarget();
    const names = ['z-invalid.exnf', 'a-invalid.exnf', '.exnf'];
    await Promise.all(names.map((name) => writeFile(path.join(target, name), UUID)));
    const entries = await readdir(target, { encoding: 'utf8', withFileTypes: true });
    const orderedEntries = names.map((name) => entries.find((entry) => entry.name === name)!);
    const readEntries: (directory: string, options: { encoding: 'utf8'; withFileTypes: true }) => Promise<Dirent[]> = readdir;
    vi.mocked(readEntries).mockResolvedValueOnce(orderedEntries);
    vi.mocked(readFile).mockRejectedValueOnce(new Error('legacy read failed'));

    await expect(assertSetupMarkerWriteReady({ allowPayload: true, targetPath: target, uuid: UUID }))
      .rejects.toThrow([
        `Malformed marker at ${path.join(target, names[0]!)}: ${INVALID_NAME_MESSAGE}`,
        `Malformed marker at ${path.join(target, names[1]!)}: ${INVALID_NAME_MESSAGE}`,
        `Malformed marker at ${path.join(target, '.exnf')}: legacy read failed`
      ].join(' '));
    expect(readFile).toHaveBeenCalledExactlyOnceWith(path.join(target, '.exnf'), 'utf8');

    vi.mocked(readFile).mockClear();
    vi.mocked(readEntries).mockResolvedValueOnce(orderedEntries);
    await expect(inspectExpectedExternalFolder({ externalRootPath: root, notePath: 'Alpha.md', uuid: UUID }))
      .resolves.toEqual({
        folderPath: target,
        kind: 'malformed-marker',
        markerPath: path.join(target, names[0]!),
        message: INVALID_NAME_MESSAGE
      });
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    { boundMessage: 'access denied', error: new Error('access denied'), setupMessage: 'access denied' },
    { boundMessage: 'string rejection', error: 'string rejection', setupMessage: 'Unknown filesystem error.' },
    { boundMessage: 'Unable to open external folder.', error: { code: 'EACCES' }, setupMessage: 'Unknown filesystem error.' }
  ])('preserves error normalization for $setupMessage / $boundMessage', async ({ boundMessage, error, setupMessage }) => {
    const { root, target } = await createTarget();
    const markerPath = path.join(target, '.exnf');
    await writeFile(markerPath, UUID);
    vi.mocked(readFile).mockRejectedValueOnce(error);

    await expect(assertSetupMarkerWriteReady({ allowPayload: true, targetPath: target, uuid: UUID }))
      .rejects.toThrow(`Malformed marker at ${markerPath}: ${setupMessage}`);

    vi.mocked(readFile).mockRejectedValueOnce(error);
    await expect(inspectExpectedExternalFolder({ externalRootPath: root, notePath: 'Alpha.md', uuid: UUID }))
      .resolves.toEqual({ folderPath: target, kind: 'malformed-marker', markerPath, message: boundMessage });
  });

  it('reads only legacy contents in both workflows, ignoring canonical contents and non-marker entries', async () => {
    const { root, target } = await createTarget();
    await Promise.all([
      writeFile(path.join(target, '.exnf'), `${UUID}\n`),
      writeFile(path.join(target, `${UUID}.exnf`), Buffer.from([0, 255, 13])),
      writeFile(path.join(target, 'ignored.EXNF'), 'invalid'),
      mkdir(path.join(target, 'payload'))
    ]);

    await expect(assertSetupMarkerWriteReady({ allowPayload: false, targetPath: target, uuid: UUID })).resolves.toBeUndefined();
    expect(readFile).toHaveBeenCalledExactlyOnceWith(path.join(target, '.exnf'), 'utf8');
    vi.mocked(readFile).mockClear();
    await expect(inspectExpectedExternalFolder({ externalRootPath: root, notePath: 'Alpha.md', uuid: UUID }))
      .resolves.toEqual({ folderPath: target, kind: 'bound' });
    expect(readFile).toHaveBeenCalledExactlyOnceWith(path.join(target, '.exnf'), 'utf8');
  });

  async function createTarget(): Promise<{ root: string; target: string }> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-marker-entry-'));
    temporaryDirectories.push(root);
    const target = path.join(root, 'Alpha');
    await mkdir(target);
    return { root, target };
  }
});
