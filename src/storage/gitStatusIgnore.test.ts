import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { buildAuditExportSummary } from '../core/auditExportSummary.ts';
import { finishAuditSteps } from '../core/auditSteps.ts';
import { issueOrderSteps } from '../core/issueNavigation.ts';
import { buildLeafReport } from '../core/leafReport.ts';
import {
  DEFAULT_TREE_QUERY,
  queryTree
} from '../core/leafTree.ts';
import { revealTreePath } from '../core/leafTreeNavigation.ts';
import { scanAdoptionAudit } from './auditScan.ts';
import {
  GitFilteringError,
  GitIgnoreRepository
} from './gitStatusIgnore.ts';

const run = promisify(execFile);
const roots: string[] = [];
const UUID = '11111111-1111-4111-8111-111111111111';
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('exnf-git-status-')) {
      throw new Error('Unexpected cleanup path');
    }
    await rm(root, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
  }
});
async function fixture(): Promise<{ external: string; vault: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'exnf-git-status-'));
  roots.push(root);
  const external = path.join(root, 'external');
  const vault = path.join(root, 'vault');
  await mkdir(external);
  await mkdir(vault);
  await run('git', ['init', external]);
  await run('git', ['-C', external, 'config', 'core.excludesFile', path.join(root, 'global-ignore')]);
  await writeFile(path.join(root, 'global-ignore'), 'global-output/\n');
  return { external, vault };
}
async function put(root: string, name: string, content = ''): Promise<void> {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

// ADR-0034: status exclusions retain unchecked evidence and never narrow mutation scans.
describe('repository-aware status scanning', () => {
  it('records repository roots and nearest containing repositories without requiring Git for unfiltered labels', async () => {
    const { external, vault } = await fixture();
    await put(external, 'app/src/file.txt');
    await run('git', ['init', path.join(external, 'app')]);
    for (const statusScanMode of ['filtered', 'unfiltered'] as const) {
      const scan = await scanAdoptionAudit(vault, external, { statusScanMode });
      expect(scan.repositoryRoots).toEqual(expect.arrayContaining([external, path.join(external, 'app')]));
      const model = buildLeafReport(scan);
      expect(model.tree?.find((node) => node.relativePath === path.join('app', 'src'))?.repositoryRoot).toBe(path.join(external, 'app'));
    }
    vi.stubEnv('PATH', '');
    try {
      const scan = await scanAdoptionAudit(vault, path.join(external, 'app', 'src'), { statusScanMode: 'unfiltered' });
      expect(scan.repositoryRoots).toContain(path.join(external, 'app'));
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('uses nested, global and local rules, preserves tracked descendants and scans included markers', async () => {
    const { external, vault } = await fixture();
    await put(external, '.gitignore', 'output/*\n!output/keep/\ntracked/\n*.exnf\n');
    await put(external, '.git/info/exclude', 'local-output/\n');
    await put(external, 'output/keep/.gitignore', 'nested/\n');
    for (const folder of ['output/drop', 'output/keep/nested', 'output/keep/visible', 'tracked', 'global-output', 'local-output']) {
      await put(external, `${folder}/${UUID}.exnf`);
    }
    await run('git', ['-C', external, 'add', '-f', `tracked/${UUID}.exnf`]);
    const scan = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
    expect(scan.markers.map((marker) => path.relative(external, marker.folderPath).replaceAll('\\', '/')).sort(), JSON.stringify(scan.issues))
      .toEqual(['output/keep/visible', 'tracked']);
    expect(scan.issues.some((issue) => issue.reason.includes('global-ignore'))).toBe(true);
    expect((await scanAdoptionAudit(vault, external, { statusScanMode: 'unfiltered' })).markers).toHaveLength(6);
    expect((await scanAdoptionAudit(vault, external)).markers).toHaveLength(6);
  });

  it('keeps hidden boundaries and inherited coverage without inventing adoptable leaves', async () => {
    const { external, vault } = await fixture();
    await put(external, '.gitignore', 'Parent/ignored/\n');
    await put(external, 'Parent/ignored/deep/Bound/file.txt');
    await put(vault, 'Parent/ignored/deep/Bound.md', `---\nexnf: ${UUID}\n---\n`);
    const model = buildLeafReport(await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' }));
    const parent = model.tree?.find((node) => node.relativePath === 'Parent');
    const expected = model.tree?.find((node) => node.relativePath.endsWith('Bound'));
    expect(parent?.evidence?.physicalLeaf).toBe(false);
    expect(parent?.blocked).toBe(true);
    expect(expected?.unchecked).toBe(true);
    expect(expected?.evidence?.status).not.toBe('Not present in scanned root');
    const query = queryTree(model, { ...DEFAULT_TREE_QUERY, includeExpected: true, search: 'Bound' });
    expect(query.visible.size).toBe(0);
    expect(revealTreePath(query, expected!.id).visible.size).toBe(0);
    expect(finishAuditSteps(issueOrderSteps(query)).ids).toHaveLength(0);
    expect(model.uncheckedBindings?.[0]).toContain('Parent/ignored/deep/Bound.md');
  });

  it('skips broken nested repositories while preserving coverage and healthy siblings', async () => {
    const { external, vault } = await fixture();
    await put(external, 'Parent/broken/.git', 'gitdir: does-not-exist\n');
    await put(external, `Parent/broken/deep/Bound/${UUID}.exnf`);
    await put(vault, 'Parent/broken/deep/Bound.md', `---\nexnf: ${UUID}\n---\n`);
    await put(external, 'second-broken/.git', 'gitdir: also-missing\n');
    const healthy = path.join(external, 'z-healthy');
    await mkdir(healthy);
    await run('git', ['init', healthy]);
    await put(healthy, `included/${UUID}.exnf`);
    const scan = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
    expect(scan.markers.map((marker) => marker.folderPath)).toEqual([path.join(healthy, 'included')]);
    expect(scan.issues.filter((issue) => issue.reason.startsWith('Skipped repository:'))).toHaveLength(2);
    const model = buildLeafReport(scan);
    const parent = model.tree?.find((node) => node.relativePath === 'Parent');
    expect(parent?.evidence?.physicalLeaf).toBe(false);
    expect(parent?.blocked).toBe(true);
    const query = queryTree(model, { ...DEFAULT_TREE_QUERY, includeExpected: true });
    for (const node of model.tree ?? []) {
      if (node.relativePath.includes('broken')) {
        expect(node.unchecked).toBe(true);
        expect(query.visible.has(node.id)).toBe(false);
      }
    }
    expect(model.uncheckedBindings?.[0]).toContain('Parent/broken/deep/Bound.md');
    expect(model.scanSummary).toContain('2 skipped repositories');
    expect(model.scanSummary).toContain('0 unreadable directories');
    const summary = buildAuditExportSummary(model, 'status.csv', model.rows.length);
    expect(summary).toContain('Skipped repository:');
    expect(summary).toContain('Git filtering failed');
    await expect(scanAdoptionAudit(vault, external, { statusScanMode: 'unfiltered' })).resolves.toBeDefined();
  });

  it('keeps broken configured and containing repositories fatal', async () => {
    const { external, vault } = await fixture();
    const broken = path.join(external, 'broken');
    await put(broken, '.git', 'gitdir: does-not-exist\n');
    await mkdir(path.join(broken, 'slice'));
    for (const root of [broken, path.join(broken, 'slice')]) {
      await expect(scanAdoptionAudit(vault, root, { statusScanMode: 'filtered' })).rejects.toThrow('Git filtering failed');
    }
  });

  it('skips an unreadable index before collecting repository markers', async () => {
    const { external, vault } = await fixture();
    const nested = path.join(external, 'bad-index');
    await mkdir(nested);
    await run('git', ['init', nested]);
    await put(nested, '.git/index', 'invalid index');
    await put(nested, `${UUID}.exnf`);
    await put(external, `z-readable/${UUID}.exnf`);
    const scan = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
    expect(scan.issues.filter((issue) => issue.code === 'git-repository-unavailable')).toHaveLength(1);
    expect(scan.markers.map((marker) => marker.folderPath)).toEqual([path.join(external, 'z-readable')]);
  });

  it.each(['query', 'shutdown'])('keeps %s failures fatal after collecting evidence', async (stage) => {
    const { external, vault } = await fixture();
    await put(external, `${UUID}.exnf`);
    await put(external, 'z-child/.git', 'gitdir: does-not-exist\n');
    const method = stage === 'query' ? 'ignores' : 'finish';
    vi.spyOn(GitIgnoreRepository.prototype, method).mockRejectedValue(new GitFilteringError(external, 'runtime failure'));
    await expect(scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' })).rejects.toThrow('runtime failure');
  });
  it('honors full Git syntax and reloads edited rules on each scan', async () => {
    const { external, vault } = await fixture();
    await put(external, '.gitignore', '/anchored/\n**/cache/\nlogs/[ab]?/\n\\#literal/\n\\!literal/\nspace\\ /\n');
    const ignored = ['anchored', 'deep/cache', 'logs/a1', '#literal', '!literal', 'space '];
    for (const folder of [...ignored, 'deep/anchored', 'logs/c1', 'Unicode café']) {
      await put(external, `${folder}/${UUID}.exnf`);
    }
    // Windows normalizes trailing spaces in directory names, so test escaped-space syntax via Git only on POSIX.
    const scan = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
    expect(scan.external.ignoredDirectories.map((entry) => entry.relativePath.replaceAll('\\', '/')))
      .toEqual(expect.arrayContaining(ignored.filter((folder) => folder !== 'space ')));
    expect(scan.markers.some((marker) => marker.folderPath.endsWith(`deep${path.sep}anchored`))).toBe(true);
    await put(external, '.gitignore', 'Unicode café/\n');
    const changed = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
    expect(changed.markers.some((marker) => marker.folderPath.endsWith('anchored'))).toBe(true);
    expect(changed.markers.some((marker) => marker.folderPath.endsWith('Unicode café'))).toBe(false);
  });

  it('uses parent rules for roots inside repositories and isolates nested repositories', async () => {
    const { external, vault } = await fixture();
    await put(external, '.gitignore', 'generated/\n');
    await put(external, 'slice/generated/file');
    await put(external, 'slice/visible/file');
    const inner = await scanAdoptionAudit(vault, path.join(external, 'slice'), { statusScanMode: 'filtered' });
    expect(inner.external.ignoredDirectories.some((entry) => entry.relativePath === 'generated')).toBe(true);
    const nested = path.join(external, 'nested');
    await mkdir(nested);
    await run('git', ['init', nested]);
    await put(nested, '.gitignore', 'own-output/\n');
    await put(nested, `generated/${UUID}.exnf`);
    await put(nested, `own-output/${UUID}.exnf`);
    const scan = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
    expect(scan.markers.map((marker) => marker.folderPath)).toEqual([path.join(nested, 'generated')]);
  });

  it('fails without Git while unfiltered scanning still works', async () => {
    const { external, vault } = await fixture();
    vi.stubEnv('PATH', '');
    try {
      await expect(scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' })).rejects.toThrow('Git filtering failed');
      await expect(scanAdoptionAudit(vault, external, { statusScanMode: 'unfiltered' })).resolves.toBeDefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('supports worktree gitfiles and submodules', async () => {
    const { external, vault } = await fixture();
    await put(external, '.gitignore', 'generated/\n');
    await put(external, 'README.md', 'fixture');
    await run('git', ['-C', external, 'add', 'README.md', '.gitignore']);
    await run('git', [
      '-C',
      external,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture'
    ]);
    const worktree = path.join(path.dirname(external), 'worktree');
    await run('git', ['-C', external, 'worktree', 'add', '--detach', worktree]);
    await put(worktree, `generated/${UUID}.exnf`);
    await put(worktree, `visible/${UUID}.exnf`);
    const worktreeScan = await scanAdoptionAudit(vault, worktree, { statusScanMode: 'filtered' });
    expect(worktreeScan.markers.map((marker) => marker.folderPath)).toEqual([path.join(worktree, 'visible')]);
    expect(worktreeScan.repositoryRoots).toContain(worktree);
    await run('git', ['-C', external, '-c', 'protocol.file.allow=always', 'submodule', 'add', worktree, 'sub']);
    await put(external, `sub/generated/${UUID}.exnf`);
    await put(external, `sub/visible/${UUID}.exnf`);
    const submoduleScan = await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' });
    expect(submoduleScan.markers.map((marker) => marker.folderPath)).toEqual([path.join(external, 'sub/visible')]);
    expect(submoduleScan.repositoryRoots).toContain(path.join(external, 'sub'));
  });

  it('preserves shared exclusions, template scope, and safe link handling in both modes', async () => {
    const { external, vault } = await fixture();
    await put(external, `manual/${UUID}.exnf`);
    await symlink(path.join(external, 'manual'), path.join(external, 'linked'), 'junction');
    await put(vault, 'Template.tpl.md', `---\nexnf: ${UUID}\n---\n`);
    const options = { ignorePatterns: ['manual/'], templateExcludePatterns: ['*.tpl.md'] };
    const filtered = await scanAdoptionAudit(vault, external, { ...options, statusScanMode: 'filtered' });
    expect(filtered.markers).toHaveLength(0);
    expect(filtered.notes).toHaveLength(0);
    const full = await scanAdoptionAudit(vault, external, { ...options, statusScanMode: 'unfiltered' });
    expect(full.markers).toHaveLength(1);
    expect(full.notes).toHaveLength(0);
    const model = buildLeafReport(full);
    const link = model.tree?.find((node) => node.relativePath === 'linked');
    expect(link?.hiddenByCoverage).toBe(true);
    expect(queryTree(model, DEFAULT_TREE_QUERY).visible.has(link!.id)).toBe(false);
  });
});
