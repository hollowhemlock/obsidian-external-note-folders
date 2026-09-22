import type {
  App,
  PluginManifest
} from 'obsidian';

import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TFile } from 'obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { SetupPlan } from './core/setupPlan.ts';
import type {
  SetupExecutionOperations,
  SetupJournal
} from './storage/setupExecutor.ts';

import { Plugin } from './Plugin.ts';
import { DEFAULT_SETTINGS } from './PluginSettings.ts';
import { openExternalFolderInFileManager } from './storage/boundExternalFolder.ts';
import { scanExternalRoot } from './storage/scanExternalRoot.ts';
import {
  executeSetupPlan,
  readSetupJournal
} from './storage/setupExecutor.ts';

vi.mock('./storage/boundExternalFolder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./storage/boundExternalFolder.ts')>(),
  openExternalFolderInFileManager: vi.fn(async () => undefined)
}));

vi.mock('./storage/scanExternalRoot.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./storage/scanExternalRoot.ts')>(),
  scanExternalRoot: vi.fn((...args: Parameters<typeof scanExternalRoot>) =>
    importOriginal<typeof import('./storage/scanExternalRoot.ts')>().then((module) => module.scanExternalRoot(...args))
  )
}));

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_UUID = '223e4567-e89b-42d3-a456-426614174000';

interface SetupCommands {
  buildSetupExecutionOperations: () => SetupExecutionOperations;
  buildSetupPlanForFile: (file: TFile) => Promise<SetupPlan>;
  runSetupExecuteCommand: (plan: SetupPlan) => Promise<void>;
  runSetupResumeCommand: (journal: { journalPath: string } & SetupJournal) => Promise<void>;
  withProgressModal: <T>(title: string, description: string, operation: () => Promise<T>) => Promise<T>;
}

interface SetupFixture {
  addOwner: (notePath: string, uuid?: string) => void;
  commands: SetupCommands;
  file: TFile;
  frontmatter: Record<string, unknown>;
  markerPath: string;
  root: string;
  targetPath: string;
  writeNote: ReturnType<typeof vi.fn<(note: TFile, update: (value: Record<string, unknown>) => void) => Promise<void>>>;
}

