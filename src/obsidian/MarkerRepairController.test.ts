import type { App } from 'obsidian';

import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
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

import type { MarkerRepairContext } from '../core/markerRepair.ts';
import type { MarkerRepairHost } from './MarkerRepairController.ts';

import { writeExpectedMarkerIfMissingOrMatching } from '../storage/boundExternalFolder.ts';
import { listIncompleteSetupJournals } from '../storage/setupExecutor.ts';
import { MarkerRepairController } from './MarkerRepairController.ts';
import { readMarkerRepairNotes } from './markerRepairVault.ts';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
vi.mock('../storage/boundExternalFolder.ts', async (original) => {
  const actual = await original<typeof import('../storage/boundExternalFolder.ts')>();
  return { ...actual, writeExpectedMarkerIfMissingOrMatching: vi.fn(actual.writeExpectedMarkerIfMissingOrMatching) };
});
vi.mock('obsidian', async (original) => ({ ...await original<object>(), parseYaml: (await import('yaml')).parse }));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
  }
});
interface Fixture {
  app: App;
  changed: ReturnType<typeof vi.fn>;
  content: string;
  context: MarkerRepairContext;
  controller: MarkerRepairController;
  external: string;
  host: MarkerRepairHost;
  journalRoot: string;
  list: ReturnType<typeof vi.fn<App['vault']['adapter']['list']>>;
  read: ReturnType<typeof vi.fn<App['vault']['adapter']['read']>>;
  settings: ReturnType<MarkerRepairHost['settings']>;
  target: string;
  vault: string;
}
async function fixture(): Promise<Fixture> {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'exnf-marker-repair-')));
  roots.push(temp);
  const external = path.join(temp, 'external');
  const vault = path.join(temp, 'vault');
  const target = path.join(external, 'Alpha');
  await mkdir(target, { recursive: true });
  await mkdir(vault);
  execFileSync('git', ['init', '-q', target]);
  await writeFile(path.join(target, '.gitignore'), 'references/\nnode_modules/\ndist/\n');
  for (const child of ['references', 'node_modules', 'dist']) {
    await mkdir(path.join(target, child));
    await writeFile(path.join(target, child, `${uuid}.exnf`), 'ignored');
  }
  const content = `---\nexnf: ${uuid}\n---\nKeep this note byte-for-byte.\n`;
  await writeFile(path.join(vault, 'Alpha.md'), content);
  await writeFile(path.join(target, 'payload.txt'), 'keep');
  const app = {
    vault: {
      adapter: {
        list: vi.fn(async (directory: string) => {
          const entries = await readdir(path.join(vault, directory), { withFileTypes: true });
          function name(file: string): string {
            return directory ? `${directory}/${file}` : file;
          }
          return {
            files: entries.filter((entry) => !entry.isDirectory()).map((entry) => name(entry.name)),
            folders: entries.filter((entry) => entry.isDirectory()).map((entry) => name(entry.name))
          };
        }),
        read: vi.fn((file: string) => readFile(path.join(vault, file), 'utf8'))
      },
      configDir: '.test-config'
    }
  } as unknown as App;
  const settings = { externalRootIgnorePatterns: [] as string[], externalRootPath: external, templateExcludePatterns: [] as string[] };
  const changed = vi.fn();
  const journalRoot = path.join(temp, 'journals');
  const host: MarkerRepairHost = {
    assertNoPending: async () => undefined,
    changed,
    journalRoot: () => journalRoot,
    knownFolders: () => [],
    mutate: async (operation) => operation(),
    openFolder: async () => undefined,
    refresh: async () => undefined,
    sequence: () => 0,
    settings: () => settings
  };
  const controller = new MarkerRepairController(app, host);
  const context = {
    externalRootPath: external,
    ignorePatterns: [],
    knownFolders: [] as string[],
    notePath: 'Alpha.md',
    targetPath: target,
    templatePatterns: [],
    uuid
  };
  return {
    app,
    changed,
    content,
    context,
    controller,
    external,
    host,
    journalRoot,
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Adapter methods are standalone vi.fn mocks in this fixture.
    list: app.vault.adapter.list as Fixture['list'],
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Standalone mock, not a method using this.
    read: app.vault.adapter.read as Fixture['read'],
    settings,
    target,
    vault
  };
}
describe('shared marker repair service', () => {
  it('repairs the supplied four-exclusion case without changing the note or payload', async () => {
    const f = await fixture();
    const plan = await f.controller.check(f.context);
    expect(plan.errors).toEqual([]);
    expect(plan.omissions).toHaveLength(4);
    await f.controller.execute(plan);
    expect(await readFile(path.join(f.vault, 'Alpha.md'), 'utf8')).toBe(f.content);
    expect(await readFile(path.join(f.target, 'payload.txt'), 'utf8')).toBe('keep');
    expect((await readdir(f.target)).filter((name) => name.endsWith('.exnf'))).toEqual([`${uuid}.exnf`]);
    expect(f.changed).toHaveBeenCalledWith(f.target, 'Alpha.md');
    expect(await listIncompleteSetupJournals(f.journalRoot)).toEqual([]);
  });
  it('rejects changed exclusions and changed or duplicate note identity before writing', async () => {
    const f = await fixture();
    const plan = await f.controller.check(f.context);
    await mkdir(path.join(f.target, 'extra'));
    await writeFile(path.join(f.target, '.gitignore'), 'references/\nnode_modules/\ndist/\nextra/\n');
    await expect(f.controller.execute(plan)).rejects.toThrow('exclusions changed');
    const next = await f.controller.check(f.context);
    await writeFile(path.join(f.vault, 'Other.md'), f.content);
    await expect(f.controller.execute(next)).rejects.toThrow('already owned');
    await rm(path.join(f.vault, 'Other.md'));
    await writeFile(path.join(f.vault, 'Alpha.md'), 'no UUID');
    await expect(f.controller.execute(next)).rejects.toThrow('identity changed');
    expect(await readdir(f.target)).not.toContain(`${uuid}.exnf`);
  });
  it('rechecks known matching locations and clears successfully disproven evidence', async () => {
    const f = await fixture();
    const other = path.join(f.external, 'Other');
    await mkdir(other);
    await writeFile(path.join(other, `${uuid}.exnf`), '');
    f.context.knownFolders = [other];
    expect((await f.controller.check(f.context)).knownMatches).toEqual([other]);
    await rm(path.join(other, `${uuid}.exnf`));
    expect((await f.controller.check(f.context)).errors).toEqual([]);
    await writeFile(path.join(other, '.exnf'), uuid);
    expect((await f.controller.check(f.context)).knownMatches).toEqual([other]);
  });
  it('accepts a concurrently created matching marker without rewriting its opaque contents', async () => {
    const f = await fixture();
    const plan = await f.controller.check(f.context);
    await writeFile(path.join(f.target, `${uuid}.exnf`), 'preserve');
    await f.controller.execute(plan);
    expect(await readFile(path.join(f.target, `${uuid}.exnf`), 'utf8')).toBe('preserve');
  });
  it.each(['EEXIST', 'EACCES'])('handles an exclusive-create %s result without overwrites or note writes', async (code) => {
    const f = await fixture();
    const plan = await f.controller.check(f.context);
    vi.mocked(writeExpectedMarkerIfMissingOrMatching).mockImplementationOnce(async () => {
      if (code === 'EEXIST') {
        await writeFile(path.join(f.target, `${uuid}.exnf`), 'concurrent output');
      }
      throw Object.assign(new Error('exclusive creation failed'), { code });
    });
    if (code === 'EEXIST') {
      await f.controller.execute(plan);
      expect(await f.controller.pending()).toEqual([]);
      expect(await readFile(path.join(f.target, `${uuid}.exnf`), 'utf8')).toBe('concurrent output');
    } else {
      await expect(f.controller.execute(plan)).rejects.toThrow('exclusive creation failed');
      expect(await f.controller.pending()).toHaveLength(1);
      expect(await readdir(f.target)).not.toContain(`${uuid}.exnf`);
    }
    expect(await readFile(path.join(f.vault, 'Alpha.md'), 'utf8')).toBe(f.content);
  });
  it('keeps tracked descendant markers visible despite Git ignore patterns', async () => {
    const f = await fixture();
    execFileSync('git', ['-C', f.target, 'add', '-f', `dist/${uuid}.exnf`]);
    expect((await f.controller.check(f.context)).errors.join(' ')).toContain('descendant marker');
  });
  it('blocks unignored linked descendants and repository validation failures', async () => {
    const f = await fixture();
    const linked = path.join(f.target, 'linked');
    await symlink(f.vault, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await f.controller.check(f.context)).errors.join(' ')).toContain('symbolic link');
    f.settings.externalRootIgnorePatterns = ['Alpha/linked/'];
    expect((await f.controller.check(f.context)).errors).toEqual([]);
    await writeFile(path.join(f.target, '.git', 'index'), 'invalid index');
    await expect(f.controller.check(f.context)).rejects.toThrow('Git filtering failed');
    expect(await readdir(f.target)).not.toContain(`${uuid}.exnf`);
  });
  it('reads ownership without metadata cache and blocks read, parse, and enumeration errors', async () => {
    const f = await fixture();
    expect(await readMarkerRepairNotes(f.app, [])).toMatchObject([{ identity: { kind: 'valid', uuid }, notePath: 'Alpha.md' }]);
    await writeFile(path.join(f.vault, 'broken.md'), '---\nexnf: [\n---\n');
    await expect(f.controller.check(f.context)).rejects.toThrow('ownership');
    f.settings.templateExcludePatterns = ['broken.md'];
    expect((await f.controller.check(f.context)).errors).toEqual([]);
    f.list.mockRejectedValueOnce(new Error('enumeration failed'));
    await expect(f.controller.check(f.context)).rejects.toThrow('enumeration');
    f.read.mockRejectedValueOnce(new Error('read denied'));
    await expect(f.controller.check(f.context)).rejects.toThrow('ownership');
  });
  it('resumes after interruption following marker creation without rewriting either file', async () => {
    const f = await fixture();
    const plan = await f.controller.check(f.context);
    const check = f.controller.check.bind(f.controller);
    let checks = 0;
    vi.spyOn(f.controller, 'check').mockImplementation(async (...args) => {
      checks++;
      if (checks === 3) {
        throw new Error('interrupted after marker creation');
      }
      return check(...args);
    });
    await expect(f.controller.execute(plan)).rejects.toThrow('interrupted');
    expect(f.changed).toHaveBeenCalledWith(f.target, null);
    f.controller.dispose();
    const restarted = new MarkerRepairController(f.app, f.host);
    const pending = await restarted.pending();
    expect(pending).toHaveLength(1);
    const journal = pending[0];
    if (!journal) {
      throw new Error('Missing repair journal');
    }
    await writeFile(path.join(f.target, `${uuid}.exnf`), 'preserve interrupted output');
    await writeFile(path.join(f.vault, 'Alpha.md'), 'identity removed');
    await expect(restarted.execute(plan, journal.journalPath)).rejects.toThrow('identity');
    await writeFile(path.join(f.vault, 'Alpha.md'), f.content);
    await restarted.execute(await restarted.check(f.context), journal.journalPath);
    expect(await restarted.pending()).toEqual([]);
    expect(await readFile(path.join(f.target, `${uuid}.exnf`), 'utf8')).toBe('preserve interrupted output');
    expect(await readFile(path.join(f.vault, 'Alpha.md'), 'utf8')).toBe(f.content);
  });
  it('rejects excluded targets, local conflicts, identified reservations and unsafe known locations', async () => {
    const f = await fixture();
    f.settings.externalRootIgnorePatterns = ['Alpha/'];
    expect((await f.controller.check(f.context)).errors.join(' ')).toContain('included directory');
    f.settings.externalRootIgnorePatterns = [];
    await mkdir(path.join(f.target, `${uuid}.exnf`));
    expect((await f.controller.check(f.context)).errors.join(' ')).toContain('regular file');
    await rm(path.join(f.target, `${uuid}.exnf`), { recursive: true });
    await mkdir(path.join(f.vault, 'Alpha'));
    await writeFile(path.join(f.vault, 'Alpha', 'Child.md'), '---\nexnf: invalid\n---\n');
    expect((await f.controller.check(f.context)).errors.join(' ')).toContain('reserves');
    await writeFile(path.join(f.vault, 'Alpha', 'Child.md'), 'ordinary note');
    await writeFile(path.join(f.vault, 'Other.md'), '---\nexnf: invalid\n---\n');
    expect((await f.controller.check(f.context)).errors).toEqual([]);
    const other = path.join(f.external, 'other');
    await writeFile(other, 'not a directory');
    f.context.knownFolders = [other];
    await expect(f.controller.check(f.context)).rejects.toThrow('unsafe');
  });
  it('cancels checks without creating a marker', async () => {
    const f = await fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(f.controller.check(f.context, abort.signal)).rejects.toThrow();
    expect(await readdir(f.target)).not.toContain(`${uuid}.exnf`);
  });
});
