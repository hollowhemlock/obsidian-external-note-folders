import {
  mkdtemp,
  readdir,
  rm
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

import type { SetupPlan } from '../core/setupPlan.ts';
import type { SetupExecutionOperations } from './setupExecutor.ts';

import {
  executeSetupPlan,
  listIncompleteSetupJournals,
  readSetupJournal,
  resumeSetupJournal
} from './setupExecutor.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('setup execution journal', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it('journals folder, marker, and frontmatter operations in order', async () => {
    const journalRootPath = await tempRoot();
    const calls: string[] = [];
    const result = await executeSetupPlan({
      journalRootPath,
      operations: {
        ...operations(calls),
        createFolder: vi.fn(async () => {
          expect(await readdir(journalRootPath)).toHaveLength(1);
          calls.push('folder');
        })
      },
      plan: plan('create-new')
    });
    expect(result.succeeded).toBe(true);
    expect(calls).toEqual(['folder', 'marker', 'note', 'complete']);
    const journal = await readSetupJournal(result.journalPath);
    expect(typeof journal.completedAt).toBe('string');
    expect(journal).toMatchObject({
      kind: 'external-folder-setup',
      stage: 'complete'
    });
  });

  it.each(
    [
      ['folder-create', 'createFolder'],
      ['marker-write', 'writeMarker'],
      ['frontmatter-write', 'writeNoteUuid']
    ] as const
  )('preserves the pre-action %s stage when that operation fails', async (stage, operation) => {
    const journalRootPath = await tempRoot();
    const baseOperations = operations([]);
    const result = await executeSetupPlan({
      journalRootPath,
      operations: {
        ...baseOperations,
        [operation]: vi.fn(async () => {
          throw new Error(`${stage} failed`);
        })
      },
      plan: plan(actionForStage(stage))
    });
    expect(result.succeeded).toBe(false);
    expect(result.journal).toMatchObject({ completedAt: null, outcome: 'failure', stage });
  });

  it('resumes with the journaled UUID after a frontmatter failure', async () => {
    const journalRootPath = await tempRoot();
    const first = await executeSetupPlan({
      journalRootPath,
      operations: {
        ...operations([]),
        writeNoteUuid: vi.fn(async () => {
          throw new Error('frontmatter failed');
        })
      },
      plan: plan('confirm-unmarked-adoption')
    });
    expect(first.succeeded).toBe(false);
    const calls: string[] = [];
    const resumed = await resumeSetupJournal({ journalPath: first.journalPath, operations: operations(calls) });
    expect(resumed.succeeded).toBe(true);
    expect(resumed.journal.uuid).toBe(first.journal.uuid);
    expect(calls).toEqual(['note', 'complete']);
    await expect(listIncompleteSetupJournals(journalRootPath)).resolves.toEqual([]);
  });

  it('does not return an incomplete journal belonging to another note', async () => {
    const journalRootPath = await tempRoot();
    await executeSetupPlan({
      journalRootPath,
      operations: {
        ...operations([]),
        writeNoteUuid: vi.fn(async () => {
          throw new Error('frontmatter failed');
        })
      },
      plan: plan('confirm-unmarked-adoption', 'Other.md')
    });
    await expect(listIncompleteSetupJournals(journalRootPath, 'Alpha.md')).resolves.toEqual([]);
  });

  function tempRoot(): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), 'exnf-setup-')).then((directory) => {
      temporaryDirectories.push(directory);
      return directory;
    });
  }
});

function actionForStage(stage: 'folder-create' | 'frontmatter-write' | 'marker-write'): SetupPlan['action'] {
  if (stage === 'folder-create') {
    return 'create-new';
  }
  if (stage === 'marker-write') {
    return 'confirm-unmarked-adoption';
  }
  return 'confirm-marker-restore';
}

function operations(calls: string[]): SetupExecutionOperations {
  return {
    assertComplete: vi.fn(async () => {
      calls.push('complete');
    }),
    createFolder: vi.fn(async () => {
      calls.push('folder');
    }),
    writeMarker: vi.fn(async () => {
      calls.push('marker');
    }),
    writeNoteUuid: vi.fn(async () => {
      calls.push('note');
    })
  };
}

function plan(action: SetupPlan['action'], notePath = 'Alpha.md'): SetupPlan {
  return {
    action,
    errors: [],
    externalRootPath: path.resolve('External'),
    ignoredDirectoryCount: 0,
    legacyMarkerPaths: [],
    mutationSequence: 0,
    notePath,
    targetPath: path.resolve('External', 'Alpha'),
    uuid: UUID
  };
}