describe('setup command safety', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it.each(['missing', 'replaced', 'competing'] as const)('does not write note identity when a resumed marker is %s', async (change) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    if (change !== 'competing') {
      await rm(fixture.markerPath);
    }
    if (change !== 'missing') {
      await writeFile(path.join(fixture.targetPath, `${OTHER_UUID}.exnf`), '');
    }
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(fixture.frontmatter).toEqual({});
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ completedAt: null, stage: 'frontmatter-write', uuid: UUID });
    expect(openExternalFolderInFileManager).not.toHaveBeenCalled();
  });

  it.each(['missing', 'replaced', 'competing'] as const)('rechecks a %s marker immediately before the note write after resume preflight', async (change) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    const buildOperations = fixture.commands.buildSetupExecutionOperations.bind(fixture.commands);
    vi.spyOn(fixture.commands, 'buildSetupExecutionOperations').mockImplementation(() => {
      const operations = buildOperations();
      return {
        ...operations,
        writeNoteUuid: async (current): Promise<void> => {
          if (change !== 'competing') {
            await rm(fixture.markerPath);
          }
          if (change !== 'missing') {
            await writeFile(path.join(fixture.targetPath, `${OTHER_UUID}.exnf`), '');
          }
          await operations.writeNoteUuid(current);
        }
      };
    });
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ stage: 'frontmatter-write', uuid: UUID });
  });

  it.each(['missing', 'same UUID'])('resumes with the original marker when note identity is %s', async (identity) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    if (identity === 'same UUID') {
      fixture.frontmatter['exnf'] = UUID;
    }
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.frontmatter['exnf']).toBe(UUID);
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ outcome: 'success', stage: 'complete' });
    expect(openExternalFolderInFileManager).toHaveBeenCalledWith(fixture.targetPath);
  });

  it.each(['Alpha/Alpha.md', 'Alpha/Child.md'])('blocks a new reservation from %s during resume', async (ownerPath) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    fixture.addOwner(ownerPath);
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ stage: 'frontmatter-write', uuid: UUID });
  });

  it('rechecks reservations immediately before writing note identity', async () => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    const buildOperations = fixture.commands.buildSetupExecutionOperations.bind(fixture.commands);
    vi.spyOn(fixture.commands, 'buildSetupExecutionOperations').mockImplementation(() => {
      const operations = buildOperations();
      return {
        ...operations,
        writeNoteUuid: async (current): Promise<void> => {
          fixture.addOwner('Alpha/Alpha.md');
          await operations.writeNoteUuid(current);
        }
      };
    });
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ stage: 'frontmatter-write', uuid: UUID });
  });

  it('leaves an incomplete complete-stage journal untouched when its marker is missing', async () => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    fixture.frontmatter['exnf'] = UUID;
    journal.stage = 'complete';
    await writeFile(journal.journalPath, JSON.stringify(journal));
    await rm(fixture.markerPath);
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readSetupJournal(journal.journalPath)).toMatchObject(journal);
    expect(openExternalFolderInFileManager).not.toHaveBeenCalled();
  });

  it.each(['folder-create', 'marker-write'] as const)('resumes an empty create-new target from %s', async (stage) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    await rm(fixture.markerPath);
    journal.action = 'create-new';
    journal.stage = stage;
    await writeFile(journal.journalPath, JSON.stringify(journal));
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.frontmatter['exnf']).toBe(UUID);
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ outcome: 'success', stage: 'complete', uuid: UUID });
  });

  it('reruns identified-note reservations during execution preflight', async () => {
    const fixture = await createFixture();
    const plan = await fixture.commands.buildSetupPlanForFile(fixture.file);
    expect(plan.action).toBe('confirm-unmarked-adoption');
    fixture.addOwner('Alpha/Alpha.md');
    await fixture.commands.runSetupExecuteCommand(plan);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readdir(fixture.targetPath)).toEqual([]);
  });

  it('refreshes vault UUID ownership after the imported marker scan', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.markerPath, '');
    fixture.commands.withProgressModal = async <T>(_title: string, _description: string, operation: () => Promise<T>): Promise<T> => {
      const result = await operation();
      fixture.addOwner('Other.md', UUID);
      return result;
    };
    const plan = await fixture.commands.buildSetupPlanForFile(fixture.file);
    expect(plan.action).toBe('block');
    expect(plan.errors).toContain(`Marker UUID ${UUID} already belongs to a vault note.`);
  });

  it('blocks restoration when another note acquires its UUID during execution preflight', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.markerPath, '');
    const plan = await fixture.commands.buildSetupPlanForFile(fixture.file);
    expect(plan.action).toBe('confirm-marker-restore');
    fixture.commands.withProgressModal = async <T>(_title: string, _description: string, operation: () => Promise<T>): Promise<T> => {
      const result = await operation();
      fixture.addOwner('Other.md', UUID);
      return result;
    };
    await fixture.commands.runSetupExecuteCommand(plan);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(fixture.frontmatter).toEqual({});
    expect(openExternalFolderInFileManager).not.toHaveBeenCalled();
  });

  it.each(['single', 'duplicate'])('blocks a %s UUID owner introduced during the restoration resume scan', async (ownership) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture, 'confirm-marker-restore');
    fixture.commands.withProgressModal = async <T>(_title: string, _description: string, operation: () => Promise<T>): Promise<T> => {
      const result = await operation();
      fixture.addOwner('Other.md', UUID);
      if (ownership === 'duplicate') {
        fixture.addOwner('Another.md', UUID);
      }
      return result;
    };
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(fixture.frontmatter).toEqual({});
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ completedAt: null, stage: 'frontmatter-write', uuid: UUID });
    expect(openExternalFolderInFileManager).not.toHaveBeenCalled();
  });

  it.each(['single', 'duplicate'])('rechecks a %s UUID owner immediately before writing note identity', async (ownership) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture, 'confirm-marker-restore');
    const buildOperations = fixture.commands.buildSetupExecutionOperations.bind(fixture.commands);
    vi.spyOn(fixture.commands, 'buildSetupExecutionOperations').mockImplementation(() => {
      const operations = buildOperations();
      return {
        ...operations,
        writeNoteUuid: async (current): Promise<void> => {
          fixture.addOwner('Other.md', UUID);
          if (ownership === 'duplicate') {
            fixture.addOwner('Another.md', UUID);
          }
          await operations.writeNoteUuid(current);
        }
      };
    });
    await fixture.commands.runSetupResumeCommand(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(fixture.frontmatter).toEqual({});
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ completedAt: null, stage: 'frontmatter-write', uuid: UUID });
    expect(openExternalFolderInFileManager).not.toHaveBeenCalled();
  });

  it.each(['initial', 'resume'])('blocks %s imported restoration when a legacy marker cannot be read', async (mode) => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture, 'confirm-marker-restore');
    const hiddenPath = path.join(fixture.root, 'Other');
    await mkdir(hiddenPath);
    await writeFile(path.join(hiddenPath, '.exnf'), UUID);
    const original = await vi.importActual<typeof import('./storage/scanExternalRoot.ts')>('./storage/scanExternalRoot.ts');
    const unreadableScan = await original.scanExternalRoot(fixture.root, {
      fileSystem: {
        readDirectoryEntries: async (directoryPath) => readdir(directoryPath, { encoding: 'utf8', withFileTypes: true }),
        readMarkerFile: async () => {
          throw new Error('read failed without an error code');
        },
        resolveRealPath: realpath
      }
    });
    expect(unreadableScan.duplicatePaths.size).toBe(0);
    vi.mocked(scanExternalRoot).mockResolvedValueOnce(unreadableScan);
    if (mode === 'initial') {
      expect((await fixture.commands.buildSetupPlanForFile(fixture.file)).action).toBe('block');
    } else {
      await fixture.commands.runSetupResumeCommand(journal);
    }
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ stage: 'frontmatter-write', uuid: UUID });
  });

  async function createFixture(): Promise<SetupFixture> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-setup-command-'));
    roots.push(root);
    const targetPath = path.join(root, 'Alpha');
    await mkdir(targetPath);
    const file = new TFile();
    file.path = 'Alpha.md';
    const files = [file];
    const frontmatter: Record<string, unknown> = {};
    const metadata = new Map([[file, frontmatter]]);
    const writeNote = vi.fn(async (note: TFile, update: (value: Record<string, unknown>) => void) => {
      update(metadata.get(note) ?? {});
    });
    const app = {
      fileManager: { processFrontMatter: writeNote },
      metadataCache: { getFileCache: (note: TFile) => ({ frontmatter: metadata.get(note) }) },
      vault: {
        adapter: { getBasePath: () => root },
        configDir: '.test-config',
        getAbstractFileByPath: (notePath: string) => files.find((note) => note.path === notePath),
        getMarkdownFiles: () => files,
        read: async () => `---\nexnf: ${String(frontmatter['exnf'])}\n---\n`
      }
    } as unknown as App;
    const plugin = new Plugin(app, { id: 'external-note-folders' } as PluginManifest);
    plugin.settings = { ...DEFAULT_SETTINGS, externalRootPath: root };
    const commands = plugin as unknown as SetupCommands;
    commands.withProgressModal = async <T>(_title: string, _description: string, operation: () => Promise<T>): Promise<T> => operation();
    return {
      addOwner: (notePath: string, uuid = OTHER_UUID): void => {
        const owner = new TFile();
        owner.path = notePath;
        files.push(owner);
        metadata.set(owner, { exnf: uuid });
      },
      commands,
      file,
      frontmatter,
      markerPath: path.join(targetPath, `${UUID}.exnf`),
      root,
      targetPath,
      writeNote
    };
  }

  async function interruptBeforeNote(
    fixture: SetupFixture,
    action: SetupJournal['action'] = 'confirm-unmarked-adoption'
  ): Promise<{ journalPath: string } & SetupJournal> {
    if (action === 'confirm-marker-restore') {
      await writeFile(fixture.markerPath, '');
    }
    fixture.writeNote.mockRejectedValueOnce(new Error('simulated frontmatter failure'));
    const plan: SetupPlan = {
      action,
      errors: [],
      externalRootPath: fixture.root,
      ignoredDirectoryCount: 0,
      legacyMarkerPaths: [],
      mutationSequence: 0,
      notePath: 'Alpha.md',
      targetPath: fixture.targetPath,
      uuid: UUID
    };
    const result = await executeSetupPlan({
      journalRootPath: path.join(fixture.root, 'journals'),
      operations: fixture.commands.buildSetupExecutionOperations(),
      plan
    });
    expect(result.succeeded).toBe(false);
    expect(result.journal.stage).toBe('frontmatter-write');
    fixture.writeNote.mockClear();
    return { ...result.journal, journalPath: result.journalPath };
  }
});
