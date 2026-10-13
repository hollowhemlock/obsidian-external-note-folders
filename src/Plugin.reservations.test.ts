import type {
  App,
  PluginManifest
} from 'obsidian';

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

import type {
  MarkerRepairController,
  MarkerRepairHost
} from './obsidian/MarkerRepairController.ts';
import type { AdoptionJournal } from './storage/adoptionExecutor.ts';
import type { GroupAdoptionJournal } from './storage/groupAdoptionJournal.ts';
import type { SetupJournal } from './storage/setupExecutor.ts';

import { GroupAdoptionController } from './obsidian/GroupAdoptionController.ts';
import { Plugin } from './Plugin.ts';
import { DEFAULT_SETTINGS } from './PluginSettings.ts';
import {
  buildAdoptionJournalRootPath,
  buildJournalRootPath,
  buildSetupJournalRootPath
} from './storage/journalPath.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const STAMP = '2026-10-12T00:00:00.000Z';

interface Fixture {
  bulk: (name: string, entries?: AdoptionJournal['entries'], completedAt?: null | string) => Promise<string>;
  commands: ReservationCommands;
  external: string;
  group: (name: string, changes?: Partial<GroupAdoptionJournal>) => Promise<string>;
  groupGuard: (targets: readonly string[], except?: string) => Promise<void>;
  groupRoot: string;
  repairGuard: MarkerRepairHost['assertNoPending'];
  setup: (name: string, changes?: Partial<SetupJournal>) => Promise<string>;
  setupRoot: string;
  target: string;
}

interface ReservationCommands {
  assertNoPendingMarkerRepair: (folder: string) => Promise<void>;
  assertSetupAdoptionOverlap: (folder: string, except?: string, skipGroups?: boolean) => Promise<void>;
  groupAdoption: GroupAdoptionController | undefined;
  markerRepairs: () => MarkerRepairController;
}

