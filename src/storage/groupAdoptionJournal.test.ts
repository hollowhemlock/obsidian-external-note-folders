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
  it,
  vi
} from 'vitest';

import type {
  GroupAdoptionJournal,
  GroupAdoptionStage
} from './groupAdoptionJournal.ts';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildGroupAdoptionPlan } from '../core/groupAdoption.ts';
import {
  createGroupJournal,
  inspectGroupMarker,
  pendingGroupJournals,
  readGroupJournal,
  runGroupJournal,
  saveGroupJournal
} from './groupAdoptionJournal.ts';

function journal(): GroupAdoptionJournal {
  const snapshot = auditFixture(1);
  const plan = buildGroupAdoptionPlan({
    folderPath: snapshot.folders[0]!,
    ignorePatterns: [],
    move: false,
    mutationSequence: 0,
    note: null,
    snapshot,
    uuid: '11111111-1111-4111-8111-111111111111'
  });
  return { attempted: false, error: '', kind: 'group-adoption', plan, preparedContent: null, schemaVersion: 1, sourceContent: null, stage: 'marker' };
}
describe('group adoption recovery', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
  });
  it('persists pending journals independently of report membership and rejects invalid records', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-group-journal-'));
    roots.push(root);
    const initial = journal();
    const file = await createGroupJournal(root, initial.plan, 'Preserve original note');
    expect(await pendingGroupJournals(root)).toEqual([file]);
    const loaded = await readGroupJournal(file);
    expect(loaded.sourceContent).toBe('Preserve original note');
    loaded.stage = 'complete';
    await saveGroupJournal(file, loaded);
    expect(await pendingGroupJournals(root)).toEqual([]);
    await writeFile(file, '{"kind":"group-adoption","schemaVersion":99}');
    await expect(readGroupJournal(file)).rejects.toThrow('Invalid');
  });
  it('verifies markers without changing folder contents and detects ancestor evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-group-marker-'));
    roots.push(root);
    const folder = path.join(root, 'group');
    await mkdir(folder);
    const payload = path.join(folder, 'keep.txt');
    await writeFile(payload, 'unchanged');
    const uuid = journal().plan.uuid;
    expect(await inspectGroupMarker(root, folder, uuid)).toBe(false);
    await writeFile(path.join(folder, `${uuid}.exnf`), '');
    expect(await inspectGroupMarker(root, folder, uuid)).toBe(true);
    await writeFile(path.join(root, 'malformed.EXNF'), '');
    await expect(inspectGroupMarker(root, folder, uuid)).rejects.toThrow('Ancestor');
    expect(await readFile(payload, 'utf8')).toBe('unchanged');
  });
  it.each(['marker', 'note', 'move', 'verify'] as const)('persists intent and detects interruption after %s effects', async (failStage) => {
    const working = journal();
    let disk = structuredClone(working);
    const completed = new Set<string>();
    function effect(stage: string): () => Promise<void> {
      return async () => {
        completed.add(stage);
      };
    }
    const effects = { marker: vi.fn(effect('marker')), move: vi.fn(effect('move')), note: vi.fn(effect('note')), verify: vi.fn(effect('verify')) };
    const next: Record<string, GroupAdoptionStage> = { marker: 'note', move: 'verify', note: 'move', verify: 'complete' };
    await expect(runGroupJournal(working, effects, async () => {
      if (completed.has(failStage) && working.stage === next[failStage]) {
        throw new Error('disk failed after effect');
      }
      disk = structuredClone(working);
    })).rejects.toThrow('disk failed');
    expect(disk.stage).toBe(failStage);
    expect(disk.attempted).toBe(true);
    const resumed = structuredClone(disk);
    await runGroupJournal(resumed, effects, async () => {
      disk = structuredClone(resumed);
    });
    expect(disk.stage).toBe('complete');
    if (failStage === 'move') {
      expect(effects.move).toHaveBeenLastCalledWith(true);
    }
  });
  it('does not execute any effect if recording intent fails', async () => {
    const effect = vi.fn(async () => Promise.resolve());
    await expect(runGroupJournal(journal(), { marker: effect, move: effect, note: effect, verify: effect }, async () => {
      throw new Error('disk');
    })).rejects.toThrow('disk');
    expect(effect).not.toHaveBeenCalled();
  });
});
