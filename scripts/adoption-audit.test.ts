import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  buildAuditReports,
  serializeAuditCsv,
  writeAuditReports
} from './adoption-audit-report.ts';
import { scanAdoptionAudit } from './adoption-audit-scan.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_UUID = '223e4567-e89b-42d3-a456-426614174000';
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('exnf-audit-test-')) {
      throw new Error('Unexpected cleanup path');
    }
    await rm(root, { force: true, recursive: true });
  }
});

async function fixture(): Promise<{ external: string; root: string; vault: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'exnf-audit-test-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  const external = path.join(root, 'external');
  await mkdir(vault);
  await mkdir(external);
  return { external, root, vault };
}

function note(uuid = UUID): string {
  return `---\nexnf: ${uuid}\n---\n`;
}

async function put(root: string, name: string, content = ''): Promise<void> {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await snapshot(target));
    } else {
      result[target] = createHash('sha256').update(await readFile(target)).digest('hex');
    }
  }
  return result;
}

describe('standalone adoption audit', () => {
  it('reports bindings, folder notes, drift and legacy formats without modifying source files', async () => {
    const { external, root, vault } = await fixture();
    await put(vault, 'Alpha/Alpha.md', note());
    await put(vault, 'Moved.md', note(OTHER_UUID));
    await put(external, `Alpha/${UUID}.exnf`, 'canonical contents are deliberately ignored');
    await put(external, 'Elsewhere/.exnf', `${OTHER_UUID}\n`);
    const beforeVault = await snapshot(vault);
    const beforeExternal = await snapshot(external);
    const reports = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(reports.complete).toBe(true);
    expect(reports.tables['correctly-adopted.csv']?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ actualFolder: path.join(external, 'Alpha'), notePath: path.join(vault, 'Alpha/Alpha.md'), pathDrift: 'false' }),
      expect.objectContaining({ pathDrift: 'true', uuid: OTHER_UUID })
    ]));
    expect(reports.tables['possibly-missing.csv']?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'legacy-migration' }),
      expect.objectContaining({ category: 'path-drift' })
    ]));
    const output = await writeAuditReports(reports, path.join(root, 'reports'));
    expect(await readdir(output)).toHaveLength(8);
    expect(await snapshot(vault)).toEqual(beforeVault);
    expect(await snapshot(external)).toEqual(beforeExternal);
    expect(await writeAuditReports(reports, path.join(root, 'reports'))).not.toBe(output);
  });

  it('parses YAML properties, empty values and quoted keys without counting bodies or nested keys', async () => {
    const { external, vault } = await fixture();
    await put(vault, 'quoted.md', `\uFEFF---\r\n"exnf": '${UUID}' # identity\r\n---\r\n`);
    await put(vault, 'body.md', `Text\n${note()}`);
    await put(vault, 'nested.md', `---\nparent:\n  exnf: ${UUID}\n---\n`);
    await put(vault, 'empty.md', '---\nexnf:\n---\n');
    await put(vault, 'array.md', '---\nexnf: [one, two]\n---\n');
    await put(vault, 'empty-frontmatter.md', '---\n---\n');
    const scan = await scanAdoptionAudit(vault, external);
    expect(scan.notes).toHaveLength(6);
    expect(scan.notes.filter((item) => item.hasExnf)).toHaveLength(3);
    expect(scan.notes.find((item) => item.notePath.endsWith('quoted.md'))?.uuid).toBe(UUID);
    expect(scan.notes.find((item) => item.notePath.endsWith('empty.md'))?.status).toBe('invalid-property');
    expect(scan.issues.filter((issue) => issue.unchecked)).toEqual([]);
  });

  it('reports missing counterparts and uses deepest exact adoption candidates', async () => {
    const { external, vault } = await fixture();
    await put(vault, 'Missing.md', note());
    await put(vault, 'Parent.md');
    await put(vault, 'Parent/Child.md');
    await put(vault, 'Ordinary.md');
    await put(external, `Orphan/${OTHER_UUID}.exnf`);
    await mkdir(path.join(external, 'Parent/Child'), { recursive: true });
    const reports = buildAuditReports(await scanAdoptionAudit(vault, external));
    const rows = reports.tables['possibly-missing.csv']?.rows ?? [];
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'missing-external-marker', uuid: UUID }),
      expect.objectContaining({ category: 'missing-note', uuid: OTHER_UUID }),
      expect.objectContaining({ category: 'adoption-candidate', location: path.join(vault, 'Parent/Child.md') }),
      expect.objectContaining({ category: 'adoption-not-selected', location: path.join(vault, 'Parent.md') }),
      expect.objectContaining({ category: 'unassigned-note', location: path.join(vault, 'Ordinary.md') })
    ]));
    expect(rows.filter((row) => row['category'] === 'adoption-candidate')).toHaveLength(1);
  });

  it('excludes duplicate identities and conflicting folders from confirmed bindings', async () => {
    const { external, vault } = await fixture();
    await put(vault, 'A.md', note());
    await put(vault, 'B.md', note());
    await put(vault, 'C.md', note(OTHER_UUID));
    await put(external, `A/${UUID}.exnf`);
    await put(external, `B/${UUID}.exnf`);
    await put(external, `C/${OTHER_UUID}.exnf`);
    await put(external, 'C/invalid.exnf');
    const reports = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(reports.tables['correctly-adopted.csv']?.rows).toEqual([]);
    expect(reports.tables['possibly-missing.csv']?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'duplicate-note-uuid' }),
      expect.objectContaining({ category: 'duplicate-folder-uuid' }),
      expect.objectContaining({ category: 'ambiguous-binding', uuid: OTHER_UUID })
    ]));
  });

  it('rejects YAML duplicate keys and makes otherwise valid matches provisional', async () => {
    const { external, vault } = await fixture();
    await put(vault, 'Good.md', note());
    await put(external, `Moved/${UUID}.exnf`);
    await put(vault, 'Bad.md', `---\nexnf: ${UUID}\nexnf: ${OTHER_UUID}\n---\n`);
    const reports = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(reports.complete).toBe(false);
    expect(reports.tables['correctly-adopted.csv']?.rows).toEqual([]);
    expect(reports.tables['possibly-missing.csv']?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'provisional-binding', confidence: 'provisional' }),
      expect.objectContaining({ category: 'path-drift', confidence: 'provisional', relatedPath: path.join(external, 'Moved') }),
      expect.objectContaining({ category: 'unchecked' })
    ]));
  });

  it('reports missing roots and skips junctions without following them', async () => {
    const { external, root, vault } = await fixture();
    await put(vault, 'Good.md', note());
    await put(external, `Good/${UUID}.exnf`);
    await symlink(external, path.join(external, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
    const scan = await scanAdoptionAudit(vault, external);
    expect(scan.markers).toHaveLength(1);
    expect(scan.issues).toEqual(expect.arrayContaining([expect.objectContaining({ location: path.join(external, 'loop'), unchecked: true })]));
    expect(buildAuditReports(scan).complete).toBe(false);
    const missing = buildAuditReports(await scanAdoptionAudit(vault, path.join(root, 'missing')));
    expect(missing.complete).toBe(false);
    expect(missing.tables['possibly-missing.csv']?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'missing-external-marker', confidence: 'provisional' })
    ]));
  });

  it('escapes CSV commas, quotes, Unicode and newlines, and sorts deterministically', () => {
    expect(serializeAuditCsv({ columns: ['value'], rows: [{ value: 'z' }, { value: 'a,"雪"\nline' }] }))
      .toBe('\uFEFF"value"\r\n"a,""雪""\nline"\r\n"z"\r\n');
  });

  it('blocks adoption beneath a marked ancestor and rejects multiple identities in one folder', async () => {
    const { external, vault } = await fixture();
    await put(vault, 'Parent.md', note());
    await put(vault, 'Parent/Child.md');
    await put(external, `Parent/${UUID}.exnf`);
    await mkdir(path.join(external, 'Parent/Child'), { recursive: true });
    const nested = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(nested.tables['possibly-missing.csv']?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'adoption-blocked', location: path.join(vault, 'Parent/Child.md') })
    ]));
    await put(external, `Parent/${OTHER_UUID}.exnf`);
    const conflict = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(conflict.tables['correctly-adopted.csv']?.rows).toEqual([]);
    expect(conflict.tables['possibly-missing.csv']?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'ambiguous-binding', uuid: UUID })
    ]));
  });

  it('inventories hidden paths, root markers and uppercase extensions while preserving strict identities', async () => {
    const { external, vault } = await fixture();
    await put(vault, '.hidden/Note.MD', note());
    await put(vault, 'Invalid.md', note(UUID.toUpperCase()));
    await put(external, `${UUID}.exnf`);
    await put(external, '.hidden/BAD.EXNF');
    const scan = await scanAdoptionAudit(vault, external);
    expect(scan.notes).toHaveLength(2);
    expect(scan.markers).toHaveLength(2);
    expect(scan.notes.find((item) => item.notePath.endsWith('Invalid.md'))?.status).toBe('invalid-property');
    expect(scan.markers.find((item) => item.markerPath.endsWith('BAD.EXNF'))?.status).toBe('invalid-marker');
    expect(scan.external.bindings.get(UUID)).toBe(external);
    expect(scan.folders).not.toContain(external);
  });

  it('accepts same-UUID legacy and canonical markers in one folder without inventing duplicate bindings', async () => {
    const { external, vault } = await fixture();
    await put(vault, 'A.md', note());
    await put(external, `A/${UUID}.exnf`);
    await put(external, 'A/.exnf', UUID);
    const reports = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(reports.tables['correctly-adopted.csv']?.rows).toHaveLength(1);
    expect(reports.tables['possibly-missing.csv']?.rows.map((row) => row['category'])).toEqual(['legacy-migration']);
  });

  it('lists only leaves whose entire path from the external root contains no marker files', async () => {
    const { external, vault } = await fixture();
    await put(external, 'Clear/Leaf/content.txt');
    await mkdir(path.join(external, 'Empty'));
    await put(external, `Marked/${UUID}.exnf`);
    await mkdir(path.join(external, 'Marked/Child'), { recursive: true });
    await put(external, 'Legacy/.exnf', 'malformed contents still count as a marker');
    await mkdir(path.join(external, 'Legacy/Child'), { recursive: true });
    await put(external, 'BadLeaf/not-a-uuid.EXNF');
    // A marker in a sibling branch does not disqualify Clear/Leaf.
    await put(external, 'Clear/Sibling/.exnf', UUID);
    const reports = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(reports.tables['unmarked-leaf-folders.csv']?.rows).toEqual([
      { folderPath: path.join(external, 'Clear/Leaf'), relativePath: path.join('Clear', 'Leaf') },
      { folderPath: path.join(external, 'Empty'), relativePath: 'Empty' }
    ]);
    await put(external, `${OTHER_UUID}.exnf`);
    const rootMarked = buildAuditReports(await scanAdoptionAudit(vault, external));
    expect(rootMarked.tables['unmarked-leaf-folders.csv']?.rows).toEqual([]);
  });

  it('excludes uncertain leaves without discarding unrelated checked branches', async () => {
    const { external, vault } = await fixture();
    await mkdir(path.join(external, 'Checked'));
    await mkdir(path.join(external, 'Unknown'));
    await mkdir(path.join(external, 'WithLink'));
    await symlink(external, path.join(external, 'WithLink/child'), process.platform === 'win32' ? 'junction' : 'dir');
    await put(vault, 'Bad.md', '---\nexnf: [\n---\n');
    const scan = await scanAdoptionAudit(vault, external);
    scan.external.skippedDirectories.push({ location: path.join(external, 'Unknown'), message: 'Directory could not be read.' });
    const reports = buildAuditReports(scan);
    expect(reports.complete).toBe(false);
    expect(reports.tables['unmarked-leaf-folders.csv']?.rows).toEqual([
      { folderPath: path.join(external, 'Checked'), relativePath: 'Checked' }
    ]);
    scan.external.skippedDirectories.push({ location: path.join(external, 'linked.exnf'), message: 'Marker link was not followed.' });
    expect(buildAuditReports(scan).tables['unmarked-leaf-folders.csv']?.rows).toEqual([]);
  });
});
