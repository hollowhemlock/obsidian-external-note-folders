import {
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
  it,
  vi
} from 'vitest';

import type {
  AdoptionAdoptRow,
  AdoptionPlan
} from '../core/adoptionPlan.ts';

import {
  executeAdoptionPlan,
  listIncompleteAdoptionJournals,
  resumeAdoptionJournal
} from './adoptionExecutor.ts';

describe('adoption executor', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    const directories = [...tempDirectories];
    tempDirectories.length = 0;
    await Promise.all(directories.map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true
      });
    }));
  });

  it('writes markers before note frontmatter and completes the journal', async () => {
    const journalRootPath = await createTempRoot(tempDirectories);
    const calls: string[] = [];

    const result = await executeAdoptionPlan({
      journalRootPath,
      operations: {
        assertMarkerMatches: vi.fn(async () => {
          calls.push('assert-marker');
        }),
        assertNoteUuidMatches: vi.fn(async () => {
          calls.push('assert-note');
        }),
        writeMarker: vi.fn(async () => {
          calls.push('write-marker');
        }),
        writeNoteUuid: vi.fn(async () => {
          calls.push('write-note');
        })
      },
      plan: buildPlan()
    });

    expect(result.succeeded).toBe(true);
    expect(calls).toEqual(['write-marker', 'assert-marker', 'write-note', 'assert-note']);
    expect(result.journal.completedAt).not.toBeNull();
    expect(result.journal.entries[0]?.outcome).toBe('success');
  });

  it('leaves an incomplete journal when frontmatter writing fails', async () => {
    const journalRootPath = await createTempRoot(tempDirectories);

    const result = await executeAdoptionPlan({
      journalRootPath,
      operations: {
        assertMarkerMatches: vi.fn(async () => undefined),
        assertNoteUuidMatches: vi.fn(async () => undefined),
        writeMarker: vi.fn(async () => undefined),
        writeNoteUuid: vi.fn(async () => {
          throw new Error('frontmatter unavailable');
        })
      },
      plan: buildPlan()
    });

    expect(result.succeeded).toBe(false);
    expect(result.journal.completedAt).toBeNull();
    expect(result.journal.entries[0]).toMatchObject({
      message: 'frontmatter unavailable',
      outcome: 'failure',
      stage: 'frontmatter-write'
    });
    await expect(listIncompleteAdoptionJournals(journalRootPath)).resolves.toHaveLength(1);
  });

  it('resumes frontmatter-write failures without rewriting the marker', async () => {
    const journalRootPath = await createTempRoot(tempDirectories);
    const failedResult = await executeAdoptionPlan({
      journalRootPath,
      operations: {
        assertMarkerMatches: vi.fn(async () => undefined),
        assertNoteUuidMatches: vi.fn(async () => undefined),
        writeMarker: vi.fn(async () => undefined),
        writeNoteUuid: vi.fn(async () => {
          throw new Error('frontmatter unavailable');
        })
      },
      plan: buildPlan()
    });
    const calls: string[] = [];

    const resumedResult = await resumeAdoptionJournal({
      journalPath: failedResult.journalPath,
      operations: {
        assertMarkerMatches: vi.fn(async () => {
          calls.push('assert-marker');
        }),
        assertNoteUuidMatches: vi.fn(async () => {
          calls.push('assert-note');
        }),
        writeMarker: vi.fn(async () => {
          calls.push('write-marker');
        }),
        writeNoteUuid: vi.fn(async () => {
          calls.push('write-note');
        })
      }
    });

    expect(resumedResult.succeeded).toBe(true);
    expect(calls).toEqual(['assert-marker', 'write-note', 'assert-note']);
    expect(resumedResult.journal.completedAt).not.toBeNull();
  });

  it('blocks resume when a completed entry no longer matches current state', async () => {
    const journalRootPath = await createTempRoot(tempDirectories);
    const failedResult = await executeAdoptionPlan({
      journalRootPath,
      operations: {
        assertMarkerMatches: vi.fn(async () => undefined),
        assertNoteUuidMatches: vi.fn(async () => undefined),
        writeMarker: vi.fn(async () => undefined),
        writeNoteUuid: vi.fn(async (row: AdoptionAdoptRow) => {
          if (row.notePath === 'Projects/Beta.md') {
            throw new Error('frontmatter unavailable');
          }
        })
      },
      plan: {
        ...buildPlan(),
        rows: [
          {
            externalFolder: 'Projects/Alpha',
            folderPath: 'X:/External/Projects/Alpha',
            kind: 'adopt',
            notePath: 'Projects/Alpha.md'
          },
          {
            externalFolder: 'Projects/Beta',
            folderPath: 'X:/External/Projects/Beta',
            kind: 'adopt',
            notePath: 'Projects/Beta.md'
          }
        ]
      }
    });

    const resumedResult = await resumeAdoptionJournal({
      journalPath: failedResult.journalPath,
      operations: {
        assertMarkerMatches: vi.fn(async () => undefined),
        assertNoteUuidMatches: vi.fn(async (row: AdoptionAdoptRow) => {
          if (row.notePath === 'Projects/Alpha.md') {
            throw new Error('note changed after adoption');
          }
        }),
        writeMarker: vi.fn(async () => undefined),
        writeNoteUuid: vi.fn(async () => undefined)
      }
    });

    expect(resumedResult.succeeded).toBe(false);
    expect(resumedResult.journal.entries[0]).toMatchObject({
      message: 'note changed after adoption',
      outcome: 'failure'
    });
  });

  it('ignores stale completed journals when listing incomplete journals', async () => {
    const journalRootPath = await createTempRoot(tempDirectories);
    const result = await executeAdoptionPlan({
      journalRootPath,
      operations: {
        assertMarkerMatches: vi.fn(async () => undefined),
        assertNoteUuidMatches: vi.fn(async () => undefined),
        writeMarker: vi.fn(async () => undefined),
        writeNoteUuid: vi.fn(async () => undefined)
      },
      plan: buildPlan()
    });

    await writeFile(result.journalPath, `${JSON.stringify(result.journal, null, 2)}\n`, 'utf8');

    await expect(listIncompleteAdoptionJournals(journalRootPath)).resolves.toEqual([]);
  });

  it('rejects partial adoption journal JSON before listing it', async () => {
    const journalRootPath = await createTempRoot(tempDirectories);
    const journalPath = path.join(journalRootPath, 'partial.json');
    await writeFile(
      journalPath,
      `${
        JSON.stringify(
          {
            kind: 'external-folder-adoption',
            schemaVersion: 1
          },
          null,
          2
        )
      }\n`,
      'utf8'
    );

    await expect(listIncompleteAdoptionJournals(journalRootPath)).rejects.toThrow(`Invalid adoption journal: ${journalPath}`);
  });
});

function buildPlan(): AdoptionPlan {
  return {
    errors: [],
    externalRootPath: 'X:/External',
    hasGlobalErrors: false,
    markdownReport: '',
    mutationSequence: 0,
    rows: [
      {
        externalFolder: 'Projects/Alpha',
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'adopt',
        notePath: 'Projects/Alpha.md'
      }
    ],
    summaryText: '',
    warnings: []
  };
}

async function createTempRoot(tempDirectories: string[]): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'external-note-folders-'));
  tempDirectories.push(directoryPath);
  return directoryPath;
}
