import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { NoteResult } from './auditScan.ts';

import { AdoptionNoteCache } from './adoptionNoteCache.ts';
import { scanAdoptionAudit } from './auditScan.ts';

describe('bounded audit note reads', () => {
  it('rereads all notes, reuses exact parses, and preserves deterministic duplicate ownership', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-read-queue-'));
    try {
      const vault = path.join(root, 'vault');
      const external = path.join(root, 'external');
      await mkdir(vault);
      await mkdir(external);
      const uuid = 'd03a808c-92b4-47be-825a-13fa489a11dc';
      for (let index = 0; index < 24; index++) {
        await writeFile(path.join(vault, `${String(index).padStart(2, '0')}.md`), `---\nexnf: ${uuid}\n---\n`);
      }
      const cache = new AdoptionNoteCache<NoteResult>();
      const first = await scanAdoptionAudit(vault, external, { noteCache: cache });
      const second = await scanAdoptionAudit(vault, external, { noteCache: cache });
      expect(first.work).toMatchObject({ maxConcurrentReads: 8, notesParsed: 24, notesRead: 24 });
      expect(second.work).toMatchObject({ notesParsed: 0, notesRead: 24 });
      expect(second.notes).toEqual(first.notes);
      expect(second.vault.duplicatePaths).toEqual(first.vault.duplicatePaths);
      await writeFile(path.join(vault, '00.md'), 'Removed identifier');
      const third = await scanAdoptionAudit(vault, external, { noteCache: cache });
      expect(third.work).toMatchObject({ notesParsed: 1, notesRead: 24 });
      expect(third.notes[0]?.uuid).toBe('');
      const controller = new AbortController();
      controller.abort();
      await expect(scanAdoptionAudit(vault, external, { signal: controller.signal })).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
