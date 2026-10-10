import type {
  App,
  PluginManifest
} from 'obsidian';

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
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

import type { OpenExternalFolderRecoveryPlan } from './core/openExternalFolderRecovery.ts';
import type { ReconcilePlan } from './core/reconcilePlan.ts';
import type { SetupPlan } from './core/setupPlan.ts';
import type { AdoptionExecutionOperations } from './storage/adoptionExecutor.ts';
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
  assertNoPendingMarkerRepair: (folder: string) => Promise<void>;
  buildAdoptionExecutionOperations: (root: string) => AdoptionExecutionOperations;
  buildSetupExecutionOperations: () => SetupExecutionOperations;
  buildSetupPlanForFile: (file: TFile) => Promise<SetupPlan>;
  checkScopedSetup: (notePath: string, journal?: SetupJournal) => Promise<SetupPlan>;
  getActiveMarkdownFile: () => null | TFile;
  mutationSequence: number;
  openRecoveryModal: (plan: OpenExternalFolderRecoveryPlan, opened: null | string) => void;
  runMutatingCommand: (action: string, operation: () => Promise<unknown>) => Promise<void>;
  runOpenExternalFolderCommand: () => Promise<void>;
  runReconcileExecuteCommand: (plan: ReconcilePlan) => Promise<void>;
  runSetupExecuteCommand: (plan: SetupPlan) => Promise<void>;
  runSetupExternalFolderCommand: () => Promise<void>;
  runSetupResumeCommand: (journal: { journalPath: string } & SetupJournal, confirmed?: SetupPlan) => Promise<void>;
  withProgressModal: <T>(title: string, description: string, operation: () => Promise<T>) => Promise<T>;
}

interface SetupFixture {
  addOwner: (notePath: string, uuid?: string) => void;
  commands: SetupCommands;
  file: TFile;
  frontmatter: Record<string, unknown>;
  markerPath: string;
  plugin: Plugin;
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

