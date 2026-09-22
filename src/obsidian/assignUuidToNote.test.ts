import type {
  App,
  TFile
} from 'obsidian';

import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { assignUuidToNote } from './assignUuidToNote.ts';

const EXISTING_UUID = '123e4567-e89b-42d3-a456-426614174000';
const NEW_UUID = '223e4567-e89b-42d3-a456-426614174000';

describe('assign UUID to note', () => {
  it('retries a vault UUID collision without consulting external state', async () => {
    const frontmatter: Record<string, unknown> = {};
    const generateUuid = vi.fn()
      .mockReturnValueOnce(EXISTING_UUID)
      .mockReturnValueOnce(NEW_UUID);

    await expect(assignUuidToNote(appFor(frontmatter), file(), {
      existingUuids: new Set([EXISTING_UUID]),
      generateUuid
    })).resolves.toEqual({ kind: 'assigned', uuid: NEW_UUID });
    expect(frontmatter['exnf']).toBe(NEW_UUID);
    expect(generateUuid).toHaveBeenCalledTimes(2);
  });

  it('returns an existing identity and blocks invalid frontmatter', async () => {
    await expect(assignUuidToNote(appFor({ exnf: EXISTING_UUID }), file()))
      .resolves.toEqual({ kind: 'existing', uuid: EXISTING_UUID });
    await expect(assignUuidToNote(appFor({ exnf: 'not-a-uuid' }), file()))
      .rejects.toThrow('Cannot assign UUID because exnf frontmatter');
  });
});

function appFor(frontmatter: Record<string, unknown>): App {
  return {
    fileManager: {
      processFrontMatter: async (_file: TFile, update: (value: Record<string, unknown>) => void): Promise<void> => {
        update(frontmatter);
      }
    }
  } as unknown as App;
}

function file(): TFile {
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- This adapter unit test only needs the stable path field.
  return { path: 'Alpha.md' } as TFile;
}
