import {
  mkdtemp,
  rm,
  unlink,
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

import type { AdoptionJournal } from './adoptionExecutor.ts';
import type { GroupAdoptionJournal } from './groupAdoptionJournal.ts';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildGroupAdoptionPlan } from '../core/groupAdoption.ts';
import { listIncompleteAdoptionJournals } from './adoptionExecutor.ts';
import { pendingGroupJournals } from './groupAdoptionJournal.ts';
import {
  assertNoPendingBulkAdoption,
  assertNoPendingGroupAdoption
} from './pendingReservations.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
const FINISHED = '2026-10-12T12:00:00Z';
const TARGET = path.resolve('external/target');
const OTHER = path.resolve('external/other');
const GROUP_MESSAGE = 'Another pending adoption overlaps this operation';

describe('pending reservation rereads', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it('rereads group paths without reconsidering completion after listing', async () => {
    const root = await tempRoot();
    const file = path.join(root, 'group.json');
    const journal = groupJournal(OTHER);
    await writeFile(file, JSON.stringify(journal));
    const pending = await pendingGroupJournals(root);
    journal.plan.expectedFolder = TARGET;
    journal.stage = 'complete';
    await writeFile(file, JSON.stringify(journal));

    await expect(assertNoPendingGroupAdoption([TARGET], pending, GROUP_MESSAGE)).rejects.toThrow(`${GROUP_MESSAGE}: ${file}`);
  });

  it('excludes the own group journal before rereading it', async () => {
    const root = await tempRoot();
    const file = path.join(root, 'own.json');
    await writeFile(file, JSON.stringify(groupJournal(TARGET)));
    const pending = await pendingGroupJournals(root);
    await unlink(file);

    await expect(assertNoPendingGroupAdoption([TARGET], pending, GROUP_MESSAGE, file)).resolves.toBeUndefined();
    await expect(assertNoPendingGroupAdoption([TARGET], pending, GROUP_MESSAGE)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports the first group overlap before a later journal becomes unreadable', async () => {
    const root = await tempRoot();
    const first = path.join(root, 'a.json');
    const later = path.join(root, 'b.json');
    await writeFile(first, JSON.stringify(groupJournal(TARGET)));
    await writeFile(later, JSON.stringify(groupJournal(OTHER)));
    const pending = await pendingGroupJournals(root);
    expect(pending).toEqual([first, later]);
    await unlink(later);

    await expect(assertNoPendingGroupAdoption([TARGET], pending, GROUP_MESSAGE)).rejects.toThrow(`${GROUP_MESSAGE}: ${first}`);
    await expect(assertNoPendingGroupAdoption([TARGET], [...pending].reverse(), GROUP_MESSAGE)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases bulk rows completed between listing and checking', async () => {
    const root = await tempRoot();
    const file = path.join(root, 'bulk.json');
    const journal = bulkJournal(TARGET);
    await writeFile(file, JSON.stringify(journal));
    const pending = await listIncompleteAdoptionJournals(root);
    journal.entries[0]!.completedAt = FINISHED;
    await writeFile(file, JSON.stringify(journal));

    await expect(assertNoPendingBulkAdoption(TARGET, pending)).resolves.toBeUndefined();
  });

  it('rereads bulk rows without reconsidering journal completion after listing', async () => {
    const root = await tempRoot();
    const file = path.join(root, 'bulk.json');
    const journal = bulkJournal(OTHER);
    await writeFile(file, JSON.stringify(journal));
    const pending = await listIncompleteAdoptionJournals(root);
    journal.completedAt = FINISHED;
    journal.entries.push(...bulkJournal(TARGET).entries);
    await writeFile(file, JSON.stringify(journal));

    await expect(assertNoPendingBulkAdoption(TARGET, pending)).rejects.toThrow(`Review pending bulk adoption: ${file}`);
  });

  it('reports the first bulk overlap before a later journal becomes unreadable', async () => {
    const root = await tempRoot();
    const first = path.join(root, 'a.json');
    const later = path.join(root, 'b.json');
    await writeFile(first, JSON.stringify(bulkJournal(TARGET)));
    await writeFile(later, JSON.stringify({ ...bulkJournal(OTHER), startedAt: FINISHED }));
    const pending = await listIncompleteAdoptionJournals(root);
    expect(pending.map((journal) => journal.journalPath)).toEqual([first, later]);
    await unlink(later);

    await expect(assertNoPendingBulkAdoption(TARGET, pending)).rejects.toThrow(`Review pending bulk adoption: ${first}`);
    await expect(assertNoPendingBulkAdoption(TARGET, [...pending].reverse())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-pending-reservations-'));
    roots.push(root);
    return root;
  }
});

function bulkJournal(folderPath: string): AdoptionJournal {
  return {
    completedAt: null,
    entries: [{
      completedAt: null,
      externalFolder: path.basename(folderPath),
      folderPath,
      message: null,
      notePath: 'Note.md',
      outcome: 'pending',
      stage: 'pending',
      startedAt: null,
      uuid: UUID
    }],
    externalRootPath: path.dirname(folderPath),
    kind: 'external-folder-adoption',
    runId: UUID,
    schemaVersion: 1,
    startedAt: '2026-10-12T11:00:00Z'
  };
}

function groupJournal(folderPath: string): GroupAdoptionJournal {
  const snapshot = auditFixture(1);
  const plan = buildGroupAdoptionPlan({
    folderPath: snapshot.folders[0]!,
    ignorePatterns: [],
    move: false,
    mutationSequence: 0,
    note: null,
    snapshot,
    uuid: UUID
  });
  return {
    attempted: false,
    error: '',
    kind: 'group-adoption',
    plan: { ...plan, expectedFolder: folderPath, folderPath },
    preparedContent: null,
    schemaVersion: 1,
    sourceContent: null,
    stage: 'marker'
  };
}
