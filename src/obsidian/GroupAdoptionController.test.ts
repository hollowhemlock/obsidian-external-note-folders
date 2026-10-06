import type { App } from 'obsidian';

import { execFile } from 'node:child_process';
import {
  existsSync,
  statSync
} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { TFile } from 'obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
// eslint-disable-next-line import-x/no-extraneous-dependencies -- Match the physical audit's existing YAML tooling dependency in adapter tests.
import {
  parse,
  stringify
} from 'yaml';

import type { GroupAdoptionPlan } from '../core/groupAdoption.ts';

import { buildNoteRepair } from '../core/folderRepair.ts';
import { inspectAdoption } from '../storage/adoptionInspection.ts';
import { scanAdoptionAudit } from '../storage/auditScan.ts';
import {
  createGroupJournal,
  readGroupJournal,
  saveGroupJournal
} from '../storage/groupAdoptionJournal.ts';
import { GroupAdoptionController } from './GroupAdoptionController.ts';
import { checkSetupAdoption } from './setupAdoption.ts';

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  parseYaml: (text: string): unknown => parse(text)
}));

describe('folder adoption controller recovery', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
  });

  async function fixture(): Promise<ReturnType<typeof createFixture>> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'exnf-controller-'));
    roots.push(root);
    await mkdir(path.join(root, 'vault'));
    await mkdir(path.join(root, 'external', 'Group'), { recursive: true });
    return createFixture(root);
  }

  it('adopts a project around Git exclusions without inspecting unrelated repositories', async () => {
    const f = await fixture();
    const run = promisify(execFile);
    await run('git', ['init', f.folder]);
    await writeFile(path.join(f.folder, '.gitignore'), 'build/\n.dart_tool/\nwindows/flutter/ephemeral/\n');
    for (const name of ['build', '.dart_tool', 'windows/flutter/ephemeral']) {
      await mkdir(path.join(f.folder, name), { recursive: true });
      await writeFile(path.join(f.folder, name, 'fixture.exnf'), 'ignored fixture');
    }
    const unrelated = path.join(path.dirname(f.folder), 'broken');
    await mkdir(unrelated);
    await writeFile(path.join(unrelated, '.git'), 'gitdir: missing-metadata');
    const preview = await f.controller.preview(f.folder, null, false, new AbortController().signal);
    expect(preview.plan.inspectionPolicy?.omissions).toHaveLength(4);
    await f.controller.execute(preview.plan, preview.content);
    expect(await readdir(f.folder)).toContain(`${preview.plan.uuid}.exnf`);
    expect(await readFile(f.absolute('Group.md'), 'utf8')).toContain(preview.plan.uuid);
  });

  it('blocks overlapping pending adoption before creating a second operation', async () => {
    const f = await fixture();
    const preview = await f.controller.preview(f.folder, null, false, new AbortController().signal);
    f.create.mockRejectedValueOnce(new Error('Interrupted'));
    await expect(f.controller.execute(preview.plan, null)).rejects.toThrow('Interrupted');
    const pending = await f.controller.pending();
    await expect(f.controller.preview(f.folder, null, false, new AbortController().signal)).rejects.toThrow('pending adoption');
    await expect(f.controller.execute(preview.plan, null)).rejects.toThrow('pending adoption');
    expect(await f.controller.pending()).toEqual(pending);
  });

  it('confirms changed omissions and resumes the same operation after marker creation', async () => {
    const f = await fixture();
    await promisify(execFile)('git', ['init', f.folder]);
    await mkdir(path.join(f.folder, 'build'));
    await writeFile(path.join(f.folder, '.gitignore'), 'build/\n');
    const preview = await f.controller.preview(f.folder, null, false, new AbortController().signal);
    f.create.mockRejectedValueOnce(new Error('Interrupted after marker'));
    await expect(f.controller.execute(preview.plan, null)).rejects.toThrow('Interrupted');
    const [file] = await f.controller.pending();
    const before = await readGroupJournal(file!);
    const marker = path.join(f.folder, `${preview.plan.uuid}.exnf`);
    const bytes = await readFile(marker, 'utf8');
    await mkdir(path.join(f.folder, 'dist'));
    await writeFile(path.join(f.folder, '.gitignore'), 'build/\ndist/\n');
    await expect(f.controller.resume(file!)).rejects.toThrow('Excluded locations changed');
    expect(await readGroupJournal(file!)).toEqual(before);
    const checked = await inspectAdoption({
      externalRoot: path.dirname(f.folder),
      ignorePatterns: [],
      knownMarkerPaths: [],
      targets: [f.folder],
      templatePatterns: [],
      vaultRoot: f.absolute('')
    });
    await f.controller.resume(file!, [], checked.inspectionPolicy);
    expect(await readGroupJournal(file!)).toMatchObject({ plan: { inspectionPolicy: checked.inspectionPolicy, uuid: preview.plan.uuid }, stage: 'complete' });
    expect(await readFile(marker, 'utf8')).toBe(bytes);
    expect((await readdir(f.folder)).filter((name) => name.endsWith('.exnf'))).toEqual([`${preview.plan.uuid}.exnf`]);
  });

  it('rechecks known conflicting markers beneath newly excluded directories on resume', async () => {
    const f = await fixture();
    await promisify(execFile)('git', ['init', f.folder]);
    const build = path.join(f.folder, 'build');
    await mkdir(build);
    await writeFile(path.join(f.folder, '.gitignore'), 'build/\n');
    const known = path.join(build, 'malformed.exnf');
    await writeFile(known, 'fixture');
    await expect(f.controller.preview(f.folder, null, false, new AbortController().signal, [known])).rejects.toThrow('Conflicting marker');
    await rm(known);
    const preview = await f.controller.preview(f.folder, null, false, new AbortController().signal, [known]);
    f.create.mockRejectedValueOnce(new Error('Interrupted'));
    await expect(f.controller.execute(preview.plan, null)).rejects.toThrow('Interrupted');
    const [file] = await f.controller.pending();
    await writeFile(known, 'returned');
    await expect(f.controller.resume(file!)).rejects.toThrow('Conflicting marker');
    expect((await readGroupJournal(file!)).plan.inspectionPolicy?.knownMarkerPaths).toEqual([known]);
    await rm(known);
    // A non-directory replacement cannot safely disprove the known evidence.
    await rm(build, { recursive: true });
    await writeFile(build, 'replacement');
    await expect(f.controller.resume(file!)).rejects.toThrow('Unchecked evidence');
  });

  it('keeps ignored targets, included markers, and identified reservations unavailable', async () => {
    const f = await fixture();
    await promisify(execFile)('git', ['init', f.folder]);
    const ignored = path.join(f.folder, 'build');
    await mkdir(ignored);
    await writeFile(path.join(f.folder, '.gitignore'), 'build/\n*.exnf\n');
    await expect(f.controller.preview(ignored, null, false, new AbortController().signal)).rejects.toThrow('Unchecked evidence');
    const marker = path.join(f.folder, 'malformed.exnf');
    await writeFile(marker, '');
    await expect(f.controller.preview(f.folder, null, false, new AbortController().signal)).rejects.toThrow('Conflicting marker');
    await rm(marker);
    await f.addNote('Group/build.md', '---\nexnf: 11111111-1111-4111-8111-111111111111\n---\n');
    await expect(f.controller.preview(f.folder, null, false, new AbortController().signal)).rejects.toThrow('reserves this branch');
  });

  it('blocks included links, tracked markers and required repository failures, while honoring intentional link exclusions', async () => {
    const f = await fixture();
    const run = promisify(execFile);
    await run('git', ['init', f.folder]);
    const sibling = path.join(path.dirname(f.folder), 'unrelated');
    await mkdir(sibling);
    await symlink(sibling, path.join(f.folder, 'linked'), 'junction');
    await expect(f.controller.preview(f.folder, null, false, new AbortController().signal)).rejects.toThrow('Unchecked evidence');
    await writeFile(path.join(f.folder, '.gitignore'), 'linked\nbuild/\n');
    await expect(f.controller.preview(f.folder, null, false, new AbortController().signal)).resolves.toBeDefined();
    await mkdir(path.join(f.folder, 'build'));
    const marker = path.join(f.folder, 'build', '11111111-1111-4111-8111-111111111111.exnf');
    await writeFile(marker, '');
    await run('git', ['-C', f.folder, 'add', '-f', marker]);
    await expect(f.controller.preview(f.folder, null, false, new AbortController().signal)).rejects.toThrow('Conflicting marker');
    const requiredRepo = path.join(sibling, 'broken');
    await mkdir(requiredRepo);
    await writeFile(path.join(requiredRepo, '.git'), 'gitdir: missing');
    await expect(f.controller.preview(requiredRepo, null, false, new AbortController().signal)).rejects.toThrow('Unchecked evidence');
    const abort = new AbortController();
    abort.abort();
    await expect(f.controller.preview(f.folder, null, false, abort.signal)).rejects.toThrow();
    expect(await f.controller.pending()).toEqual([]);
  });

  it('shares setup checks with selected-folder adoption and verifies existing effects after interruption', async () => {
    const f = await fixture();
    await promisify(execFile)('git', ['init', f.folder]);
    await mkdir(path.join(f.folder, 'build'));
    await writeFile(path.join(f.folder, '.gitignore'), 'build/\n');
    await writeFile(path.join(f.folder, 'build', 'ignored.exnf'), '');
    const source = '---\ntitle: Keep\n---\nBody';
    await f.addNote('Group.md', source);
    const input = {
      externalRoot: path.dirname(f.folder),
      ignorePatterns: [],
      knownMarkerPaths: [],
      mutationSequence: 0,
      notePath: 'Group.md',
      templatePatterns: [],
      vaultRoot: f.absolute('')
    };
    const setup = await checkSetupAdoption(f.app, input);
    if (!setup.uuid) {
      throw new Error('Missing planned UUID');
    }
    const selected = await f.controller.preview(f.folder, 'Group.md', false, new AbortController().signal);
    expect(setup.inspectionPolicy).toEqual(selected.plan.inspectionPolicy);
    expect(setup.action).toBe('confirm-unmarked-adoption');
    await writeFile(path.join(f.folder, `${setup.uuid}.exnf`), 'existing bytes');
    await f.writeFrontmatter(noteFile('Group.md'), (metadata) => {
      metadata['exnf'] = setup.uuid;
    });
    const resume = { ...input, resume: true, sourceContent: source, uuid: setup.uuid };
    expect((await checkSetupAdoption(f.app, resume)).uuid).toBe(setup.uuid);
    await f.addNote('Other.md', `---\nexnf: ${setup.uuid}\n---\n`);
    await expect(checkSetupAdoption(f.app, resume)).rejects.toThrow('UUID is already used');
    await f.addNote('Other.md', 'Unassigned');
    await f.addNote('Group.md', source.replace('Body', 'Edited'));
    await expect(checkSetupAdoption(f.app, resume)).rejects.toThrow('Note changed');
    expect(await readFile(path.join(f.folder, `${setup.uuid}.exnf`), 'utf8')).toBe('existing bytes');
  });

  it('moves an already-bound note without changing its marker or UUID', async () => {
    const f = await fixture();
    const uuid = '11111111-1111-4111-8111-111111111111';
    const content = `---\nexnf: ${uuid}\naliases: Keep\n---\nBody`;
    await f.addNote('Old.md', content);
    await writeFile(path.join(f.folder, `${uuid}.exnf`), 'Preserve marker bytes');
    const scan = await scanAdoptionAudit(f.absolute(''), path.dirname(f.folder));
    const plan = buildNoteRepair(scan, f.folder, { aliases: 'Keep', path: 'Old.md' }, 0, []);
    expect(await readFile(f.absolute('Old.md'), 'utf8')).toBe(content);
    await f.controller.execute(plan, content);
    expect(await readFile(f.absolute('Group.md'), 'utf8')).toContain(uuid);
    expect(await readFile(f.absolute('Group.md'), 'utf8')).toContain('Keep');
    expect(await readFile(path.join(f.folder, `${uuid}.exnf`), 'utf8')).toBe('Preserve marker bytes');
    expect(await f.controller.pending()).toEqual([]);
  });

  it('adopts with malformed templates excluded but keeps ordinary malformed notes blocking', async () => {
    const f = await fixture();
    const malformed = '---\nvalue: [\n---\n';
    await f.addNote('Draft.tpl.md', malformed);
    f.templatePatterns.push('*.tpl.md');
    const preview = await f.controller.preview(f.folder, null, false, new AbortController().signal);
    await expect(f.controller.preview(f.folder, 'Draft.tpl.md', false, new AbortController().signal)).rejects.toThrow('excluded');
    await f.addNote('Ordinary.md', malformed);
    await expect(f.controller.execute(preview.plan, preview.content)).rejects.toThrow('Unchecked evidence');
    expect(await readdir(f.folder)).toEqual([]);
    await f.addNote('Ordinary.md', 'Ordinary note');
    await f.controller.execute(preview.plan, preview.content);
    expect(await readFile(f.absolute('Draft.tpl.md'), 'utf8')).toBe(malformed);
    expect(await readdir(f.folder)).toContain(`${preview.plan.uuid}.exnf`);
  });

  it('rejects template-scope changes between preview, execution, and recovery', async () => {
    const f = await fixture();
    const { file, plan } = await f.prepare(null);
    f.templatePatterns.push('*.tpl.md');
    await expect(f.controller.execute(plan, null)).rejects.toThrow('changed');
    await expect(f.controller.resume(file)).rejects.toThrow('Excluded locations changed');
    expect(await readdir(f.folder)).toEqual([]);
    f.templatePatterns.splice(0);
    await f.controller.resume(file);
    expect((await readGroupJournal(file)).stage).toBe('complete');
  });

  it('distinguishes a rejected preflight from an interrupted journaled operation', async () => {
    const f = await fixture();
    const preview = await f.controller.preview(f.folder, null, false, new AbortController().signal);
    const rejected = await f.controller.executeForDialog({ ...preview.plan, mutationSequence: 1 }, preview.content);
    expect(rejected.kind).toBe('retry');
    expect(await f.controller.pending()).toEqual([]);
    expect(await readdir(f.folder)).toEqual([]);
    f.create.mockRejectedValueOnce(new Error('Interrupted creation'));
    const pending = await f.controller.executeForDialog(preview.plan, preview.content);
    expect(pending.kind).toBe('pending');
    if (pending.kind === 'pending') {
      expect(await f.controller.pending()).toContain(pending.journal);
      await f.controller.resume(pending.journal);
      expect((await readGroupJournal(pending.journal)).stage).toBe('complete');
    }
  });

  it.each(['\uFEFF---\naliases: KeepAlias\n---\nBody', '---\naliases: KeepAlias\n--- \t\nBody'])(
    'preserves aliases in scanner-supported frontmatter: %j',
    async (content) => {
      const f = await fixture();
      await f.addNote('Old.md', content);
      const preview = await f.controller.preview(f.folder, 'Old.md', true, new AbortController().signal);
      expect(preview.plan.aliases).toEqual(['KeepAlias', 'Old']);
    }
  );

  it.each([false, true])('rejects a directory at the destination before resumed writes (move: %j)', async (move) => {
    const f = await fixture();
    await f.addNote('Old.md', 'Original');
    const preview = await f.controller.preview(f.folder, move ? 'Old.md' : null, move, new AbortController().signal);
    const file = await createGroupJournal(path.join(path.dirname(f.folder), 'journals'), preview.plan, preview.content);
    await mkdir(f.absolute(preview.plan.notePath));

    await expect(f.controller.resume(file)).rejects.toThrow('Destination exists');

    expect(await readdir(f.folder)).toEqual([]);
    expect(await readFile(f.absolute('Old.md'), 'utf8')).toBe('Original');
    expect(f.processFrontMatter).not.toHaveBeenCalled();
    expect((await readGroupJournal(file)).stage).toBe('marker');
  });

  it('allows verification to resume with an already-relocated note', async () => {
    const f = await fixture();
    await f.addNote('Old.md', 'Original');
    const preview = await f.controller.preview(f.folder, 'Old.md', true, new AbortController().signal);
    const file = await createGroupJournal(path.join(path.dirname(f.folder), 'journals'), preview.plan, preview.content);
    await writeFile(path.join(f.folder, `${preview.plan.uuid}.exnf`), '');
    await f.writeFrontmatter(noteFile('Old.md'), (metadata) => {
      metadata['exnf'] = preview.plan.uuid;
      metadata['aliases'] = preview.plan.aliases;
    });
    await rename(f.absolute('Old.md'), f.absolute(preview.plan.notePath));
    const journal = await readGroupJournal(file);
    journal.stage = 'verify';
    await saveGroupJournal(file, journal);

    await f.controller.resume(file);

    expect((await readGroupJournal(file)).stage).toBe('complete');
    expect(f.renameFile).not.toHaveBeenCalled();
    expect(f.processFrontMatter).not.toHaveBeenCalled();
  });

  it('rejects edited source content before writing a marker', async () => {
    const f = await fixture();
    await f.addNote('Note.md', 'Original');
    const pending = await f.prepare('Note.md');
    await f.addNote('Note.md', 'User edit');

    await expect(f.controller.resume(pending.file)).rejects.toThrow('Note changed since confirmation');

    expect(await readdir(f.folder)).toEqual([]);
    expect(await readFile(f.absolute('Note.md'), 'utf8')).toBe('User edit');
    expect(await readGroupJournal(pending.file)).toMatchObject({ attempted: false, stage: 'marker' });
    expect(f.processFrontMatter).not.toHaveBeenCalled();
  });

  it('rejects a missing source before writing a marker', async () => {
    const f = await fixture();
    await f.addNote('Note.md', 'Original');
    const pending = await f.prepare('Note.md');
    await rename(f.absolute('Note.md'), f.absolute('Elsewhere.md'));

    await expect(f.controller.resume(pending.file)).rejects.toThrow('Note changed since confirmation');
    expect(await readdir(f.folder)).toEqual([]);
  });

  it('rejects a newly occupied note destination before writing a marker', async () => {
    const f = await fixture();
    const pending = await f.prepare(null);
    await f.addNote(pending.plan.notePath, 'Unrelated note');

    await expect(f.controller.resume(pending.file)).rejects.toThrow('Note changed since confirmation');
    expect(await readdir(f.folder)).toEqual([]);
    expect(await readFile(f.absolute(pending.plan.notePath), 'utf8')).toBe('Unrelated note');
  });

  it('requires fresh acknowledgment for added descendants and journals it before writes', async () => {
    const f = await fixture();
    const pending = await f.prepare(null);
    await f.addNote('Group/Child.md', 'Child content');

    await expect(f.controller.resume(pending.file)).rejects.toThrow('Additional descendant notes require acknowledgment');
    expect(await readdir(f.folder)).toEqual([]);
    expect((await readGroupJournal(pending.file)).plan.descendants).toEqual([]);

    // The displayed list becomes stale while the user is reviewing it.
    await f.addNote('Group/Another.md', 'Another child');
    await expect(f.controller.resume(pending.file, ['Group/Child.md'])).rejects.toThrow('Group/Another.md');
    expect(await readdir(f.folder)).toEqual([]);

    f.create.mockImplementationOnce(async (relative, content) => {
      const saved = await readGroupJournal(pending.file);
      expect(saved.plan.descendants).toEqual(['Group/Another.md', 'Group/Child.md']);
      expect(saved.stage).toBe('note');
      await writeFile(f.absolute(relative), content, { flag: 'wx' });
      return noteFile(relative);
    });
    await f.controller.resume(pending.file, ['Group/Child.md', 'Group/Another.md']);

    expect((await readGroupJournal(pending.file)).stage).toBe('complete');
    expect(await readFile(f.absolute('Group/Child.md'), 'utf8')).toBe('Child content');
    expect(await readFile(f.absolute('Group/Another.md'), 'utf8')).toBe('Another child');
  });

  it('retains previous descendant acknowledgment when resuming an interrupted note creation', async () => {
    const f = await fixture();
    await f.addNote('Group/Child.md', 'Child content');
    const preview = await f.controller.preview(f.folder, null, false, new AbortController().signal);
    f.create.mockRejectedValueOnce(new Error('Interrupted before creating the note'));
    await expect(f.controller.execute(preview.plan, preview.content)).rejects.toThrow('Interrupted');
    const [file] = await f.controller.pending();

    await f.controller.resume(file!);

    expect((await readGroupJournal(file!)).stage).toBe('complete');
    expect(await readFile(f.absolute('Group/Child.md'), 'utf8')).toBe('Child content');
  });

  it.each([
    '---\n---\nBody\n',
    '---\r\n---\r\nBody\r\n',
    '---\n---',
    'Body\n',
    '\uFEFF---\naliases: KeepAlias\n---\nBody\n',
    '---\naliases: KeepAlias\n--- \t\nBody\n',
    '---\naliases: Existing alias\ntitle: Keep title\n---\nBody\n'
  ])('resumes an interrupted frontmatter effect without rewriting the note: %j', async (sourceContent) => {
    const f = await fixture();
    await f.addNote('Note.md', sourceContent);
    const preview = await f.controller.preview(f.folder, 'Note.md', false, new AbortController().signal);
    f.processFrontMatter.mockImplementationOnce(async (file, update) => {
      await f.writeFrontmatter(file, update);
      throw new Error('Interrupted after writing frontmatter');
    });
    await expect(f.controller.execute(preview.plan, preview.content)).rejects.toThrow('Interrupted');
    const [file] = await f.controller.pending();
    const prepared = await readFile(f.absolute('Note.md'), 'utf8');
    expect(await readGroupJournal(file!)).toMatchObject({ attempted: true, preparedContent: null, stage: 'note' });

    await f.controller.resume(file!);

    expect((await readGroupJournal(file!)).stage).toBe('complete');
    expect(await readFile(f.absolute('Note.md'), 'utf8')).toBe(prepared);
    expect(f.processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it('does not mistake an edited body for the interrupted frontmatter effect', async () => {
    const f = await fixture();
    await f.addNote('Note.md', '---\n---\nOriginal body');
    const preview = await f.controller.preview(f.folder, 'Note.md', false, new AbortController().signal);
    f.processFrontMatter.mockImplementationOnce(async (file, update) => {
      await f.writeFrontmatter(file, update);
      throw new Error('Interrupted after writing frontmatter');
    });
    await expect(f.controller.execute(preview.plan, preview.content)).rejects.toThrow('Interrupted');
    const [file] = await f.controller.pending();
    const edited = (await readFile(f.absolute('Note.md'), 'utf8')).replace('Original body', 'User edit');
    await f.addNote('Note.md', edited);

    await expect(f.controller.resume(file!)).rejects.toThrow('Note changed since confirmation');
    expect(await readFile(f.absolute('Note.md'), 'utf8')).toBe(edited);
    expect((await readGroupJournal(file!)).stage).toBe('note');
  });

  it('allows link updates made by a completed Obsidian rename', async () => {
    const f = await fixture();
    await f.addNote('Old.md', '---\naliases: Existing alias\n---\n[[Old]]');
    const preview = await f.controller.preview(f.folder, 'Old.md', true, new AbortController().signal);
    f.renameFile.mockImplementationOnce(async (file, destination) => {
      const content = await readFile(f.absolute(file.path), 'utf8');
      await writeFile(f.absolute(file.path), content.replace('[[Old]]', '[[Group]]'));
      await rename(f.absolute(file.path), f.absolute(destination));
    });

    await f.controller.execute(preview.plan, preview.content);

    expect(await f.controller.pending()).toEqual([]);
    expect(await readFile(f.absolute('Group.md'), 'utf8')).toContain('[[Group]]');
    expect(await readFile(f.absolute('Group.md'), 'utf8')).toContain('Existing alias');
  });
});

function createFixture(root: string): {
  absolute: (relative: string) => string;
  addNote: (relative: string, content: string) => Promise<void>;
  app: App;
  controller: GroupAdoptionController;
  create: ReturnType<typeof vi.fn<(relative: string, content: string) => Promise<TFile>>>;
  folder: string;
  prepare: (source: null | string) => Promise<{ file: string; plan: GroupAdoptionPlan }>;
  processFrontMatter: ReturnType<typeof vi.fn<(file: TFile, update: (metadata: Record<string, unknown>) => void) => Promise<void>>>;
  renameFile: ReturnType<typeof vi.fn<(file: TFile, destination: string) => Promise<void>>>;
  templatePatterns: string[];
  writeFrontmatter: (file: TFile, update: (metadata: Record<string, unknown>) => void) => Promise<void>;
} {
  const vaultRoot = path.join(root, 'vault');
  const externalRoot = path.join(root, 'external');
  const folder = path.join(externalRoot, 'Group');
  function absolute(relative: string): string {
    return path.join(vaultRoot, relative);
  }
  async function addNote(relative: string, content: string): Promise<void> {
    await mkdir(path.dirname(absolute(relative)), { recursive: true });
    await writeFile(absolute(relative), content);
  }
  const create = vi.fn(async (relative: string, content: string): Promise<TFile> => {
    await writeFile(absolute(relative), content, { flag: 'wx' });
    return noteFile(relative);
  });
  async function writeFrontmatter(file: TFile, update: (metadata: Record<string, unknown>) => void): Promise<void> {
    const content = await readFile(absolute(file.path), 'utf8');
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.replace(/^\uFEFF/u, '').split(/\r?\n/u);
    const end = lines[0] === '---' ? lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/u.test(line)) : -1;
    const metadata = (end >= 0 ? parse(lines.slice(1, end).join('\n')) ?? {} : {}) as Record<string, unknown>;
    update(metadata);
    const body = end >= 0 ? lines.slice(end + 1).join(newline) : content;
    await writeFile(absolute(file.path), `---${newline}${stringify(metadata).replaceAll('\n', newline)}---${newline}${body}`);
  }
  const processFrontMatter = vi.fn(writeFrontmatter);
  const renameFile = vi.fn(async (file: TFile, destination: string): Promise<void> => rename(absolute(file.path), absolute(destination)));
  const app = {
    fileManager: { processFrontMatter, renameFile },
    vault: {
      adapter: {
        exists: async (relative: string): Promise<boolean> => existsSync(absolute(relative)),
        getBasePath: (): string => vaultRoot,
        read: async (relative: string): Promise<string> => readFile(absolute(relative), 'utf8')
      },
      configDir: 'config',
      create,
      createFolder: async (relative: string): Promise<void> => mkdir(absolute(relative)),
      getAbstractFileByPath: (relative: string): null | TFile =>
        existsSync(absolute(relative)) && statSync(absolute(relative)).isFile() ? noteFile(relative) : null,
      read: async (file: TFile): Promise<string> => readFile(absolute(file.path), 'utf8')
    }
  } as unknown as App;
  const templatePatterns: string[] = [];
  const controller = new GroupAdoptionController(app, 'review', {
    changed: vi.fn<() => void>(),
    mutate: async (operation): Promise<void> => operation(),
    sequence: (): number => 0,
    settings: (): { externalRootIgnorePatterns: string[]; externalRootPath: string; templateExcludePatterns: string[] } => ({
      externalRootIgnorePatterns: [],
      externalRootPath: externalRoot,
      templateExcludePatterns: templatePatterns
    })
  });
  async function prepare(source: null | string): Promise<{ file: string; plan: GroupAdoptionPlan }> {
    const preview = await controller.preview(folder, source, false, new AbortController().signal);
    const file = await createGroupJournal(path.join(root, 'journals'), preview.plan, preview.content);
    return { file, plan: preview.plan };
  }
  return { absolute, addNote, app, controller, create, folder, prepare, processFrontMatter, renameFile, templatePatterns, writeFrontmatter };
}

function noteFile(relative: string): TFile {
  const file = new TFile();
  file.path = relative;
  return file;
}