// ADR-0031 keeps pending repairs blocking; ADR-0032 exempts only the resumed journal from overlap checks.
describe('pending operation reservation policies', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function fixture(): Promise<Fixture> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-reservations-'));
    roots.push(root);
    const vault = path.join(root, 'vault');
    const external = path.join(root, 'external');
    const target = path.join(external, 'Target');
    const app = { vault: { adapter: { getBasePath: () => vault }, configDir: '.test-config' } } as unknown as App;
    const pluginId = 'external-note-folders';
    const plugin = new Plugin(app, { id: pluginId } as PluginManifest);
    plugin.settings = { ...DEFAULT_SETTINGS, externalRootPath: external };
    const commands = plugin as unknown as ReservationCommands;
    const controller = new GroupAdoptionController(app, pluginId, {
      changed: (): undefined => undefined,
      mutate: async (operation): Promise<void> => operation(),
      sequence: (): number => 0,
      settings: (): typeof plugin.settings => plugin.settings
    });
    commands.groupAdoption = controller;
    const groupCommands = controller as unknown as {
      assertNoOverlappingAdoption: (targets: readonly string[], except?: string) => Promise<void>;
    };
    const repair = commands.markerRepairs() as unknown as { host: MarkerRepairHost };
    const paths = { configDir: app.vault.configDir, pluginId, vaultRootPath: vault };
    const setupRoot = buildSetupJournalRootPath(paths);
    const bulkRoot = buildAdoptionJournalRootPath(paths);
    const groupRoot = path.join(buildJournalRootPath(paths), 'group-adoption');
    return {
      bulk: async (name, entries = [bulkEntry(target)], completedAt = null): Promise<string> => {
        const journal: AdoptionJournal = {
          completedAt,
          entries,
          externalRootPath: external,
          kind: 'external-folder-adoption',
          runId: name,
          schemaVersion: 1,
          startedAt: STAMP
        };
        return save(bulkRoot, name, journal);
      },
      commands,
      external,
      group: async (name, changes = {}): Promise<string> => {
        const journal: GroupAdoptionJournal = {
          attempted: false,
          error: '',
          kind: 'group-adoption',
          plan: {
            aliases: null,
            descendants: [],
            expectedFolder: path.join(external, 'Expected'),
            externalRoot: external,
            folderPath: target,
            ignorePatterns: [],
            mutationSequence: 0,
            notePath: 'Expected.md',
            sourcePath: null,
            uuid: UUID,
            vaultRoot: vault,
            warnings: []
          },
          preparedContent: null,
          schemaVersion: 1,
          sourceContent: null,
          stage: 'marker',
          ...changes
        };
        return save(groupRoot, name, journal);
      },
      groupGuard: async (targets, except) => groupCommands.assertNoOverlappingAdoption(targets, except),
      groupRoot,
      repairGuard: async (folder, except) => repair.host.assertNoPending(folder, except),
      setup: async (name, changes = {}): Promise<string> => {
        const journal: SetupJournal = {
          action: 'create-new',
          completedAt: null,
          externalRootPath: external,
          kind: 'external-folder-setup',
          message: null,
          notePath: 'Target.md',
          omissions: [],
          outcome: 'pending',
          repairContext: {
            externalRootPath: external,
            ignorePatterns: [],
            knownFolders: [],
            notePath: 'Target.md',
            targetPath: target,
            templatePatterns: [],
            uuid: UUID
          },
          runId: name,
          schemaVersion: 1,
          stage: 'marker-write',
          startedAt: STAMP,
          targetPath: target,
          uuid: UUID,
          ...changes
        };
        return save(setupRoot, name, journal);
      },
      setupRoot,
      target
    };
  }

  it.each(['create-new', 'confirm-unmarked-adoption', 'confirm-marker-restore', 'create-missing-marker'] as const)(
    'retains workflow-specific handling of %s setup journals',
    async (action) => {
      const f = await fixture();
      const file = await f.setup('operation', { action, stage: action === 'confirm-marker-restore' ? 'frontmatter-write' : 'marker-write' });
      await expect(f.commands.assertSetupAdoptionOverlap(f.target)).rejects.toThrow(`Review pending setup: ${file}`);
      await expect(f.repairGuard(f.target)).rejects.toThrow(`Review pending setup or marker repair: ${file}`);
      await expect(f.groupGuard([f.target])).resolves.toBeUndefined();
      if (action === 'create-missing-marker') {
        await expect(f.commands.assertNoPendingMarkerRepair(f.target)).rejects.toThrow(`Review pending marker repair: ${file}`);
      } else {
        await expect(f.commands.assertNoPendingMarkerRepair(f.target)).resolves.toBeUndefined();
      }
    }
  );

  it.each(['Target', 'Expected', 'Target/Child', 'Expected/Child', ''])('checks both group reservations for %s', async (relative) => {
    const f = await fixture();
    const file = await f.group('operation');
    const target = path.join(f.external, relative);
    await expect(f.commands.assertSetupAdoptionOverlap(target)).rejects.toThrow(`Review pending folder adoption: ${file}`);
    await expect(f.repairGuard(target)).rejects.toThrow(`Review pending folder adoption: ${file}`);
    await expect(f.groupGuard([path.join(f.external, 'Unrelated'), target])).rejects.toThrow(`Another pending adoption overlaps this operation: ${file}`);
    await expect(f.commands.assertNoPendingMarkerRepair(target)).resolves.toBeUndefined();
    await expect(f.commands.assertSetupAdoptionOverlap(target, undefined, true)).resolves.toBeUndefined();
  });

  it('does not treat sibling prefixes as overlapping paths', async () => {
    const f = await fixture();
    await f.group('group');
    await f.setup('setup', { action: 'create-missing-marker' });
    await f.bulk('bulk');
    const sibling = `${f.target}Sibling`;
    await expect(f.commands.assertSetupAdoptionOverlap(sibling)).resolves.toBeUndefined();
    await expect(f.commands.assertNoPendingMarkerRepair(sibling)).resolves.toBeUndefined();
    await expect(f.repairGuard(sibling)).resolves.toBeUndefined();
    await expect(f.groupGuard([sibling])).resolves.toBeUndefined();
  });

  it('reserves only unfinished bulk entries and keeps marker/group checks narrower', async () => {
    const f = await fixture();
    const other = path.join(f.external, 'Other');
    const file = await f.bulk('bulk', [bulkEntry(f.target, STAMP), bulkEntry(other)]);
    await expect(f.commands.assertSetupAdoptionOverlap(f.target)).resolves.toBeUndefined();
    await expect(f.repairGuard(f.target)).resolves.toBeUndefined();
    await expect(f.commands.assertSetupAdoptionOverlap(other, undefined, true)).rejects.toThrow(`Review pending bulk adoption: ${file}`);
    await expect(f.repairGuard(other)).rejects.toThrow(`Review pending bulk adoption: ${file}`);
    await expect(f.commands.assertNoPendingMarkerRepair(other)).resolves.toBeUndefined();
    await expect(f.groupGuard([other])).resolves.toBeUndefined();
  });

  it('exempts only the exact setup journal path and still blocks other reservations', async () => {
    const f = await fixture();
    const own = await f.setup('a-own', { action: 'create-missing-marker' });
    await expect(f.commands.assertSetupAdoptionOverlap(f.target, own)).resolves.toBeUndefined();
    await expect(f.repairGuard(f.target, own)).resolves.toBeUndefined();
    const equivalent = `${path.dirname(own)}${path.sep}.${path.sep}${path.basename(own)}`;
    await expect(f.commands.assertSetupAdoptionOverlap(f.target, equivalent)).rejects.toThrow(`Review pending setup: ${own}`);
    await expect(f.repairGuard(f.target, equivalent)).rejects.toThrow(`Review pending setup or marker repair: ${own}`);
    const other = await f.setup('b-other');
    await expect(f.commands.assertSetupAdoptionOverlap(f.target, own)).rejects.toThrow(`Review pending setup: ${other}`);
    await expect(f.repairGuard(f.target, own)).rejects.toThrow(`Review pending setup or marker repair: ${other}`);
  });

  it('exempts only the exact group journal path and still blocks other operations', async () => {
    const f = await fixture();
    const own = await f.group('a-own');
    await expect(f.groupGuard([f.target], own)).resolves.toBeUndefined();
    const equivalent = `${path.dirname(own)}${path.sep}.${path.sep}${path.basename(own)}`;
    await expect(f.groupGuard([f.target], equivalent)).rejects.toThrow(`Another pending adoption overlaps this operation: ${own}`);
    const other = await f.group('b-other');
    await expect(f.groupGuard([f.target], own)).rejects.toThrow(`Another pending adoption overlaps this operation: ${other}`);
  });

  it('checks setup before groups before bulk without reading later families after a conflict', async () => {
    const f = await fixture();
    const setup = await f.setup('setup');
    const group = await f.group('group');
    const bulk = await f.bulk('bulk');
    await writeFile(bulk, '{}');
    await expect(f.commands.assertSetupAdoptionOverlap(f.target)).rejects.toThrow(`Review pending setup: ${setup}`);
    await expect(f.repairGuard(f.target)).rejects.toThrow(`Review pending setup or marker repair: ${setup}`);
    await expect(f.commands.assertSetupAdoptionOverlap(f.target, setup)).rejects.toThrow(`Review pending folder adoption: ${group}`);
    await expect(f.repairGuard(f.target, setup)).rejects.toThrow(`Review pending folder adoption: ${group}`);
    await expect(f.commands.assertSetupAdoptionOverlap(f.target, setup, true)).rejects.toThrow(`Invalid adoption journal: ${bulk}`);
  });

  it('skips group reads when explicitly excluded or no group controller is available', async () => {
    const f = await fixture();
    const file = await save(f.groupRoot, 'invalid', {});
    await expect(f.commands.assertSetupAdoptionOverlap(f.target, undefined, true)).resolves.toBeUndefined();
    await expect(f.commands.assertSetupAdoptionOverlap(f.target)).rejects.toThrow(`Invalid group adoption journal: ${file}`);
    f.commands.groupAdoption = undefined;
    await expect(f.commands.assertSetupAdoptionOverlap(f.target)).resolves.toBeUndefined();
    await expect(f.repairGuard(f.target)).resolves.toBeUndefined();
  });

  it('validates every setup journal before overlaps, action filtering, or self exclusion', async () => {
    const f = await fixture();
    await f.setup('a-conflict', { action: 'create-missing-marker' });
    const invalid = await f.setup('z-invalid', { completedAt: STAMP, uuid: 'invalid' });
    await expect(f.commands.assertSetupAdoptionOverlap(f.target, invalid)).rejects.toThrow(`Invalid setup journal: ${invalid}`);
    await expect(f.repairGuard(f.target, invalid)).rejects.toThrow(`Invalid setup journal: ${invalid}`);
    await expect(f.commands.assertNoPendingMarkerRepair(f.target)).rejects.toThrow(`Invalid setup journal: ${invalid}`);
  });

  it('validates every group journal before conflicts or self exclusion', async () => {
    const f = await fixture();
    await f.group('a-conflict');
    const invalid = await save(f.groupRoot, 'z-invalid', { stage: 'complete' });
    await expect(f.commands.assertSetupAdoptionOverlap(f.target)).rejects.toThrow(`Invalid group adoption journal: ${invalid}`);
    await expect(f.groupGuard([f.target], invalid)).rejects.toThrow(`Invalid group adoption journal: ${invalid}`);
  });

  it('rereads journal completion on later checks and ignores completed operations', async () => {
    const f = await fixture();
    const setup = await f.setup('setup', { action: 'create-missing-marker' });
    await expect(f.commands.assertNoPendingMarkerRepair(f.target)).rejects.toThrow(setup);
    await f.setup('setup', { action: 'create-missing-marker', completedAt: STAMP, stage: 'complete' });
    const group = await f.group('group');
    await expect(f.groupGuard([f.target])).rejects.toThrow(group);
    await f.group('group', { stage: 'complete' });
    const bulk = await f.bulk('bulk');
    await expect(f.commands.assertSetupAdoptionOverlap(f.target)).rejects.toThrow(bulk);
    await f.bulk('bulk', [bulkEntry(f.target)], STAMP);
    await expect(f.commands.assertNoPendingMarkerRepair(f.target)).resolves.toBeUndefined();
    await expect(f.commands.assertSetupAdoptionOverlap(f.target)).resolves.toBeUndefined();
    await expect(f.repairGuard(f.target)).resolves.toBeUndefined();
    await expect(f.groupGuard([f.target])).resolves.toBeUndefined();
  });
});

function bulkEntry(folderPath: string, completedAt: null | string = null): AdoptionJournal['entries'][number] {
  return {
    completedAt,
    externalFolder: path.basename(folderPath),
    folderPath,
    message: null,
    notePath: 'Target.md',
    outcome: 'pending',
    stage: 'marker-write',
    startedAt: STAMP,
    uuid: UUID
  };
}

async function save(root: string, name: string, journal: AdoptionJournal | GroupAdoptionJournal | Record<string, unknown> | SetupJournal): Promise<string> {
  await mkdir(root, { recursive: true });
  const file = path.join(root, `${name}.json`);
  await writeFile(file, JSON.stringify(journal));
  return file;
}