  it.each(['no active file', 'image'])('does not scan or mutate for %s at the command boundary', async (active) => {
    const fixture = await createFixture();
    fixture.file.extension = 'png';
    fixture.plugin.app.workspace.getActiveFile = (): null | TFile => active === 'image' ? fixture.file : null;
    const read = vi.spyOn(fixture.plugin.app.vault.adapter, 'read');
    await fixture.commands.runSetupExternalFolderCommand();
    await fixture.commands.runOpenExternalFolderCommand();
    expect(read).not.toHaveBeenCalled();
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readdir(fixture.targetPath)).toEqual([]);
  });

  it('rejects a stale plan without advancing mutation sequence or writing', async () => {
    const fixture = await createFixture();
    const plan = await fixture.commands.buildSetupPlanForFile(fixture.file);
    fixture.commands.mutationSequence += 1;
    const revision = fixture.commands.mutationSequence;
    await fixture.commands.runSetupExecuteCommand(plan);
    expect(fixture.commands.mutationSequence).toBe(revision);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readdir(fixture.targetPath)).toEqual([]);
  });

  it('blocks a concurrent mutation while the first command owns the lock', async () => {
    const fixture = await createFixture();
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = fixture.commands.runMutatingCommand('first', async () => pending);
    const second = vi.fn(async () => undefined);
    await fixture.commands.runMutatingCommand('second', second);
    expect(second).not.toHaveBeenCalled();
    expect(fixture.commands.mutationSequence).toBe(0);
    finish?.();
    await first;
    expect(fixture.commands.mutationSequence).toBe(1);
  });

  it('preserves an interrupted journal when its external root is unavailable', async () => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    journal.externalRootPath = path.join(fixture.root, 'unavailable');
    journal.targetPath = path.join(journal.externalRootPath, 'Alpha');
    await writeFile(journal.journalPath, JSON.stringify(journal));
    await expect(fixture.commands.runSetupResumeCommand(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readSetupJournal(journal.journalPath)).toMatchObject(journal);
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(openExternalFolderInFileManager).not.toHaveBeenCalled();
  });

  it('keeps scoped resume complete when opening the successfully bound folder fails', async () => {
    const fixture = await createFixture();
    fixture.plugin.app.vault.adapter.read = async (): Promise<string> => readFile(path.join(fixture.root, 'Alpha.md'), 'utf8');
    const plan = { ...await fixture.commands.buildSetupPlanForFile(fixture.file), uuid: UUID };
    expect(plan.inspectionPolicy).toBeDefined();
    fixture.writeNote.mockRejectedValueOnce(new Error('simulated interruption'));
    const interrupted = await executeSetupPlan({
      journalRootPath: path.join(fixture.root, 'journals'),
      operations: fixture.commands.buildSetupExecutionOperations(),
      plan
    });
    expect(interrupted.journal.stage).toBe('frontmatter-write');
    expect(interrupted.succeeded).toBe(false);
    const journal = { ...interrupted.journal, journalPath: interrupted.journalPath };
    const confirmed = await fixture.commands.checkScopedSetup(journal.notePath, journal);
    fixture.writeNote.mockImplementation(async (_note, update) => {
      update(fixture.frontmatter);
      await writeFile(path.join(fixture.root, 'Alpha.md'), `---\nexnf: ${UUID}\n---\nnote without identity`);
    });
    vi.mocked(openExternalFolderInFileManager).mockRejectedValueOnce(new Error('file manager unavailable'));
    await expect(fixture.commands.runSetupResumeCommand(journal, confirmed)).resolves.toBeUndefined();
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ outcome: 'success', stage: 'complete', uuid: UUID });
    expect(fixture.frontmatter['exnf']).toBe(UUID);
    expect(await readdir(fixture.targetPath)).toEqual([`${UUID}.exnf`]);
    expect(fixture.writeNote).toHaveBeenCalledTimes(2);
  });

  it('rejects setup and recovery for notes excluded by template patterns', async () => {
    const fixture = await createFixture();
    const journal = await interruptBeforeNote(fixture);
    fixture.plugin.settings.templateExcludePatterns = ['/Alpha.md'];
    await expect(fixture.commands.buildSetupPlanForFile(fixture.file)).rejects.toThrow('excluded');
    await expect(fixture.commands.runSetupResumeCommand(journal)).rejects.toThrow('excluded');
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readSetupJournal(journal.journalPath)).toMatchObject({ stage: 'frontmatter-write' });
  });

  it('reads selected note bytes before choosing setup when metadata is absent', async () => {
    const fixture = await createFixture();
    fixture.plugin.app.vault.adapter.read = async (): Promise<string> => `---\nexnf: ${UUID}\n---\n`;
    const plan = await fixture.commands.buildSetupPlanForFile(fixture.file);
    expect(plan).toMatchObject({ action: 'open-existing', uuid: UUID });
    expect(fixture.writeNote).not.toHaveBeenCalled();
    expect(await readdir(fixture.targetPath)).toEqual([]);
  });
  it('uses fresh selected identity for Open recovery despite an absent metadata identity', async () => {
    const fixture = await createFixture();
    fixture.plugin.app.vault.adapter.read = async (): Promise<string> => `---\nexnf: ${UUID}\n---\n`;
    vi.spyOn(fixture.commands, 'getActiveMarkdownFile').mockReturnValue(fixture.file);
    const modal = vi.spyOn(fixture.commands, 'openRecoveryModal').mockImplementation(() => undefined);
    await fixture.commands.runOpenExternalFolderCommand();
    expect(modal).toHaveBeenCalledWith(expect.objectContaining({ notePath: fixture.file.path, uuid: UUID }), null);
    expect(fixture.writeNote).not.toHaveBeenCalled();
  });
  it('blocks overlapping bulk adoption writes and reconcile moves behind a pending repair', async () => {
    const fixture = await createFixture();
    const guard = vi.spyOn(fixture.commands, 'assertNoPendingMarkerRepair').mockRejectedValue(new Error('Review pending repair'));
    const operations = fixture.commands.buildAdoptionExecutionOperations(fixture.root);
    const row = { externalFolder: 'Alpha', folderPath: fixture.targetPath, kind: 'adopt' as const, notePath: 'Alpha.md' };
    await expect(operations.writeMarker(row, UUID)).rejects.toThrow('pending repair');
    await expect(operations.writeNoteUuid(row, UUID)).rejects.toThrow('pending repair');
    expect(guard).toHaveBeenCalledWith(fixture.targetPath);
    const plan: ReconcilePlan = {
      errors: [],
      externalRootPath: fixture.root,
      hasGlobalErrors: false,
      markdownReport: '',
      mutationSequence: 0,
      rows: [{
        currentExternalFolder: 'Alpha',
        kind: 'move',
        notePath: 'Other.md',
        sourcePath: fixture.targetPath,
        targetExternalFolder: 'Other',
        targetPath: path.join(fixture.root, 'Other'),
        uuid: UUID
      }],
      summaryText: '',
      warnings: []
    };
    await expect(fixture.commands.runReconcileExecuteCommand(plan)).rejects.toThrow('pending repair');
    expect(await readdir(fixture.targetPath)).toEqual([]);
    expect(fixture.writeNote).not.toHaveBeenCalled();
  });
  it('omits excluded templates from setup identity and descendant reservations', async () => {
    const fixture = await createFixture();
    fixture.addOwner('Alpha/Child.tpl.md');
    expect((await fixture.commands.buildSetupPlanForFile(fixture.file)).action).toBe('block');
    fixture.plugin.settings.templateExcludePatterns = ['*.tpl.md'];
    expect((await fixture.commands.buildSetupPlanForFile(fixture.file)).action).toBe('confirm-unmarked-adoption');
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
    // This fixture shares its physical vault/root, including the newly reserved note.
    expect(await readdir(fixture.targetPath)).toEqual(['Alpha.md']);
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
    await writeFile(path.join(root, 'Alpha.md'), 'note without identity');
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
        adapter: {
          getBasePath: () => root,
          read: async () => typeof frontmatter['exnf'] === 'string' ? `---\nexnf: ${frontmatter['exnf']}\n---\n` : 'note without identity'
        },
        configDir: '.test-config',
        getAbstractFileByPath: (notePath: string) => files.find((note) => note.path === notePath),
        getMarkdownFiles: () => files,
        read: async () => `---\nexnf: ${String(frontmatter['exnf'])}\n---\n`
      },
      workspace: { getLeavesOfType: () => [] }
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
        mkdirSync(path.dirname(path.join(root, notePath)), { recursive: true });
        writeFileSync(path.join(root, notePath), `---\nexnf: ${uuid}\n---\n`);
      },
      commands,
      file,
      frontmatter,
      markerPath: path.join(targetPath, `${UUID}.exnf`),
      plugin,
      root,
      targetPath,
      writeNote
    };
  }

  async function interruptBeforeNote(
    fixture: SetupFixture,
    action: Exclude<SetupJournal['action'], 'create-missing-marker'> = 'confirm-unmarked-adoption'
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
