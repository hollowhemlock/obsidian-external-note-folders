import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import {
  buildExternalRepair,
  buildNoteRepair
} from './folderRepair.ts';
import { folderStatusTable } from './folderStatusCsv.ts';
import { buildLeafReport } from './leafReport.ts';
import {
  DEFAULT_TREE_QUERY,
  queryTree
} from './leafTree.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
function fixture(notePath = 'Elsewhere.md'): { folder: string; scan: ReturnType<typeof auditFixture> } {
  const scan = auditFixture();
  const folder = path.join(scan.externalRoot, 'Folder');
  scan.folders.push(folder);
  scan.notes.push({ hasExnf: true, notePath: path.join(scan.vaultRoot, notePath), relativePath: notePath, status: 'valid', uuid: UUID, value: UUID });
  scan.markers.push({ folderPath: folder, format: 'uuid-named', markerPath: path.join(folder, `${UUID}.exnf`), status: 'valid', uuid: UUID });
  scan.vault.bindings.set(UUID, notePath);
  scan.external.bindings.set(UUID, folder);
  return { folder, scan };
}
describe('folder status evidence', () => {
  it.each([
    ['valid', true, false, 'Contains bound subfolders'],
    ['valid', false, false, 'Contains descendant markers'],
    ['invalid-marker', false, false, 'Contains descendant markers'],
    ['unchecked-marker', false, true, 'Contains descendant markers'],
    ['valid', true, true, 'Contains descendant markers']
  ])('describes containers with %s descendants, associated=%s, incomplete=%s', (markerStatus, associated, incomplete, expected) => {
    const { scan } = fixture('Container/deep/Folder.md');
    const folderPath = path.join(scan.externalRoot, 'Container/deep/Folder');
    scan.folders = [folderPath, path.join(scan.externalRoot, 'Ordinary')];
    scan.markers[0] = {
      folderPath,
      format: 'uuid-named',
      markerPath: path.join(folderPath, `${UUID}.exnf`),
      status: markerStatus,
      uuid: markerStatus === 'valid' ? UUID : ''
    };
    scan.external.bindings.set(UUID, folderPath);
    if (!associated) {
      scan.notes = [];
    }
    if (incomplete) {
      const gap = path.join(scan.externalRoot, 'Gap');
      scan.folders.push(gap);
      scan.issues.push({ kind: 'directory', location: gap, reason: 'Unreadable', scope: 'external', unchecked: true });
    }
    const model = buildLeafReport(scan);
    const parent = model.tree?.find((node) => node.relativePath === 'Container');
    expect(parent?.evidence).toMatchObject({
      descendants: { boundFolders: associated && !incomplete ? 1 : 0, markedFolders: 1 },
      marker: 'absent',
      status: expected
    });
    expect(parent?.blocked).toBe(true);
    expect(parent?.evidence?.explanations.join(' ')).toContain('It can remain an ordinary container');
    expect(model.tree?.find((node) => node.relativePath === 'Ordinary')?.evidence?.status).toBe('Unassigned folder');
    const filtered = queryTree(model, { ...DEFAULT_TREE_QUERY, status: expected });
    expect(filtered.matched.has(parent!.id)).toBe(true);
    expect(folderStatusTable([parent!]).rows[0]?.['explanation']).toContain('cannot be adopted as a whole');
    expect(model.rootFolder?.evidence?.descendants?.markedFolders).toBe(1);
  });
  it('keeps identified parents in missing-marker results above bound descendants', () => {
    const { scan } = fixture('Folder/Child.md');
    const child = path.join(scan.externalRoot, 'Folder/Child');
    const parentUuid = '22222222-2222-4222-8222-222222222222';
    scan.folders.push(child);
    scan.markers[0]!.folderPath = child;
    scan.markers[0]!.markerPath = path.join(child, `${UUID}.exnf`);
    scan.external.bindings.set(UUID, child);
    scan.notes.push({
      hasExnf: true,
      notePath: path.join(scan.vaultRoot, 'Folder.md'),
      relativePath: 'Folder.md',
      status: 'valid',
      uuid: parentUuid,
      value: parentUuid
    });
    scan.vault.bindings.set(parentUuid, 'Folder.md');
    const model = buildLeafReport(scan);
    const parent = model.tree!.find((node) => node.relativePath === 'Folder')!;
    expect(parent.evidence).toMatchObject({
      descendants: { boundFolders: 1, markedFolders: 1 },
      exact: 'present',
      marker: 'absent',
      status: 'Marker absent here',
      yaml: 'present'
    });
    expect(parent.blocked).toBe(true);
    const filtered = queryTree(model, { ...DEFAULT_TREE_QUERY, status: 'Marker absent here' });
    expect(filtered.matched.has(parent.id)).toBe(true);
    const exported = folderStatusTable([parent]).rows[0];
    expect(exported?.['status']).toBe('Marker absent here');
    expect(exported?.['explanation']).toContain('including 1 confirmed binding');
  });
  it('preserves local identity problems above bound descendants', () => {
    const { scan } = fixture('Folder/Child.md');
    const child = path.join(scan.externalRoot, 'Folder/Child');
    scan.folders.push(child);
    scan.markers[0]!.folderPath = child;
    scan.markers[0]!.markerPath = path.join(child, `${UUID}.exnf`);
    scan.notes.push({
      hasExnf: true,
      notePath: path.join(scan.vaultRoot, 'Folder.md'),
      relativePath: 'Folder.md',
      status: 'invalid-property',
      uuid: '',
      value: 'bad'
    });
    const parent = buildLeafReport(scan).tree?.find((node) => node.relativePath === 'Folder');
    expect(parent?.evidence?.status).toBe('Ambiguous or invalid evidence');
    expect(parent?.evidence?.descendants).toEqual({ boundFolders: 1, markedFolders: 1 });
  });
  it.each([
    ['valid', 'Bound at expected path'],
    ['missing-property', 'No matching note identity'],
    ['invalid-property', 'Ambiguous or invalid evidence'],
    ['unchecked-frontmatter', 'Unchecked']
  ])('classifies exact notes with %s frontmatter as %s', (noteStatus, expectedStatus) => {
    const { folder, scan } = fixture('Folder.md');
    const note = scan.notes[0];
    if (note && noteStatus !== 'valid') {
      note.status = noteStatus;
      note.uuid = '';
    }
    expect(buildLeafReport(scan).tree?.find((row) => row.folderPath === folder)?.evidence?.status).toBe(expectedStatus);
  });
  it('does not turn unreadable root evidence into absent expected paths', () => {
    const { scan } = fixture();
    scan.folders = [];
    scan.markers = [];
    scan.external.accessErrors.push({ location: scan.externalRoot, message: 'Unreadable root' });
    scan.issues.push({ location: scan.externalRoot, reason: 'Unreadable root', unchecked: true });
    const expected = buildLeafReport(scan).tree?.find((row) => row.kind === 'virtual');
    expect(expected?.evidence?.status).toBe('Unchecked');
    expect(expected?.evidence?.marker).toBe('unchecked');
  });
  it('keeps malformed markers and duplicate identities separate from confirmed bindings', () => {
    const { folder, scan } = fixture('Folder.md');
    scan.external.duplicatePaths.set(UUID, [folder, path.join(scan.externalRoot, 'Copy')]);
    expect(buildLeafReport(scan).tree?.find((row) => row.folderPath === folder)?.evidence?.status).toBe('Ambiguous or invalid evidence');
    scan.external.duplicatePaths.clear();
    const marker = scan.markers[0];
    if (marker) {
      // Keep the UUID but invalidate the file evidence.
      marker.status = 'invalid-marker';
    }
    expect(buildLeafReport(scan).tree?.find((row) => row.folderPath === folder)?.evidence?.marker).toBe('invalid');
  });
  it('treats matching legacy and UUID-named markers as one compatible identity', () => {
    const { folder, scan } = fixture('Folder.md');
    scan.markers.push({
      folderPath: folder,
      format: 'legacy',
      markerPath: path.join(folder, '.exnf'),
      status: 'valid',
      uuid: UUID
    });

    const node = buildLeafReport(scan).tree?.find((row) => row.folderPath === folder);
    expect(node?.evidence).toMatchObject({
      bindingNote: 'Folder.md',
      status: 'Bound at expected path',
      uuid: UUID
    });
    expect(node?.conflict).toBe(false);
    expect(node?.evidence?.explanations.join(' ')).toContain('run marker migration');
  });
  it('preserves unreadable marker evidence as unchecked', () => {
    const { folder, scan } = fixture('Folder.md');
    const marker = scan.markers[0];
    if (!marker) {
      throw new Error('Fixture marker missing.');
    }
    marker.status = 'unchecked-marker';
    marker.uuid = '';
    scan.external.bindings.clear();
    scan.issues.push({ kind: 'marker', location: marker.markerPath, reason: 'Legacy marker could not be read.', scope: 'external', unchecked: true });
    const node = buildLeafReport(scan).tree?.find((row) => row.folderPath === folder);
    expect(node?.evidence).toMatchObject({ marker: 'unchecked', status: 'Unchecked' });
    expect(node?.conflict).toBe(false);
  });
  it('finds UUID bindings elsewhere and keeps virtual paths optional', () => {
    const { folder, scan } = fixture();
    const model = buildLeafReport(scan);
    const node = model.tree?.find((row) => row.folderPath === folder);
    expect(node?.evidence).toMatchObject({ exact: 'absent', marker: 'present', physicalLeaf: true, status: 'Bound at different path', yaml: 'present' });
    expect(node?.notes[0]?.notePath).toBe('Elsewhere.md');
    const physical = queryTree(model, DEFAULT_TREE_QUERY);
    expect(physical.visible.size).toBe(1);
    const overlay = queryTree(model, { ...DEFAULT_TREE_QUERY, includeExpected: true });
    expect(overlay.visible.size).toBe(2);
    expect(model.tree?.find((row) => row.kind === 'virtual')?.evidence?.status).toBe('Expected path differs; bound elsewhere');
    expect(folderStatusTable(model.tree ?? []).rows).toHaveLength(2);
  });
  it('detects conflict even with all three tags present', () => {
    const { scan } = fixture('Folder.md');
    if (scan.notes[0]) {
      scan.notes[0].uuid = '22222222-2222-4222-8222-222222222222';
    }
    expect(buildLeafReport(scan).tree?.[0]?.evidence).toMatchObject({ exact: 'present', marker: 'present', status: 'Identity conflict', yaml: 'present' });
  });
  it('classifies a valid nested marker as an identity conflict', () => {
    const { folder, scan } = fixture('Folder.md');
    const childUuid = '22222222-2222-4222-8222-222222222222';
    const child = path.join(folder, 'Child');
    const notePath = 'Folder/Child.md';
    scan.folders.push(child);
    scan.notes.push({
      hasExnf: true,
      notePath: path.join(scan.vaultRoot, notePath),
      relativePath: notePath,
      status: 'valid',
      uuid: childUuid,
      value: childUuid
    });
    scan.markers.push({
      folderPath: child,
      format: 'uuid-named',
      markerPath: path.join(child, `${childUuid}.exnf`),
      status: 'valid',
      uuid: childUuid
    });
    scan.vault.bindings.set(childUuid, notePath);
    scan.external.bindings.set(childUuid, child);
    const node = buildLeafReport(scan).tree?.find((row) => row.folderPath === child);
    expect(node?.evidence).toMatchObject({ exact: 'present', marker: 'present', status: 'Identity conflict', yaml: 'present' });
    expect(node?.conflict).toBe(true);
  });
  it('separates ancestor markers, candidate names, and absent yaml', () => {
    const { folder, scan } = fixture('Other/Child.md');
    scan.folders.push(path.join(folder, 'Child'));
    const child = buildLeafReport(scan).tree?.find((row) => row.relativePath.endsWith('Child'));
    expect(child?.evidence).toMatchObject({ marker: 'absent', status: 'Inside a marked folder', yaml: 'absent' });
    expect(child?.evidence?.candidates).toHaveLength(1);
  });
  it('marks uniqueness provisional and blocks repair after excluded evidence', () => {
    const { folder, scan } = fixture();
    scan.issues.push({ location: path.join(scan.externalRoot, 'ignored'), reason: 'Excluded', scope: 'external', unchecked: true });
    expect(buildLeafReport(scan).tree?.find((row) => row.folderPath === folder)?.evidence?.confidence).toBe('provisional');
    expect(() => buildNoteRepair(scan, folder, { aliases: [], path: 'Elsewhere.md' }, 0, [])).toThrow('coverage');
  });
  it('scopes external moves to the selected binding and rejects occupied destinations', () => {
    const { folder, scan } = fixture();
    const plan = buildExternalRepair(scan, folder, 4);
    expect(plan.rows).toHaveLength(1);
    expect(() => buildExternalRepair(scan, folder, 4, ['Folder/'])).toThrow('ignore');
    expect(plan.rows[0]).toMatchObject({ kind: 'move', sourcePath: folder, uuid: UUID });
    scan.folders.push(path.join(scan.externalRoot, 'Elsewhere'));
    expect(() => buildExternalRepair(scan, folder, 4)).toThrow('safety');
  });

  it('ignores unrelated notes without a supported derived path during external repair', () => {
    const { folder, scan } = fixture();
    scan.notes.push({
      hasExnf: false,
      notePath: path.join(scan.vaultRoot, 'README.MD'),
      relativePath: 'README.MD',
      status: 'missing-property',
      uuid: '',
      value: ''
    });
    expect(buildExternalRepair(scan, folder, 4).rows).toHaveLength(1);
  });

  it('rejects moving an external folder into its own subtree', () => {
    const { folder, scan } = fixture('Folder/Child.md');
    expect(() => buildExternalRepair(scan, folder, 0)).toThrow('overlap');
  });

  it('plans only a note move preserving identity and aliases', () => {
    const { folder, scan } = fixture();
    const plan = buildNoteRepair(scan, folder, { aliases: ['Keep'], path: 'Elsewhere.md' }, 3, []);
    expect(plan).toMatchObject({
      aliases: ['Keep', 'Elsewhere'],
      mutationSequence: 3,
      notePath: 'Folder.md',
      repair: true,
      sourcePath: 'Elsewhere.md',
      uuid: UUID
    });
  });
});
